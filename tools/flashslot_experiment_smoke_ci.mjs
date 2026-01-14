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
const setPaths = [
  path.join(flashslotPackDir, "examples", "hypothesis_set_001_dentist_abc.json"),
  path.join(flashslotPackDir, "examples", "hypothesis_set_002_barbershop_abc.json"),
];
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

function expectFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing expected file: ${filePath}`);
  }
}

async function validateExperiment(setPath, outDir) {
  const summaryPath = path.join(outDir, "experiment_summary.json");
  expectFile(summaryPath);
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  if (summary.ok !== true) {
    throw new Error(`[${path.basename(setPath)}] FlashSlot experiment smoke failed: summary.ok !== true`);
  }
  if (!Array.isArray(summary.attempts) || summary.attempts.length === 0) {
    throw new Error(`[${path.basename(setPath)}] FlashSlot experiment smoke failed: no attempts recorded`);
  }

  for (const attempt of summary.attempts) {
    const attemptDir = path.join(outDir, "attempts", attempt.attempt_id);
    expectFile(path.join(attemptDir, "offer.json"));
    expectFile(path.join(attemptDir, "request.json"));
    expectFile(path.join(attemptDir, "result.json"));
  }

  const winnerPackDir = summary.winner_pack_dir
    ? path.resolve(repoRoot, summary.winner_pack_dir)
    : path.join(outDir, "winner_pack");
  if (!fs.existsSync(winnerPackDir) || !fs.statSync(winnerPackDir).isDirectory()) {
    throw new Error(`[${path.basename(setPath)}] FlashSlot experiment smoke failed: missing winner_pack directory`);
  }
  const winnerEntries = fs.readdirSync(winnerPackDir);
  if (winnerEntries.length === 0) {
    throw new Error(`[${path.basename(setPath)}] FlashSlot experiment smoke failed: winner_pack is empty`);
  }
  expectFile(path.join(winnerPackDir, "offer.json"));
  expectFile(path.join(winnerPackDir, "result.json"));

  const winnerResult = JSON.parse(fs.readFileSync(path.join(winnerPackDir, "result.json"), "utf8"));
  if (winnerResult.ok !== true) {
    throw new Error(`[${path.basename(setPath)}] FlashSlot experiment smoke failed: winner result not ok`);
  }

  console.log(`[flashslot_experiment_smoke_ci] PASS: ${path.basename(setPath)} -> ${outDir}`);
}

async function main() {
  fs.mkdirSync(runsRoot, { recursive: true });
  const runId = `${Date.now()}_experiment_smoke`;

  for (const setPath of setPaths) {
    const setLabel = path.basename(setPath, ".json");
    const outDir = path.join(runsRoot, `${runId}_${setLabel}`, "flashslot_experiment");
    await runNode([cliScript, "--set", setPath, "--driver", "noop", "--dry-run", "--out", outDir]);
    await validateExperiment(setPath, outDir);
  }
}

try {
  await main();
} catch (err) {
  console.error("[flashslot_experiment_smoke_ci] FAIL:", err.message);
  process.exit(1);
}
