#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pultDir = path.join(repoRoot, "pults", "inngest_wf_cycle_v0");
const labRunsDir = path.join(repoRoot, "lab", "inngest_runs");
const healthUrl = "http://localhost:3000/health";
const eventUrl = "http://localhost:8288/e/dev";
const processes = new Set();
let shuttingDown = false;

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

async function killStrayInngestProcesses() {
  if (process.platform === "win32") {
    await runDetachedCommand("taskkill", ["/IM", "inngest.exe", "/F"], true);
  } else {
    await runDetachedCommand("pkill", ["-f", "inngest"], true);
  }
}

function runDetachedCommand(command, args, ignoreErrors = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", shell: false });
    child.on("exit", (code) => {
      if (!ignoreErrors && code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
      } else {
        resolve();
      }
    });
    child.on("error", (err) => {
      if (ignoreErrors) {
        resolve();
      } else {
        reject(err);
      }
    });
  });
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
  await killStrayInngestProcesses().catch(() => {});
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
    } catch (err) {
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

async function waitForFile(filePath, label, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${label}: ${filePath}`);
}

async function waitForArtifacts(runId, expectFull) {
  const baseDir = path.join(labRunsDir, runId);
  await waitForFile(path.join(baseDir, "result.json"), `result for ${runId}`);
  if (expectFull) {
    await waitForFile(path.join(baseDir, "wf_cycle_full", "run_summary.json"), `run_summary for ${runId}`);
  }
  return baseDir;
}

async function main() {
  fs.mkdirSync(labRunsDir, { recursive: true });

  const nodeBinary = process.execPath;
  startProcess(nodeBinary, ["server.mjs"], { cwd: pultDir });
  const cliCommand = "npx inngest-cli@latest dev -u http://localhost:3000/api/inngest";
  startShellCommand(cliCommand, { cwd: pultDir });

  await waitForHealth();

  const smokeEventId = await triggerEvent("lab/wf_cycle.smoke");
  const smokeDir = await waitForArtifacts(smokeEventId, false);

  const fullEventId = await triggerEvent("lab/wf_cycle.full");
  const fullDir = await waitForArtifacts(fullEventId, true);

  console.log(`[pult_inngest_smoke_ci] PASS: smoke=${smokeDir}, full=${fullDir}`);
}

try {
  await main();
  await cleanup();
  process.exit(0);
} catch (error) {
  console.error("[pult_inngest_smoke_ci] FAIL:", error.message);
  await cleanup();
  process.exit(1);
}
