#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const demoScript = path.join(repoRoot, "packs", "agent_runner_v0", "tools", "demo_agent_runner_v0.mjs");
const qualityRoot = path.join(repoRoot, "artifacts", "quality", "agent_runner");
fs.mkdirSync(qualityRoot, { recursive: true });

function runProcess(command, args, label) {
  const child = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (child.status !== 0) {
    throw new Error(`[${label}] failed: ${child.stdout}\n${child.stderr}`);
  }
  return child.stdout;
}

function listDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function writeReport(runId, payload) {
  const runDir = path.join(qualityRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const jsonPath = path.join(runDir, "pos_report.json");
  const mdPath = path.join(runDir, "pos_report.md");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  const lines = [
    `# Agent Runner Quality Report (${payload.status})`,
    "",
    `- run_id: ${payload.run_id}`,
    `- status: ${payload.status.toUpperCase()}`,
    "",
    "## Details",
    `- artifacts: ${payload.artifacts.join(", ") || "none"}`,
    ...(payload.errors.length ? ["", "## Errors", ...payload.errors.map((err) => `- ${err}`)] : [])
  ];
  fs.writeFileSync(mdPath, lines.join("\n") + "\n", "utf8");
  return { jsonPath, mdPath };
}

function compareLists(before, after) {
  const set = new Set(before);
  return after.filter((entry) => !set.has(entry));
}

function checkResultJson(dirName) {
  const filePath = path.join(repoRoot, "artifacts", "agent_runner", dirName, "result.json");
  if (!fs.existsSync(filePath)) {
    return `missing result.json for ${dirName}`;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data.status) {
      return `result.json in ${dirName} missing status`;
    }
  } catch (error) {
    return `result.json parse error for ${dirName}: ${error.message}`;
  }
  return null;
}

function main() {
  const baseline = listDirs(path.join(repoRoot, "artifacts", "agent_runner"));
  const stdout = runProcess(process.execPath, [demoScript], "demo_agent_runner_v0");
  const after = listDirs(path.join(repoRoot, "artifacts", "agent_runner"));
  const newDirs = compareLists(baseline, after);
  const errors = [];
  newDirs.forEach((dir) => {
    const error = checkResultJson(dir);
    if (error) errors.push(error);
  });
  if (!newDirs.length) {
    errors.push("no new runner artifacts generated");
  }
  const status = errors.length ? "fail" : "pass";
  const report = {
    run_id: `quality-agent-runner-${Date.now().toString().replace(/[:.]/g, "-")}`,
    status,
    artifacts: newDirs,
    errors
  };
  const reportPaths = writeReport(report.run_id, report);
  console.log(`[quality_agent_runner] report ${reportPaths.jsonPath}`);
  if (status === "fail") {
    process.exit(1);
  }
}

main();
