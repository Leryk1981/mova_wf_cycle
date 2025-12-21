#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const cliScript = path.join(repoRoot, "tools", "flashslot_experiment_cli.mjs");
const setPath = path.join(repoRoot, "packs", "flashslot_v0", "examples", "hypothesis_set_001_dentist_abc.json");
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

async function main() {
  fs.mkdirSync(runsRoot, { recursive: true });
  const runId = `${Date.now()}_experiment_smoke`;
  const outDir = path.join(runsRoot, runId, "flashslot_experiment");
  await runNode([cliScript, "--set", setPath, "--driver", "noop", "--dry-run", "--out", outDir]);

  const summaryPath = path.join(outDir, "experiment_summary.json");
  expectFile(summaryPath);
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  if (summary.ok !== true) {
    throw new Error("FlashSlot experiment smoke failed: summary.ok !== true");
  }
  if (!Array.isArray(summary.attempts) || summary.attempts.length === 0) {
    throw new Error("FlashSlot experiment smoke failed: no attempts recorded");
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
  expectFile(path.join(winnerPackDir, "offer.json"));
  expectFile(path.join(winnerPackDir, "result.json"));

  const winnerResult = JSON.parse(fs.readFileSync(path.join(winnerPackDir, "result.json"), "utf8"));
  if (winnerResult.ok !== true) {
    throw new Error("FlashSlot experiment smoke failed: winner result not ok");
  }

  console.log(`[flashslot_experiment_smoke_ci] PASS: ${outDir}`);
}

try {
  await main();
} catch (err) {
  console.error("[flashslot_experiment_smoke_ci] FAIL:", err.message);
  process.exit(1);
}
