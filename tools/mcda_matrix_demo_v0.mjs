#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const stationScript = path.join(
  repoRoot,
  ".codex",
  "skills",
  "mova_station_cycle_v1",
  "scripts",
  "run.mjs"
);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runStation(requestPath) {
  const child = spawnSync(
    process.execPath,
    [stationScript, "--request", requestPath],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  if (child.status !== 0) {
    throw new Error(stderr || stdout || "station_cycle failed");
  }
  const payload = JSON.parse(stdout);
  return { payload, stdout, stderr };
}

function main() {
  const request = {
    notes: "mcda demo: gates + quality_mcda_matrix + finish_branch",
    steps: {
      snapshot: { enabled: false },
      gates: { enabled: true },
      episode_store: { enabled: false },
      quality_mcda_matrix: { enabled: true, run_negative: true },
      finish_branch: { enabled: true, mode: "report", base: "origin/main" },
      wf_cycle: {
        scaffold: { enabled: false },
        compare: { enabled: false },
        winner_pack: { enabled: false }
      },
      quality_invoice_ap: { enabled: false },
      quality_gateway: { enabled: false }
    }
  };

  const requestDir = path.join(repoRoot, "artifacts", "station_cycle", "demo_requests");
  ensureDir(requestDir);
  const requestPath = path.join(requestDir, "mcda_demo_station_cycle_request.json");
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2));

  const { payload } = runStation(requestPath);
  const runDir = payload.artifacts_dir;

  const step = (payload.steps || []).find((entry) => entry.name === "quality_mcda_matrix") || {};
  const posReport = step.report_json || step.output || null;
  const negReport = step.report_negative_json || null;

  console.log(`[demo:mcda_matrix] station_cycle artifacts: ${runDir}`);
  if (posReport) {
    console.log(`[demo:mcda_matrix] open pos report: Get-Content ${posReport}`);
  }
  if (negReport) {
    console.log(`[demo:mcda_matrix] open neg report: Get-Content ${negReport}`);
  }
  if (!posReport && !negReport) {
    console.log("[demo:mcda_matrix] reports not found in station_cycle output");
  }
}

try {
  main();
} catch (error) {
  console.error("[demo:mcda_matrix] FAIL:", error.message);
  process.exit(1);
}
