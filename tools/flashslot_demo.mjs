#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadStationRegistry, resolvePackPathAbs } from "./station_registry_helpers_v0.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const registry = loadStationRegistry(repoRoot);
const flashslotPackDir = resolvePackPathAbs(repoRoot, "flashslot_v0", registry);
const cliScript = path.join(repoRoot, "tools", "flashslot_experiment_cli.mjs");
const setPath = path.join(flashslotPackDir, "examples", "hypothesis_set_001_dentist_abc.json");
const runsRoot = path.join(repoRoot, "lab", "flashslot_runs");

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`command exited with code ${code}`));
      }
    });
  });
}

function buildRunId() {
  return `flashslot_demo_${Date.now()}`;
}

async function main() {
  fs.mkdirSync(runsRoot, { recursive: true });
  const runId = buildRunId();
  const outDir = path.join(runsRoot, runId, "flashslot_experiment");

  console.log(`[flashslot_demo] running noop dry-run on committed dentist set -> ${outDir}`);
  await runNode([cliScript, "--set", setPath, "--driver", "noop", "--dry-run", "--out", outDir]);

  const summaryPath = path.join(outDir, "experiment_summary.json");
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Missing experiment summary at ${summaryPath}`);
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const winnerPackDir = summary.winner_pack_dir
    ? path.resolve(repoRoot, summary.winner_pack_dir)
    : path.join(outDir, "winner_pack");

  console.log(`[flashslot_demo] experiment summary: ${summaryPath}`);
  console.log(`[flashslot_demo] winner pack: ${winnerPackDir}`);
  console.log("[flashslot_demo] complete");
}

try {
  await main();
} catch (err) {
  console.error("[flashslot_demo] FAIL:", err.message);
  process.exit(1);
}
