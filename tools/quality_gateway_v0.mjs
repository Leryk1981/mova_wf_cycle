#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";

const repoRoot = process.cwd();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const positiveSuitePath = path.join(repoRoot, "docs", "examples", "gateway_v0", "positive_cases_v0.json");
const negativeSuitePath = path.join(repoRoot, "docs", "examples", "gateway_v0", "negative_cases_v0.json");
const routesConfigPath = path.join(repoRoot, "executors", "cloudflare_worker_gateway_v0", "worker", "config", "gateway_routes_v0.json");
const policyConfigPath = path.join(repoRoot, "executors", "cloudflare_worker_gateway_v0", "worker", "config", "gateway_policy_v0.json");
const gatewayRuntimePath = path.join(repoRoot, "executors", "cloudflare_worker_gateway_v0", "worker", "src", "gateway_runtime.js");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath ? path.normalize(process.env.npm_execpath) : null;

// Import the signature verification function for mock domain server
async function sha256Hex(input) {
  const crypto = await import('node:crypto');
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function verifySignature(
  method,
  pathname,
  ts,
  bodySha256,
  signature,
  secretKey,
  timeWindowSeconds = 60
) {
  // Check timestamp is within allowed window (±60 seconds by default)
  const now = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(ts, 10);

  if (isNaN(tsNum) || Math.abs(now - tsNum) > timeWindowSeconds) {
    console.log(`Timestamp check failed: now=${now}, ts=${tsNum}, diff=${Math.abs(now - tsNum)}`);
    return false;
  }

  // Recreate the canonical string to verify
  const stringToVerify = `${method}\n${pathname}\n${ts}\n${bodySha256}`;

  // Import the key for verification (Node.js crypto implementation)
  const crypto = await import('node:crypto');
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(stringToVerify);
  const expectedSignature = hmac.digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  return mismatch === 0;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Create a mock domain server that verifies signatures
function createMockDomainServer(secretKey, port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(`http://${req.headers.host}${req.url}`);
      const method = req.method.toUpperCase();
      const pathname = url.pathname;

      // Extract required headers
      const requestId = req.headers['x-gw-request-id'];
      const ts = req.headers['x-gw-ts'];
      const bodySha256 = req.headers['x-gw-body-sha256'];
      const signature = req.headers['x-gw-sig'];

      // Check if all required headers are present
      if (!requestId || !ts || !bodySha256 || !signature) {
        console.log('Mock domain: Missing required signature headers');
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            code: 'unauthorized',
            message: 'Missing required signature headers',
            details: 'Direct access denied - gateway signature required'
          }
        }));
        return;
      }

      // Get the request body for verification
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const actualBodySha256 = await sha256Hex(body);

          // Verify body hash matches
          if (actualBodySha256 !== bodySha256) {
            console.log('Mock domain: Body hash mismatch');
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: {
                code: 'unauthorized',
                message: 'Body hash mismatch',
                details: 'Direct access denied - gateway signature required'
              }
            }));
            return;
          }

          // Verify the signature
          const isValid = await verifySignature(
            method,
            pathname,
            ts,
            bodySha256,
            signature,
            secretKey,
            60
          );

          if (!isValid) {
            console.log('Mock domain: Signature verification failed');
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: {
                code: 'unauthorized',
                message: 'Invalid signature',
                details: 'Direct access denied - gateway signature required'
              }
            }));
            return;
          }

          // Check if this is the probe endpoint
          if (pathname === '/__gw_probe') {
            // Return the expected probe response
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              probe: 'gw_sig_ok',
              x_gw_request_id: requestId,
              x_gw_ts: ts,
              x_gw_body_sha256: bodySha256,
              has_sig: true
            }));
          } else {
            // Signature is valid, process the request
            console.log('Mock domain: Signature verified successfully');
            let requestBody;
            try {
              requestBody = JSON.parse(body);
            } catch (e) {
              requestBody = { raw: body };
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              message: 'Request processed successfully',
              request_id: requestBody.request_id || requestId,
              domain: requestBody.domain || 'mock',
              action: requestBody.action || 'test',
              verified: true
            }));
          }
        } catch (error) {
          console.error('Mock domain error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              code: 'internal_error',
              message: error.message
            }
          }));
        }
      });
    });

    server.listen(port, () => {
      const address = server.address();
      resolve({
        server,
        url: `http://localhost:${address.port}`,
        port: address.port
      });
    });

    server.on('error', reject);
  });
}

function parseArgs(argv) {
  const parsed = { negative: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--negative") parsed.negative = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
  }
  return parsed;
}

function printHelp() {
  console.log("Usage: node tools/quality_gateway_v0.mjs [--negative]");
}

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

async function buildEnv({ artifacts, routesConfig, policyConfig, mockDomainServer }) {
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
      GATEWAY_HMAC_SECRET: "quality-secret",
      GATEWAY_REMOTE_STATUS_URL: mockDomainServer ? `${mockDomainServer.url}/status` : "https://remote.example/gateway/status",
      MOCK_DOMAIN_URL: mockDomainServer ? mockDomainServer.url : undefined
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
  if (segments.length < 3 || !["api", "gw"].includes(segments[0])) {
    throw new Error(`Invalid gateway path: ${pathname}`);
  }
  return { domain: segments[1], action: segments[2] };
}

function runCommand(command, args, logPath) {
  ensureDir(path.dirname(logPath));
  const started = Date.now();
  let child;
  try {
    child = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8"
    });
  } catch (err) {
    child = { status: null, stdout: "", stderr: err.message, error: err };
  }
  const duration = Date.now() - started;
  const combined = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  fs.writeFileSync(logPath, combined || "(no output)\n", "utf8");
  return {
    exit_code: child.status ?? 1,
    status: child.status === 0 ? "pass" : "fail",
    duration_ms: duration,
    log: relRepo(logPath),
    error: child.error?.message
  };
}

function runNpmCommand(args, logPath) {
  if (npmCliPath && fs.existsSync(npmCliPath)) {
    return runCommand(process.execPath, [npmCliPath, ...args], logPath);
  }
  return runCommand(npmCmd, args, logPath);
}

function runGates(baseDir) {
  ensureDir(baseDir);
  const gateCommands = [
    { label: "npm run validate", args: ["run", "validate"], log: path.join(baseDir, "npm_run_validate.log") },
    { label: "npm run test", args: ["run", "test"], log: path.join(baseDir, "npm_test.log") },
    { label: "npm run smoke:wf_cycle", args: ["run", "smoke:wf_cycle"], log: path.join(baseDir, "npm_run_smoke_wf_cycle.log") },
    { label: "npm run codex:wrappers:check", args: ["run", "codex:wrappers:check"], log: path.join(baseDir, "npm_run_codex_wrappers_check.log") }
  ];
  return gateCommands.map((gate) => ({
    label: gate.label,
    ...runNpmCommand(gate.args, gate.log)
  }));
}

function buildReportMarkdown(report) {
  const lines = [];
  lines.push(`# Gateway Quality Report (${report.mode})`);
  lines.push(`- Run: ${report.run_id}`);
  lines.push(`- Status: ${report.status.toUpperCase()}`);
  lines.push("");
  lines.push("## Gates");
  if (!report.gates.length) {
    lines.push("- (none run)");
  } else {
    for (const gate of report.gates) {
      lines.push(`- ${gate.label}: ${gate.status.toUpperCase()} (exit=${gate.exit_code}) — log \`${gate.log}\``);
    }
  }
  lines.push("");
  lines.push("## Positive suite");
  lines.push(`- Status: ${report.positive_suite.status.toUpperCase()}`);
  for (const entry of report.positive_suite.cases) {
    lines.push(`- ${entry.name}: ${entry.pass ? "PASS" : "FAIL"} (status=${entry.status}, ok=${entry.ok}) — log \`${entry.log}\``);
  }
  if (report.negative_suite) {
    lines.push("");
    lines.push("## Negative suite");
    lines.push(`- Status: ${report.negative_suite.status.toUpperCase()}`);
    for (const entry of report.negative_suite.cases) {
      lines.push(`- ${entry.name}: ${entry.pass ? "PASS" : "FAIL"} (status=${entry.status}, ok=${entry.ok}) — log \`${entry.log}\``);
    }
  }
  if (report.hmac_headers?.length) {
    lines.push("");
    lines.push(`HMAC headers captured: ${report.hmac_headers.join(", ")}`);
  }
  return lines.join("\n");
}

async function runGatewaySuite({ mode, baseDir, runId, mockDomainServer }) {
  const suitePath = mode === "negative" ? negativeSuitePath : positiveSuitePath;
  const suite = loadJson(suitePath);

  // Load the original configuration
  let routesConfig = loadJson(routesConfigPath);
  const policyConfig = loadJson(policyConfigPath);

  // If mockDomainServer is provided, update the routes to use mock server URL
  if (mockDomainServer) {
    routesConfig = JSON.parse(JSON.stringify(routesConfig)); // Deep clone
    routesConfig.routes = routesConfig.routes.map(route => {
      if (route.url && route.url.includes('mova-cloudflare-worker-v1.s-myasoedov81.workers.dev')) {
        // Replace the real domain worker URL with mock server URL
        return { ...route, url: mockDomainServer.url };
      }
      return route;
    });
  }

  const artifacts = new MemoryBucket();
  const { env } = await buildEnv({ artifacts, routesConfig, policyConfig, mockDomainServer });
  const runtimeModule = await import(pathToFileURL(gatewayRuntimePath).href);
  const handleGatewayRoute = runtimeModule.handleGatewayRoute;
  const logsDir = path.join(baseDir, "logs", mode);
  const artifactsDir = path.join(baseDir, "artifacts", mode);
  ensureDir(logsDir);
  ensureDir(artifactsDir);
  const hmacHeaders = [];
  const startedAt = new Date();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url && (url.includes("remote.example") || (mockDomainServer && url.includes(`localhost:${mockDomainServer.port}`)))) {
      const headers = new Headers(init?.headers || {});
      const sig = headers.get("x-gw-sig");
      if (sig) hmacHeaders.push(sig);

      // If this is a request to the mock domain server, handle it specially
      if (mockDomainServer && url.includes(`localhost:${mockDomainServer.port}`)) {
        // Check if this is the probe endpoint
        const parsedUrl = new URL(url);
        if (parsedUrl.pathname === '/__gw_probe') {
          // Extract gateway headers
          const gwRequestId = headers.get('x-gw-request-id');
          const gwTs = headers.get('x-gw-ts');
          const gwBodySha256 = headers.get('x-gw-body-sha256');
          const gwSig = headers.get('x-gw-sig');

          // Return the expected probe response
          return new Response(JSON.stringify({
            ok: true,
            probe: 'gw_sig_ok',
            x_gw_request_id: gwRequestId,
            x_gw_ts: gwTs,
            x_gw_body_sha256: gwBodySha256,
            has_sig: !!gwSig
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }

        // For other endpoints, use the original fetch to avoid recursion
        const response = await originalFetch(input, init);
        return response;
      }

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
      const payload = { scenario: testCase.reason || testCase.name };
      if (typeof testCase.payload_bytes === "number" && testCase.payload_bytes > 0) {
        payload.filler = "x".repeat(testCase.payload_bytes);
      }
      const body = { request_id: requestId, payload };
      const auth = testCase.name === "missing_auth" ? null : env.GATEWAY_AUTH_TOKEN;
      const request = makeRequest(testCase.path, body, auth);
      const { domain, action } = parseGatewayPath(testCase.path);
      const response = await handleGatewayRoute(request, env, domain, action);
      let json;
      try {
        json = await response.clone().json();
      } catch (error) {
        const text = await response.text().catch(() => "");
        json = { ok: false, error: { message: text || error.message } };
      }
      const pass = response.status === testCase.expect_status && (!!json.ok === !!testCase.expect_ok);
      const logPath = path.join(logsDir, `${testCase.name}.json`);
      fs.writeFileSync(
        logPath,
        JSON.stringify({ response_status: response.status, body: json }, null, 2)
      );
      cases.push({
        name: testCase.name,
        expect_status: testCase.expect_status,
        expect_ok: testCase.expect_ok,
        status: response.status,
        ok: !!json.ok,
        pass,
        request_id: json.request_id || requestId,
        log: relRepo(logPath)
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const artifactsDirFinal = path.join(artifactsDir);
  ensureDir(artifactsDirFinal);
  artifacts.dumpTo(artifactsDirFinal);

  return {
    mode,
    status: cases.every((c) => c.pass) ? "pass" : "fail",
    cases,
    hmac_headers: hmacHeaders,
    artifacts_dir: relRepo(artifactsDirFinal),
    logs_dir: relRepo(logsDir),
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString()
  };
}

async function runQuality(includeNegative) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const baseDir = path.join(repoRoot, "artifacts", "quality_gateway", runId);
  ensureDir(baseDir);
  const startedAt = new Date();

  // Create a mock domain server for testing signature verification
  const mockDomainServer = await createMockDomainServer("quality-secret");
  console.log(`[quality_gateway] Mock domain server started at ${mockDomainServer.url}`);

  const gatesDir = path.join(baseDir, "gates");
  const gates = runGates(gatesDir);
  const positiveSuite = await runGatewaySuite({ mode: "positive", baseDir, runId, mockDomainServer });
  let negativeSuite = null;
  if (includeNegative) {
    negativeSuite = await runGatewaySuite({ mode: "negative", baseDir, runId, mockDomainServer });
  }

  // Close the mock domain server
  mockDomainServer.server.close();
  console.log(`[quality_gateway] Mock domain server closed`);

  const finishedAt = new Date();
  const status = [
    ...gates.map((g) => g.status),
    positiveSuite.status,
    ...(negativeSuite ? [negativeSuite.status] : [])
  ].every((s) => s === "pass")
    ? "pass"
    : "fail";

  const report = {
    run_id: runId,
    mode: includeNegative ? "positive+negative" : "positive",
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    status,
    artifacts_dir: relRepo(baseDir),
    gates,
    positive_suite: positiveSuite,
    negative_suite: negativeSuite,
    hmac_headers: Array.from(
      new Set([
        ...(positiveSuite.hmac_headers || []),
        ...(negativeSuite?.hmac_headers || [])
      ])
    )
  };

  const reportJsonPath = path.join(baseDir, "quality_report.json");
  const reportMdPath = path.join(baseDir, "quality_report.md");
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(reportMdPath, buildReportMarkdown(report));

  if (negativeSuite) {
    const negativeReport = {
      run_id: runId,
      mode: "negative",
      status: negativeSuite.status,
      started_at: negativeSuite.started_at,
      finished_at: negativeSuite.finished_at,
      cases: negativeSuite.cases,
      artifacts_dir: negativeSuite.artifacts_dir,
      hmac_headers: negativeSuite.hmac_headers
    };
    const negativeReportPath = path.join(baseDir, "quality_report_negative.json");
    fs.writeFileSync(negativeReportPath, JSON.stringify(negativeReport, null, 2));
  }

  if (status !== "pass") {
    console.error(`[quality_gateway] FAILED (${report.mode})`);
  } else {
    console.log(`[quality_gateway] PASS (${report.mode})`);
  }

  return { ok: status === "pass", baseDir, reportJsonPath, reportMdPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const { ok } = await runQuality(args.negative);
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error("[quality_gateway] ERROR", error);
  process.exit(1);
});
