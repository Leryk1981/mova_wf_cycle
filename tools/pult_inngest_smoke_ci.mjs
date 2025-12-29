#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import flashslotPublish from "../pults/inngest_wf_cycle_v0/src/inngest/flashslot_publish.mjs";
import flashslotExperiment from "../pults/inngest_wf_cycle_v0/src/inngest/flashslot_experiment.mjs";
import wfCycleExperiment from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_experiment.mjs";
import wfCycleFull from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_full.mjs";
import wfCycleSmoke from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_smoke.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pultDir = path.join(repoRoot, "pults", "inngest_wf_cycle_v0");
const labRunsDir = path.join(repoRoot, "lab", "inngest_runs");
const healthUrl = "http://localhost:3000/health";
const eventUrl = "http://localhost:8288/e/dev";

const enablePultSmoke = process.env.PULT_SMOKE_ENABLE === "1";
if (!enablePultSmoke) {
  console.log(
    "[pult_inngest_smoke_ci] SKIP: set PULT_SMOKE_ENABLE=1 to run; requires express, inngest, and inngest-cli installed locally (see README). Default skip avoids network-heavy setup in CI/offline runs."
  );
  process.exit(0);
}

const requiredDeps = ["express", "inngest", "inngest-cli"];
const depLocations = [
  path.join(repoRoot, "node_modules"),
  path.join(pultDir, "node_modules")
];
const missingDeps = requiredDeps.filter(
  (dep) => !depLocations.some((dir) => fs.existsSync(path.join(dir, dep)))
);
if (missingDeps.length > 0) {
  console.log(
    `[pult_inngest_smoke_ci] SKIP: missing local deps (${missingDeps.join(
      ", "
    )}); install dev deps (e.g., npm install --include=dev express@5.2.1 inngest@3.48.1 inngest-cli@1.15.1) and re-run with PULT_SMOKE_ENABLE=1`
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
}

function startProcess(command, args, options = {}) {
  console.log(`[pult_inngest_smoke_ci] starting: ${command} ${args.join(" ")}`);
  let child;
  try {
    child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options
    });
  } catch (err) {
    throw new Error(`failed to spawn ${command}: ${err.message}`);
  }
  processes.add(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      console.warn(`[pult_inngest_smoke_ci] process ${command} exited with code=${code} signal=${signal}`);
    }
  });
  return child;
}

function startShellCommand(command, options = {}) {
  console.log(`[pult_inngest_smoke_ci] starting shell: ${command}`);
  let child;
  try {
    child = spawn(command, {
      stdio: "inherit",
      shell: true,
      ...options
    });
  } catch (err) {
    throw new Error(`failed to spawn shell command ${command}: ${err.message}`);
  }
  processes.add(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      console.warn(`[pult_inngest_smoke_ci] shell command exited with code=${code} signal=${signal}`);
    }
  });
  return child;
}

async function runDetached(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", shell: false });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

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

async function waitForDirNotEmpty(dirPath, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(dirPath)) {
      const entries = fs.readdirSync(dirPath);
      if (entries.length > 0) {
        return;
      }
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${label}: ${dirPath}`);
}

async function waitForFlashslotPublishArtifacts(runId, timeoutMs = 300000) {
  const baseDir = path.join(labRunsDir, runId);
  const publishDir = path.join(baseDir, "flashslot_publish");
  await waitForFile(path.join(baseDir, "result.json"), `result for ${runId}`, timeoutMs);
  await waitForFile(
    path.join(publishDir, "result.json"),
    `flashslot_publish result for ${runId}`,
    timeoutMs
  );
  await waitForFile(
    path.join(publishDir, "request.json"),
    `flashslot_publish request for ${runId}`,
    timeoutMs
  );
  return publishDir;
}

async function waitForFlashslotExperimentArtifacts(runId, timeoutMs = 300000) {
  const experimentDir = path.join(labRunsDir, runId, "flashslot_experiment");
  await waitForFile(
    path.join(experimentDir, "experiment_summary.json"),
    `flashslot_experiment summary for ${runId}`,
    timeoutMs
  );
  await waitForDirNotEmpty(
    path.join(experimentDir, "winner_pack"),
    `flashslot_experiment winner_pack for ${runId}`,
    timeoutMs
  );
  return experimentDir;
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
    const flashslotExp = await runHandler(flashslotExperiment, "flashslot.experiment");

    const fullOut = full.result?.outDir ?? full.runDir;
    const experimentSummary = experiment.result?.experiment_summary
      ? path.join(experiment.runDir, experiment.result.experiment_summary)
      : experiment.runDir;
    const flashslotOut = flashslot.result?.outDir ?? flashslot.runDir;
    const flashslotExperimentSummary = flashslotExp.result?.experiment_summary
      ? path.join(flashslotExp.runDir, flashslotExp.result.experiment_summary)
      : flashslotExp.runDir;

    console.log(
      `[pult_inngest_smoke_ci] PASS: smoke=${smoke.runDir}, full=${fullOut}, experiment=${experimentSummary}, flashslot=${flashslotOut}, flashslot_experiment=${flashslotExperimentSummary}`
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

  const flashslotPublishEventId = await triggerEvent("lab/flashslot.publish");
  const flashslotPublishDir = await waitForFlashslotPublishArtifacts(flashslotPublishEventId, 300000);

  const flashslotExperimentEventId = await triggerEvent("flashslot.experiment");
  const flashslotExperimentDir = await waitForFlashslotExperimentArtifacts(flashslotExperimentEventId, 300000);

  console.log(
    `[pult_inngest_smoke_ci] PASS: smoke=${smokeDir}, full=${fullDir}, experiment=${experimentDir}, flashslot_publish=${flashslotPublishDir}, flashslot_experiment=${flashslotExperimentDir}`
  );
}

try {
  await killStrayInngestProcesses();
  await main();
  await cleanup();
  process.exit(0);
} catch (error) {
  console.error("[pult_inngest_smoke_ci] FAIL:", error.message);
  await cleanup();
  process.exit(1);
}
