#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const runsRoot = path.join(repoRoot, "lab", "flashslot_runs");
const runnerScript = path.join(repoRoot, "tools", "flashslot_experiment_keep_artifacts_ci.mjs");

function parseArgs(argv) {
  const args = { driver: "noop", dryRun: true };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--set":
        args.setPath = argv[++i];
        break;
      case "--out":
        args.outDir = argv[++i];
        break;
      case "--driver":
        args.driver = argv[++i];
        break;
      case "--dry-run": {
        const next = argv[i + 1];
        if (next === "false" || next === "0") {
          args.dryRun = false;
          i += 1;
        } else {
          args.dryRun = true;
        }
        break;
      }
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.setPath) {
    throw new Error("--set is required");
  }
  return args;
}

function buildRunId() {
  return `flashslot_exp_${Date.now()}`;
}

function resolveOutDir(outDir) {
  if (outDir) {
    return path.resolve(repoRoot, outDir);
  }
  return path.join(runsRoot, buildRunId(), "flashslot_experiment");
}

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDirAbs = resolveOutDir(args.outDir);
  fs.mkdirSync(outDirAbs, { recursive: true });

  const runnerArgs = [runnerScript, "--set", args.setPath, "--out", outDirAbs, "--driver", args.driver];
  if (args.dryRun === false) {
    runnerArgs.push("--dry-run", "false");
  } else {
    runnerArgs.push("--dry-run");
  }

  await runNode(runnerArgs);
}

try {
  await main();
} catch (err) {
  console.error("[flashslot_experiment_cli] FAIL:", err.message);
  process.exit(1);
}
