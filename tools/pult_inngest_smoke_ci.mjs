#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import flashslotPublish from "../pults/inngest_wf_cycle_v0/src/inngest/flashslot_publish.mjs";
import wfCycleExperiment from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_experiment.mjs";
import wfCycleFull from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_full.mjs";
import wfCycleSmoke from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_smoke.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pultDir = path.join(repoRoot, "pults", "inngest_wf_cycle_v0");
const labRunsDir = path.join(repoRoot, "lab", "inngest_runs");
const healthUrl = "http://localhost:3000/health";
const eventUrl = "http://localhost:8288/e/dev";
const processes = new Set();
let shuttingDown = false;
const mode = process.env.PULT_SMOKE_DRIVER?.toLowerCase() === "cli" ? "cli" : "stub";

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
  const child = spawn(command, args, { stdio: "inherit", shell: false, ...options });
  processes.add(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      console.warn(`[pult_inngest_smoke_ci] process ${command} exited with code=${code} signal=${signal}`);
    }
  });
  return child;
}

async function waitForExit(child, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode == null && Date.now() < deadline) {
    await sleep(100);
  }
  if (child.exitCode == null) {
    child.kill("SIGKILL");
  }
}

async function cleanup() {
  shuttingDown = true;
  const waits = [];
  for (const child of processes) {
    try {
      if (child.exitCode == null) {
        child.kill("SIGTERM");
      }
    } catch {
      // ignore
    }
    waits.push(waitForExit(child));
  }
  await Promise.all(waits);
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
    await sleep(500);
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
      await sleep(1000);
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
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}: ${filePath}`);
}

async function waitForArtifacts(runId, options = {}) {
  const { expectFull = false, expectExperiment = false, expectFlashslot = false, timeoutMs = 300000 } = options;
  const baseDir = path.join(labRunsDir, runId);
  await waitForFile(path.join(baseDir, "result.json"), `result for ${runId}`, timeoutMs);
  if (expectFull) {
    await waitForFile(path.join(baseDir, "wf_cycle_full", "run_summary.json"), `wf_cycle_full summary for ${runId}`, timeoutMs);
  }
  if (expectExperiment) {
    await waitForFile(path.join(baseDir, "wf_cycle_experiment", "experiment_summary.json"), `wf_cycle_experiment summary for ${runId}`, timeoutMs);
  }
  if (expectFlashslot) {
    await waitForFile(path.join(baseDir, "flashslot_publish", "result.json"), `flashslot publish result for ${runId}`, timeoutMs);
  }
  return baseDir;
}

function ensurePultDependencies() {
  const expressPath = path.join(pultDir, "node_modules", "express");
  const inngestPath = path.join(pultDir, "node_modules", "inngest");
  const inngestCliPath = path.join(pultDir, "node_modules", ".bin", process.platform === "win32" ? "inngest.cmd" : "inngest");
  if (fs.existsSync(expressPath) && fs.existsSync(inngestPath) && fs.existsSync(inngestCliPath)) {
    return;
  }
  console.log("[pult_inngest_smoke_ci] installing pult dependencies via npm ci");
  const result = spawn("npm", ["ci"], { cwd: pultDir, stdio: "inherit", shell: false });
  return new Promise((resolve, reject) => {
    result.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm ci failed with code ${code}`))));
    result.on("error", reject);
  });
}

function getInngestBinary() {
  const inngestCliPath = path.join(pultDir, "node_modules", ".bin", process.platform === "win32" ? "inngest.cmd" : "inngest");
  if (!fs.existsSync(inngestCliPath)) {
    throw new Error("inngest CLI not found; run npm ci in pults/inngest_wf_cycle_v0");
  }
  return inngestCliPath;
}

async function runWithCli() {
  await ensurePultDependencies();
  fs.mkdirSync(labRunsDir, { recursive: true });

  const nodeBinary = process.execPath;
  const inngestCli = getInngestBinary();
  startProcess(nodeBinary, ["server.mjs"], { cwd: pultDir });
  startProcess(inngestCli, ["dev", "-u", "http://localhost:3000/api/inngest"], { cwd: pultDir });

  await waitForHealth();

  const smokeEventId = await triggerEvent("lab/wf_cycle.smoke");
  const smokeDir = await waitForArtifacts(smokeEventId, { timeoutMs: 600000 });

  const fullEventId = await triggerEvent("lab/wf_cycle.full");
  const fullDir = await waitForArtifacts(fullEventId, { expectFull: true, timeoutMs: 600000 });

  const experimentEventId = await triggerEvent("lab/wf_cycle.experiment");
  const experimentDir = await waitForArtifacts(experimentEventId, { expectExperiment: true, timeoutMs: 900000 });

  const flashslotEventId = await triggerEvent("lab/flashslot.publish");
  const flashslotDir = await waitForArtifacts(flashslotEventId, { expectFlashslot: true, timeoutMs: 600000 });

  console.log(
    `[pult_inngest_smoke_ci] PASS: smoke=${smokeDir}, full=${fullDir}, experiment=${experimentDir}, flashslot=${flashslotDir}`
  );
}

async function runWithHandlers() {
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
}

async function main() {
  try {
    if (mode === "cli") {
      await runWithCli();
    } else {
      await runWithHandlers();
    }
    await cleanup();
    process.exit(0);
  } catch (error) {
    await cleanup();
    console.error("[pult_inngest_smoke_ci] FAIL:", error.message);
    process.exit(1);
  }
}

main();
