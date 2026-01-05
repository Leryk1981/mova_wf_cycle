import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = path.join("artifacts", "smoke", "mova_mcp_v0", runId);

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

async function writeJson(fileName, data) {
  const fullPath = path.join(artifactsDir, fileName);
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf8");
  return fullPath;
}

async function main() {
  await fs.mkdir(artifactsDir, { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["tools/mova_mcp_server_v0/run.mjs"],
    env: {
      ...filterEnv(getGatewayEnv()),
      ...filterEnv(getMemoryEnv())
    },
    stderr: "pipe"
  });

  const client = new Client({ name: "mova-mcp-smoke", version: "0.1.0" });
  let report = {
    ok: false,
    run_id: runId,
    artifacts_dir: artifactsDir,
    ping: null,
    envelope: null
  };

  try {
    await client.connect(transport);

    const pingResult = await client.callTool({
      name: "mova_ping_v0",
      arguments: {}
    });
    const pingJson = parseToolJson(pingResult);
    await writeJson("ping.json", pingJson ?? pingResult);
    const pingOk = Boolean(pingJson?.ok);

    const gatewayEnv = getGatewayEnv();
    if (!gatewayEnv.MOVA_GATEWAY_BASE_URL || !gatewayEnv.MOVA_GATEWAY_AUTH_TOKEN) {
      const skipPayload = {
        status: "SKIP",
        reason: "missing MOVA_GATEWAY_BASE_URL or MOVA_GATEWAY_AUTH_TOKEN"
      };
      await writeJson("envelope_skip.json", skipPayload);
      report = {
        ...report,
        ok: pingOk,
        ping: { status: pingOk ? "PASS" : "FAIL" },
        envelope: skipPayload
      };
      await writeJson("smoke_report.json", report);
      process.exitCode = pingOk ? 0 : 1;
      return;
    }

    const envelopeResult = await client.callTool({
      name: "mova_run_envelope_v0",
      arguments: {
        path: "/api/mova.domain.test/probe",
        body: {},
        idempotency_key: `smoke-${runId}`,
        mode: "dry_run",
        timeout_ms: 30000
      }
    });
    const envelopeJson = parseToolJson(envelopeResult);
    await writeJson("envelope.json", envelopeJson ?? envelopeResult);
    const envelopeOk = envelopeJson?.http_status === 200;

    report = {
      ...report,
      ok: pingOk && envelopeOk,
      ping: { status: pingOk ? "PASS" : "FAIL" },
      envelope: {
        status: envelopeOk ? "PASS" : "FAIL",
        http_status: envelopeJson?.http_status ?? null
      }
    };
    await writeJson("smoke_report.json", report);
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await client.close();
  }
}

main().catch(async (err) => {
  const fallback = {
    ok: false,
    run_id: runId,
    error: err instanceof Error ? err.message : String(err)
  };
  try {
    await fs.mkdir(artifactsDir, { recursive: true });
    await writeJson("smoke_report.json", fallback);
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
