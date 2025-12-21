#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { runTool } from "../executors/executor_router_v0.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--config") {
      args.config = argv[++i];
    } else if (token === "--artifacts-dir") {
      args.artifactsDir = argv[++i];
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node tools/wf_cycle_driver_probes.mjs --config <path/to/config.json> --artifacts-dir <path>",
    "",
    "The config file must define { gate_id, offline_ok, timeout_ms?, drivers[] }.",
    "Each driver describes executor_ref/tool_id/args/expect_ok/timeout override.",
    "Artifacts are written to <artifacts-dir>/driver_id/."
  ].join("\n");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toAbs(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(repoRoot, p);
}

async function runDriverProbe({ driver, gateId, artifactsDir, defaultTimeout }) {
  const driverId = driver.driver_id || `driver_${Math.random().toString(16).slice(2, 6)}`;
  const executorRef = driver.executor_ref;
  if (!executorRef) {
    throw new Error(`Driver ${driverId} missing executor_ref`);
  }
  const toolId = driver.tool_id || "shell";
  const args = driver.args || {};
  const expectOk = driver.expect_ok !== false;
  const driverDir = path.join(artifactsDir, driverId);
  ensureDir(driverDir);
  const logsDir = path.join(driverDir, "logs");
  ensureDir(logsDir);

  const request = {
    request_id: `${gateId}_${driverId}_${Date.now()}`,
    tool_id: toolId,
    args,
    ctx: {
      gate_id: gateId,
      driver_id: driverId,
      probe_kind: "executor_driver_probe"
    }
  };

  const options = { logsDir };
  if (driver.base_url) {
    options.baseUrl = driver.base_url;
  }
  if (driver.auth_token) {
    options.authToken = driver.auth_token;
  }
  if (typeof driver.timeout_ms === "number" && Number.isFinite(driver.timeout_ms)) {
    request.args = { ...args, timeout_ms: driver.timeout_ms };
  } else if (driver.timeout_ms === undefined && defaultTimeout) {
    request.args = { ...args, timeout_ms: defaultTimeout };
  }

  let result = null;
  let error = null;
  const startedAt = performance.now();
  try {
    result = await runTool({
      executor_ref: executorRef,
      request,
      options
    });
  } catch (err) {
    error = err;
  }
  const durationMs = Math.round(performance.now() - startedAt);

  const summary = {
    driver_id: driverId,
    executor_ref: executorRef,
    status: "fail",
    duration_ms: durationMs,
    expect_ok: expectOk
  };

  if (error) {
    summary.error = error.message || String(error);
    const payload = {
      gate_id: gateId,
      driver_id: driverId,
      error: summary.error,
      duration_ms: durationMs
    };
    fs.writeFileSync(path.join(driverDir, "result.json"), JSON.stringify(payload, null, 2));
    return summary;
  }

  const okMatches = Boolean(result?.ok) === expectOk;
  summary.status = okMatches ? "pass" : "fail";
  summary.exit_code = result?.tool_result?.exit_code ?? null;
  fs.writeFileSync(path.join(driverDir, "result.json"), JSON.stringify(result, null, 2));
  return summary;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.config) {
    throw new Error("Missing --config <path>");
  }
  const configPath = toAbs(args.config);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const config = readJson(configPath);
  const artifactsDir = toAbs(args.artifactsDir || path.join(path.dirname(configPath), "..", "artifacts", "driver_probes"));
  ensureDir(artifactsDir);

  const drivers = Array.isArray(config.drivers) ? config.drivers : [];
  if (!drivers.length) {
    throw new Error("No drivers[] configured for driver probes gate");
  }
  const gateId = config.gate_id || "GATE_EXECUTOR_DRIVER_PROBES";
  const defaultTimeout =
    typeof config.timeout_ms === "number" && Number.isFinite(config.timeout_ms) ? Math.max(config.timeout_ms, 0) : undefined;

  const startedAt = new Date();
  const summaries = [];
  for (const driver of drivers) {
    // eslint-disable-next-line no-await-in-loop
    const summary = await runDriverProbe({ driver, gateId, artifactsDir, defaultTimeout });
    summaries.push(summary);
  }
  const finishedAt = new Date();
  const status = summaries.every((s) => s.status === "pass") ? "pass" : "fail";
  const summary = {
    gate_id: gateId,
    status,
    offline_ok: config.offline_ok === true,
    drivers: summaries,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    artifacts_dir: path.relative(repoRoot, artifactsDir).replace(/\\/g, "/")
  };

  fs.writeFileSync(path.join(artifactsDir, "driver_probes_summary.json"), JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  if (status !== "pass") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ status: "error", error: err.message || String(err) }, null, 2));
  process.exit(1);
});
