import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = path.join("artifacts", "behavior_probe", runId);
const MAX_STREAM_BYTES = 20000;
const MAX_JSON_BYTES = 20000;

function getGatewayEnv() {
  return {
    MOVA_GATEWAY_BASE_URL: process.env.MOVA_GATEWAY_BASE_URL,
    MOVA_GATEWAY_AUTH_TOKEN: process.env.MOVA_GATEWAY_AUTH_TOKEN
  };
}

function getMemoryEnv() {
  return {
    MOVA_MEMORY_BASE_URL: process.env.MOVA_MEMORY_BASE_URL,
    MOVA_MEMORY_AUTH_TOKEN: process.env.MOVA_MEMORY_AUTH_TOKEN
  };
}

function filterEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => Boolean(value))
  );
}

function parseToolJson(result) {
  const first = result?.content?.[0];
  if (!first || first.type !== "text") {
    return null;
  }
  try {
    return JSON.parse(first.text);
  } catch {
    return null;
  }
}

function createLimitedCollector(maxBytes) {
  let size = 0;
  let truncated = false;
  return {
    truncated: () => truncated,
    onData(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size >= maxBytes) {
        truncated = true;
        return;
      }
      const remaining = maxBytes - size;
      size += Math.min(buffer.length, remaining);
      if (buffer.length > remaining) {
        truncated = true;
      }
    }
  };
}

async function runCommand(command, args) {
  const start = Date.now();
  const stdoutCollector = createLimitedCollector(MAX_STREAM_BYTES);
  const stderrCollector = createLimitedCollector(MAX_STREAM_BYTES);

  // For Windows, we might need to use shell: true for npm.cmd to work properly
  const options = {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    cwd: process.cwd()
  };

  // On Windows, use shell: true for npm.cmd to avoid EINVAL errors
  if (process.platform === "win32" && command.endsWith(".cmd")) {
    options.shell = true;
  }

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, options);
    } catch (spawnError) {
      // Handle spawn errors directly
      const durationMs = Date.now() - start;
      resolve({
        exit_code: -1,
        status: "FAIL",
        duration_ms: durationMs,
        stdout_trunc: false,
        stderr_trunc: false,
        error_code: spawnError?.code || null,
        syscall: spawnError?.syscall || null,
        path: spawnError?.path || null,
        cmd: command,
        args: args,
        reason: spawnError instanceof Error ? spawnError.message : String(spawnError)
      });
      return;
    }

    child.stdout.on("data", (chunk) => stdoutCollector.onData(chunk));
    child.stderr.on("data", (chunk) => stderrCollector.onData(chunk));

    child.on("error", (error) => {
      // Handle process errors
      const durationMs = Date.now() - start;
      resolve({
        exit_code: -1,
        status: "FAIL",
        duration_ms: durationMs,
        stdout_trunc: stdoutCollector.truncated(),
        stderr_trunc: stderrCollector.truncated(),
        error_code: error?.code || null,
        syscall: error?.syscall || null,
        path: error?.path || null,
        cmd: command,
        args: args,
        reason: error instanceof Error ? error.message : String(error)
      });
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      const exitCode = typeof code === "number" ? code : -1;
      resolve({
        exit_code: exitCode,
        status: exitCode === 0 ? "PASS" : "FAIL",
        duration_ms: durationMs,
        stdout_trunc: stdoutCollector.truncated(),
        stderr_trunc: stderrCollector.truncated()
      });
    });
  });
}

async function writeReport(payload) {
  await fs.mkdir(artifactsDir, { recursive: true });
  const reportPath = path.join(artifactsDir, "probe_report.json");
  await fs.writeFile(reportPath, JSON.stringify(payload, null, 2), "utf8");
  return reportPath;
}

async function writeJsonFile(fileName, payload) {
  await fs.mkdir(artifactsDir, { recursive: true });
  const output = JSON.stringify(payload, null, 2);
  let truncated = false;
  let data = output;
  if (output.length > MAX_JSON_BYTES) {
    truncated = true;
    data = output.slice(0, MAX_JSON_BYTES);
  }
  const filePath = path.join(artifactsDir, fileName);
  await fs.writeFile(filePath, data, "utf8");
  return { filePath, truncated };
}

async function attemptEnvelope(runIdValue) {
  const env = getGatewayEnv();
  if (!env.MOVA_GATEWAY_BASE_URL || !env.MOVA_GATEWAY_AUTH_TOKEN) {
    return {
      status: "SKIP",
      reason: "missing MOVA_GATEWAY_BASE_URL or MOVA_GATEWAY_AUTH_TOKEN"
    };
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("tools/mova_mcp_server_v0/run.mjs")],
    env: filterEnv(env),
    stderr: "pipe"
  });
  const client = new Client({ name: "behavior-probe", version: "0.1.0" });
  const start = Date.now();
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "mova_run_envelope_v0",
      arguments: {
        path: "/api/mova.domain.test/probe",
        body: {},
        idempotency_key: `behavior-probe-${runIdValue}`,
        mode: "dry_run",
        timeout_ms: 30000
      }
    });
    const json = parseToolJson(result);
    if (!json || json.http_status !== 200) {
      return {
        status: "FAIL",
        reason: "gateway call failed",
        gw_request_id: json?.gw_request_id ?? null,
        duration_ms: Date.now() - start
      };
    }
    return {
      status: "PASS",
      reason: "ok",
      gw_request_id: json.gw_request_id ?? null,
      duration_ms: Date.now() - start
    };
  } catch (error) {
    // Add more diagnostic information for spawn errors
    const errorInfo = {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      error_code: error?.code || null,
      syscall: error?.syscall || null,
      path: error?.path || null,
      gw_request_id: null,
      duration_ms: Date.now() - start
    };
    return errorInfo;
  } finally {
    try {
      await client.close();
    } catch (closeError) {
      // Ignore close errors
    }
  }
}

async function attemptMemorySearch(runIdValue) {
  const env = getMemoryEnv();
  if (!env.MOVA_MEMORY_BASE_URL || !env.MOVA_MEMORY_AUTH_TOKEN) {
    return {
      status: "SKIP",
      reason: "missing MOVA_MEMORY_BASE_URL or MOVA_MEMORY_AUTH_TOKEN"
    };
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("tools/mova_mcp_server_v0/run.mjs")],
    env: filterEnv(env),
    stderr: "pipe"
  });
  const client = new Client({ name: "behavior-probe", version: "0.1.0" });
  const start = Date.now();
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "mova_search_episodes_v0",
      arguments: {
        filter: {},
        limit: 5
      }
    });
    const json = parseToolJson(result);
    await writeJsonFile("memory_search.json", json ?? result);
    if (!json || json.http_status !== 200) {
      return {
        status: "FAIL",
        reason: "memory search failed",
        duration_ms: Date.now() - start
      };
    }
    return {
      status: "PASS",
      reason: "ok",
      duration_ms: Date.now() - start
    };
  } catch (error) {
    // Add more diagnostic information for spawn errors
    const errorInfo = {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      error_code: error?.code || null,
      syscall: error?.syscall || null,
      path: error?.path || null,
      duration_ms: Date.now() - start
    };
    return errorInfo;
  } finally {
    try {
      await client.close();
    } catch (closeError) {
      // Ignore close errors
    }
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const gates = {
    validate: await runCommand(npmCmd, ["run", "validate"]),
    test: await runCommand(npmCmd, ["test"]),
    smoke_mcp: await runCommand(npmCmd, ["run", "smoke:mova_mcp_v0"])
  };
  const envelopeAttempt = await attemptEnvelope(runId);
  const memoryAttempt = await attemptMemorySearch(runId);
  const finishedAt = new Date().toISOString();

  // Add diagnostic information
  const env = process.env;
  const debugInfo = {
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    argv0: process.argv0,
    npm_bin: npmCmd,
    has_gateway_env: !!(env.MOVA_GATEWAY_BASE_URL && env.MOVA_GATEWAY_AUTH_TOKEN),
    has_memory_env: !!(env.MOVA_MEMORY_BASE_URL && env.MOVA_MEMORY_AUTH_TOKEN)
  };

  const report = {
    run_id: runId,
    artifacts_dir: artifactsDir.replace(/\\/g, "/"),
    started_at: startedAt,
    finished_at: finishedAt,
    channels_used: {
      docs_context7: true,
      local_gates: true,
      mcp_envelope: envelopeAttempt.status,
      mcp_memory_search: memoryAttempt.status
    },
    docs_used: true,
    debug: debugInfo,
    gates,
    envelope_attempt: envelopeAttempt,
    memory_search: memoryAttempt,
    notes: "Behavior probe report."
  };

  const reportPath = await writeReport(report);
  console.log(reportPath);
}

main().catch(async (error) => {
  const fallbackStartedAt = new Date().toISOString();

  // Add diagnostic information
  const env = process.env;
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const debugInfo = {
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    argv0: process.argv0,
    npm_bin: npmCmd,
    has_gateway_env: !!(env.MOVA_GATEWAY_BASE_URL && env.MOVA_GATEWAY_AUTH_TOKEN),
    has_memory_env: !!(env.MOVA_MEMORY_BASE_URL && env.MOVA_MEMORY_AUTH_TOKEN)
  };

  const report = {
    run_id: runId,
    artifacts_dir: artifactsDir.replace(/\\/g, "/"),
    started_at: fallbackStartedAt,
    finished_at: new Date().toISOString(),
    channels_used: {
      docs_context7: true,
      local_gates: true,
      mcp_envelope: "FAIL",
      mcp_memory_search: "FAIL"
    },
    docs_used: true,
    debug: debugInfo,
    gates: {
      validate: { exit_code: -1, status: "FAIL", duration_ms: 0 },
      test: { exit_code: -1, status: "FAIL", duration_ms: 0 },
      smoke_mcp: { exit_code: -1, status: "FAIL", duration_ms: 0 }
    },
    envelope_attempt: {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      error_code: error?.code || null,
      syscall: error?.syscall || null,
      path: error?.path || null,
      gw_request_id: null
    },
    memory_search: {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      error_code: error?.code || null,
      syscall: error?.syscall || null,
      path: error?.path || null
    },
    notes: "Behavior probe report failed."
  };
  const reportPath = await writeReport(report);
  console.log(reportPath);
  process.exitCode = 1;
});
