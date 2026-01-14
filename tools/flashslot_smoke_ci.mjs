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
const publishScript = path.join(flashslotPackDir, "runtime", "impl", "publish_offer_v0.mjs");
const hypothesisPath = path.join(flashslotPackDir, "examples", "hypothesis_001_dentist.json");
const runsRoot = path.join(repoRoot, "lab", "flashslot_runs");

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true });
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
  const runId = `${Date.now()}_smoke`;
  const outDir = path.join(runsRoot, runId);
  fs.mkdirSync(outDir, { recursive: true });
  await runNode([publishScript, "--in", hypothesisPath, "--out", outDir, "--driver", "noop", "--dry-run"]);
  const requestPath = path.join(outDir, "request.json");
  const resultPath = path.join(outDir, "result.json");
  const evidencePath = path.join(outDir, "evidence", "noop.json");
  expectFile(requestPath);
  expectFile(resultPath);
  expectFile(evidencePath);
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (!result?.ok) {
    throw new Error("FlashSlot smoke failed: result.ok !== true");
  }
  console.log(`[flashslot_smoke_ci] PASS: ${outDir}`);
}

try {
  await main();
} catch (err) {
  console.error("[flashslot_smoke_ci] FAIL:", err.message);
  process.exit(1);
}
