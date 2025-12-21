#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import flashslotPublish from "../pults/inngest_wf_cycle_v0/src/inngest/flashslot_publish.mjs";
import wfCycleExperiment from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_experiment.mjs";
import wfCycleFull from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_full.mjs";
import wfCycleSmoke from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_smoke.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pultDir = path.join(repoRoot, "pults", "inngest_wf_cycle_v0");
const labRunsDir = path.join(repoRoot, "lab", "inngest_runs");
const healthUrl = "http://localhost:3000/health";
const eventUrl = "http://localhost:8288/e/dev";

const requiredDeps = ["express", "inngest"];
const missingDeps = requiredDeps.filter((dep) =>
  !fs.existsSync(path.join(repoRoot, "node_modules", dep))
);
if (missingDeps.length > 0) {
  console.log(
    `[pult_inngest_smoke_ci] SKIP: missing local deps (${missingDeps.join(
      ", "
    )}); skipping runtime smoke in offline environment`
  );
  process.exit(0);
}

const processes = new Set();
let shuttingDown = false;

const inngestStub = {
  createFunction: (_opts, _trigger, handler) => ({ handler })
};

function createStepAdapter() {
  return {
    run: async (_label, cb) => cb()
  };
}

function resolveRunDir(runId) {
  return path.join(labRunsDir, runId);
}

async function runHandler(factory, label) {
  const fn = factory(inngestStub);
  const handler = fn?.handler;
  if (typeof handler !== "function") {
    throw new Error(`failed to resolve handler for ${label}`);
  }
  const safeLabel = label.replace(/[\\/]/g, "_");
  const eventId = `${Date.now()}_${safeLabel}`;
  const result = await handler({ event: { id: eventId }, step: createStepAdapter() });
  const runId = result?.runId ?? eventId;
  return { result, runId, runDir: resolveRunDir(runId) };
async function killStrayInngestProcesses() {
  if (process.platform === "win32") {
    await runDetached("taskkill", ["/IM", "inngest.exe", "/F"]);
  } else {
    await new Promise((resolve) => {
      const child = spawn("pkill", ["-x", "inngest"], { stdio: "ignore", shell: false });
      child.on("exit", (code) => {
        if (code === 1) {
          console.log("[pult_inngest_smoke_ci] no running inngest processes to kill");
        } else if (code && code !== 0) {
          console.warn(`[pult_inngest_smoke_ci] pkill exited with code=${code}`);
        }
        resolve();
      });
      child.on("error", (err) => {
        console.warn(`[pult_inngest_smoke_ci] pkill failed: ${err.message}`);
        resolve();
      });
    });
  }
}

async function cleanup() {
  shuttingDown = true;
  for (const child of processes) {
    try {
      if (child.exitCode == null) {
        child.kill("SIGTERM");
      }
    } catch (err) {
      console.warn(`[pult_inngest_smoke_ci] failed to kill pid ${child.pid}: ${err.message}`);
    }
  }
  await sleep(1000);
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.ok) {
          console.log("[pult_inngest_smoke_ci] /health OK");
          return;
        }
      }
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error("pult /health did not become ready");
}

async function triggerEvent(name) {
  const deadline = Date.now() + 60000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(eventUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data: {} })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`status ${res.status}: ${text}`);
      }
      const body = await res.json().catch(() => null);
      const ids = body?.ids;
      const eventId = Array.isArray(ids) && ids.length > 0 ? ids[0] : body?.id;
      if (!eventId) {
        throw new Error("missing event id");
      }
      console.log(`[pult_inngest_smoke_ci] triggered ${name} -> ${eventId}`);
      return eventId;
    } catch (err) {
      lastError = err;
      await sleep(2000);
    }
  }
  throw new Error(`failed to trigger ${name}: ${lastError?.message ?? "timeout"}`);
}

async function waitForFile(filePath, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${label}: ${filePath}`);
}

async function waitForArtifacts(runId, options = {}) {
  const { expectFull = false, expectExperiment = false, timeoutMs = 300000 } = options;
  const baseDir = path.join(labRunsDir, runId);
  await waitForFile(path.join(baseDir, "result.json"), `result for ${runId}`, timeoutMs);
  if (expectFull) {
    await waitForFile(
      path.join(baseDir, "wf_cycle_full", "run_summary.json"),
      `wf_cycle_full summary for ${runId}`,
      timeoutMs
    );
  }
  if (expectExperiment) {
    await waitForFile(
      path.join(baseDir, "wf_cycle_experiment", "experiment_summary.json"),
      `wf_cycle_experiment summary for ${runId}`,
      timeoutMs
    );
  }
  return baseDir;
}

async function main() {
  fs.mkdirSync(labRunsDir, { recursive: true });
  const originalCwd = process.cwd();
  process.chdir(pultDir);

  try {
    const smoke = await runHandler(wfCycleSmoke, "lab/wf_cycle.smoke");
    const full = await runHandler(wfCycleFull, "lab/wf_cycle.full");
    const experiment = await runHandler(wfCycleExperiment, "lab/wf_cycle.experiment");
    const flashslot = await runHandler(flashslotPublish, "lab/flashslot.publish");

    const fullOut = full.result?.outDir ?? full.runDir;
    const experimentSummary = experiment.result?.experiment_summary
      ? path.join(experiment.runDir, experiment.result.experiment_summary)
      : experiment.runDir;
    const flashslotOut = flashslot.result?.outDir ?? flashslot.runDir;

    console.log(
      `[pult_inngest_smoke_ci] PASS: smoke=${smoke.runDir}, full=${fullOut}, experiment=${experimentSummary}, flashslot=${flashslotOut}`
    );
  } finally {
    process.chdir(originalCwd);
  }
  const nodeBinary = process.execPath;
  startProcess(nodeBinary, ["server.mjs"], { cwd: pultDir });
  startProcess("npx", ["--no-install", "inngest-cli", "dev", "-u", "http://localhost:3000/api/inngest"], {
    cwd: pultDir
  });

  await waitForHealth();

  const smokeEventId = await triggerEvent("lab/wf_cycle.smoke");
  const smokeDir = await waitForArtifacts(smokeEventId, { timeoutMs: 600000 });

  const fullEventId = await triggerEvent("lab/wf_cycle.full");
  const fullDir = await waitForArtifacts(fullEventId, { expectFull: true, timeoutMs: 600000 });

  const experimentEventId = await triggerEvent("lab/wf_cycle.experiment");
  const experimentDir = await waitForArtifacts(experimentEventId, {
    expectExperiment: true,
    timeoutMs: 900000
  });

  console.log(
    `[pult_inngest_smoke_ci] PASS: smoke=${smokeDir}, full=${fullDir}, experiment=${experimentDir}`
  );
}

main().catch((error) => {
  console.error("[pult_inngest_smoke_ci] FAIL:", error.message);
  process.exit(1);
});
