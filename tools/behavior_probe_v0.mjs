import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = path.join("artifacts", "behavior_probe", runId);

function getArgValue(key, fallback) {
  const prefix = `--${key}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  if (!entry) {
    return fallback;
  }
  const raw = entry.slice(prefix.length).toLowerCase();
  if (raw !== "pass" && raw !== "fail") {
    return fallback;
  }
  return raw;
}

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
        gw_request_id: json?.gw_request_id ?? null
      };
    }
    return {
      status: "PASS",
      reason: "ok",
      gw_request_id: json.gw_request_id ?? null
    };
  } catch (error) {
    return {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      gw_request_id: null
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const validateStatus = getArgValue("validate", "fail");
  const testStatus = getArgValue("test", "fail");
  const smokeStatus = getArgValue("smoke_mcp", "fail");
  const envelopeAttempt = await attemptEnvelope(runId);

  const report = {
    docs_used: true,
    gates: {
      validate: validateStatus,
      test: testStatus,
      smoke_mcp: smokeStatus
    },
    envelope_attempt: envelopeAttempt,
    notes: "Behavior probe report."
  };

  await writeReport(report);
}

main().catch(async (error) => {
  const report = {
    docs_used: true,
    gates: {
      validate: "fail",
      test: "fail",
      smoke_mcp: "fail"
    },
    envelope_attempt: {
      status: "FAIL",
      reason: error instanceof Error ? error.message : String(error),
      gw_request_id: null
    },
    notes: "Behavior probe report failed."
  };
  await writeReport(report);
  process.exitCode = 1;
});
