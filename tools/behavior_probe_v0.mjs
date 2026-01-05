import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = path.join("artifacts", "behavior_probe", runId);
const MAX_STREAM_BYTES = 20000;

function getGatewayEnv() {
  return {
    MOVA_GATEWAY_BASE_URL: process.env.MOVA_GATEWAY_BASE_URL,
    MOVA_GATEWAY_AUTH_TOKEN: process.env.MOVA_GATEWAY_AUTH_TOKEN
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

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    child.stdout.on("data", (chunk) => stdoutCollector.onData(chunk));
    child.stderr.on("data", (chunk) => stderrCollector.onData(chunk));

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
    args: ["tools/mova_mcp_server_v0/run.mjs"],
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
    return {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      gw_request_id: null,
      duration_ms: Date.now() - start
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const gates = {
    validate: await runCommand(npmCmd, ["run", "validate"]),
    test: await runCommand(npmCmd, ["test"]),
    smoke_mcp: await runCommand(npmCmd, ["run", "smoke:mova_mcp_v0"])
  };
  const envelopeAttempt = await attemptEnvelope(runId);

  const report = {
    docs_used: true,
    gates,
    envelope_attempt: envelopeAttempt,
    notes: "Behavior probe report."
  };

  const reportPath = await writeReport(report);
  console.log(reportPath);
}

main().catch(async (error) => {
  const report = {
    docs_used: true,
    gates: {
      validate: { exit_code: -1, status: "FAIL", duration_ms: 0 },
      test: { exit_code: -1, status: "FAIL", duration_ms: 0 },
      smoke_mcp: { exit_code: -1, status: "FAIL", duration_ms: 0 }
    },
    envelope_attempt: {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      gw_request_id: null
    },
    notes: "Behavior probe report failed."
  };
  const reportPath = await writeReport(report);
  console.log(reportPath);
  process.exitCode = 1;
});
