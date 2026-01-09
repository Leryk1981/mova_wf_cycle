#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runnerScript = path.join(repoRoot, "packs", "agent_runner_v0", "tools", "agent_runner_execute_v0.mjs");
const demoDir = path.join(repoRoot, "artifacts", "agent_runner", "demo");
fs.mkdirSync(demoDir, { recursive: true });

function runProcess(command, args, label) {
  const child = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
    , shell: true
  });
  if (child.status !== 0) {
    console.error(`[demo_agent_runner] ${label} failed`, child.stdout, child.stderr, child.error);
    process.exit(1);
  }
  return child.stdout.trim();
}

function latestShipBundle() {
  const shipRoot = path.join(repoRoot, "artifacts", "agent_ship");
  if (!fs.existsSync(shipRoot)) {
    throw new Error("no agent_ship artifacts yet");
  }
  const dirs = fs
    .readdirSync(shipRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!dirs.length) {
    throw new Error("no agent_ship runs found");
  }
  return path.join(shipRoot, dirs[dirs.length - 1], "bundle");
}

function parseRunnerOutput(output) {
  const lines = output.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        return JSON.parse(line);
      } catch {
        // ignore
      }
    }
  }
  throw new Error("runner output did not contain JSON");
}

function buildRequest(stage, bundleDir) {
  return {
    request_id: `agent-runner-demo-${stage}-${Date.now()}`,
    mova_version: "4.1.1",
    agent_bundle_dir: bundleDir,
    role_id: stage === "execute" ? "executor" : "planner",
    pipeline_stage: stage,
    task: {
      action_id: "run_validate",
      input: { stage },
      idempotency_key: `demo-${stage}`
    },
    control_mcp: {
      mode: "stdio",
      command: "node tools/mova_mcp_server_v0/run.mjs",
      env_allowlist: [
        "MOVA_GATEWAY_BASE_URL",
        "MOVA_GATEWAY_AUTH_TOKEN",
        "MOVA_MEMORY_BASE_URL",
        "MOVA_MEMORY_AUTH_TOKEN"
      ]
    },
    limits: {
      timeout_ms: 60000,
      max_json_bytes: 60000
    }
  };
}

function runStage(stage, bundleDir) {
  const request = buildRequest(stage, bundleDir);
  const requestPath = path.join(demoDir, `request-${stage}.json`);
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf8");
  const stdout = runProcess(process.execPath, [runnerScript, "--request", requestPath], `runner ${stage}`);
  const parsed = parseRunnerOutput(stdout);
  console.log(`[agent_runner:demo] ${stage} -> ${parsed.artifacts_dir}`);
  return parsed;
}

function main() {
  runProcess("npm", ["run", "ship:agent_template"], "ship:agent_template");
  const bundleDir = latestShipBundle();
  const planResult = runStage("plan", bundleDir);
  const execResult = runStage("execute", bundleDir);
  return [planResult.artifacts_dir, execResult.artifacts_dir];
}

const dirs = main();
console.log(`[agent_runner:demo] runner artifacts -> ${dirs.join(", ")}`);
