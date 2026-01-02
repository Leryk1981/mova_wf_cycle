#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const positiveSuitePath = path.join(repoRoot, "docs", "examples", "gateway_v0", "positive_cases_v0.json");
const negativeSuitePath = path.join(repoRoot, "docs", "examples", "gateway_v0", "negative_cases_v0.json");
const routesConfigPath = path.join(repoRoot, "executors", "cloudflare_worker_gateway_v0", "worker", "config", "gateway_routes_v0.json");
const policyConfigPath = path.join(repoRoot, "executors", "cloudflare_worker_gateway_v0", "worker", "config", "gateway_policy_v0.json");
const gatewayRuntimePath = path.join(repoRoot, "executors", "cloudflare_worker_gateway_v0", "worker", "src", "gateway_runtime.js");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function relRepo(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

class MemoryKV {
  constructor(seed = {}) {
    this.map = new Map(Object.entries(seed));
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async put(key, value) {
    this.map.set(key, value);
  }
}

class MemoryBucket {
  constructor() {
    this.map = new Map();
  }

  async put(key, value) {
    const stored = typeof value === "string" ? value : JSON.stringify(value);
    this.map.set(key, stored);
  }

  async get(key) {
    if (!this.map.has(key)) return null;
    const stored = this.map.get(key);
    return {
      async arrayBuffer() {
        return new TextEncoder().encode(stored).buffer;
      },
      async text() {
        return stored;
      }
    };
  }

  keys() {
    return [...this.map.keys()];
  }

  dumpTo(dir) {
    for (const [key, value] of this.map.entries()) {
      const dest = path.join(dir, key);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, value, "utf8");
    }
  }
}

class MemoryService {
  constructor(handler) {
    this.handler = handler;
  }

  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init);
    return this.handler(request);
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildEnv({ artifacts, routesConfig, policyConfig }) {
  const kvSeed = {
    gateway_routes_v0: JSON.stringify(routesConfig),
    gateway_policy_v0: JSON.stringify(policyConfig)
  };
  const kv = new MemoryKV(kvSeed);
  const echoService = new MemoryService(async (req) => {
    const body = await req.json();
    const response = {
      echoed: body.payload || {},
      request_id: body.request_id,
      domain: body.domain,
      action: body.action
    };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  const slowService = new MemoryService(async (req) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const body = await req.json();
    return new Response(JSON.stringify({ slow: true, request_id: body.request_id }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  const dummyDb = {
    prepare() {
      return {
        bind() {
          return {
            run: async () => ({ success: true }),
            all: async () => ({ results: [] })
          };
        }
      };
    }
  };

  return {
    env: {
      POLICY_KV: kv,
      EPISODES_DB: dummyDb,
      ARTIFACTS: artifacts,
      GATEWAY_VERSION: "gateway_v0_quality",
      GATEWAY_AUTH_TOKEN: "gateway-test-token",
      DEFAULT_POLICY_REF: "policy.default",
      SERVICE_ECHO: echoService,
      SERVICE_SLOW: slowService,
      GATEWAY_HMAC_SECRET: "quality-secret"
    }
  };
}

function makeRequest(pathname, body, authToken = "gateway-test-token") {
  const url = new URL(`https://gateway.local${pathname}`);
  return new Request(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    },
    body: JSON.stringify(body)
  });
}

function parseGatewayPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 3) throw new Error(`Invalid gateway path: ${pathname}`);
  return { domain: segments[1], action: segments[2] };
}

function buildReportMarkdown(report) {
  const lines = [];
  lines.push(`# Gateway Quality Report (${report.mode})`);
  lines.push(`- Run: ${report.run_id}`);
  lines.push(`- Cases: ${report.cases.length}`);
  lines.push(`- Status: ${report.status.toUpperCase()}`);
  lines.push("");
  for (const entry of report.cases) {
    lines.push(`- ${entry.name}: ${entry.pass ? "PASS" : "FAIL"} (status=${entry.status}, ok=${entry.body?.ok})`);
  }
  if (report.hmac_headers?.length) {
    lines.push("");
    lines.push(`HMAC headers captured: ${report.hmac_headers.join(", ")}`);
  }
  return lines.join("\n");
}

async function runSuite({ mode }) {
  const routesConfig = loadJson(routesConfigPath);
  const policyConfig = loadJson(policyConfigPath);
  const artifacts = new MemoryBucket();
  const { env } = buildEnv({ artifacts, routesConfig, policyConfig });
  const runtimeModule = await import(pathToFileURL(gatewayRuntimePath).href);
  const handleGatewayRoute = runtimeModule.handleGatewayRoute;
  const suite = loadJson(mode === "negative" ? negativeSuitePath : positiveSuitePath);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const baseDir = path.join(repoRoot, "artifacts", "quality_gateway", runId);
  ensureDir(baseDir);
  const logsDir = path.join(baseDir, "logs");
  ensureDir(logsDir);
  const hmacHeaders = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url && url.includes("remote.example")) {
      const headers = new Headers(init?.headers || {});
      const sig = headers.get("x-gw-sig");
      if (sig) hmacHeaders.push(sig);
      return new Response(JSON.stringify({ upstream: "remote", ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };

  const cases = [];
  try {
    for (const testCase of suite.cases) {
      const requestId = `${testCase.name}_${runId}`;
      const body = { request_id: requestId, payload: { scenario: testCase.name } };
      const auth = testCase.name === "missing_auth" ? null : env.GATEWAY_AUTH_TOKEN;
      const request = makeRequest(testCase.path, body, auth);
      const { domain, action } = parseGatewayPath(testCase.path);
      const response = await handleGatewayRoute(request, env, domain, action);
      let json;
      try {
        json = await response.json();
      } catch (error) {
        json = { ok: false, error: { message: error.message } };
      }
      const pass = response.status === testCase.expect_status && (!!json.ok === !!testCase.expect_ok);
      const logPath = path.join(logsDir, `${testCase.name}.json`);
      fs.writeFileSync(logPath, JSON.stringify({ response_status: response.status, body: json }, null, 2));
      cases.push({
        name: testCase.name,
        expect_status: testCase.expect_status,
        expect_ok: testCase.expect_ok,
        status: response.status,
        body: json,
        pass,
        log: relRepo(logPath)
      });
    }

    if (mode === "positive") {
      const remoteCase = cases.find((c) => c.name === "remote_status");
      if (remoteCase && hmacHeaders.length === 0) {
        remoteCase.pass = false;
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const artifactsDir = path.join(baseDir, "artifacts");
  ensureDir(artifactsDir);
  artifacts.dumpTo(artifactsDir);

  const report = {
    mode,
    run_id: runId,
    status: cases.every((c) => c.pass) ? "pass" : "fail",
    cases,
    hmac_headers: hmacHeaders,
    artifacts_dir: relRepo(artifactsDir)
  };

  const reportJsonPath = path.join(baseDir, "report.json");
  const reportMdPath = path.join(baseDir, "report.md");
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(reportMdPath, buildReportMarkdown(report));

  return { report, baseDir, reportJsonPath, reportMdPath };
}

async function main() {
  const negative = process.argv.includes("--negative");
  const { report } = await runSuite({ mode: negative ? "negative" : "positive" });
  if (report.status !== "pass") {
    console.error(`[quality_gateway] FAILED (${report.mode})`);
    process.exit(1);
  }
  console.log(`[quality_gateway] PASS (${report.mode})`);
}

main().catch((error) => {
  console.error("[quality_gateway] ERROR", error);
  process.exit(1);
});
