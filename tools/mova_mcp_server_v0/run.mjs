import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const ALLOWED_SCRIPTS = new Set([
  "validate",
  "test",
  "smoke:wf_cycle",
  "codex:wrappers:check",
  "quality:invoice_ap",
  "quality:invoice_ap:neg",
  "quality:gateway",
  "quality:gateway:neg"
]);

const MAX_STREAM_BYTES = 20000;

const RunNpmInputSchema = z.object({
  script: z.string().min(1),
  args: z.array(z.string()).optional()
});

const RunEnvelopeInputSchema = z.object({
  path: z.string().min(1),
  body: z.record(z.any()).default({}),
  idempotency_key: z.string().min(1),
  mode: z.enum(["dry_run", "live"]).default("dry_run"),
  timeout_ms: z.number().int().positive().max(120000).default(30000)
});

const SearchEpisodesInputSchema = z.object({
  filter: z.record(z.any()).default({}),
  limit: z.number().int().positive().max(200).default(20)
});

const server = new Server(
  { name: "mova-mcp-server-v0", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mova_ping_v0",
      description: "Return a simple health response with ISO timestamp.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    {
      name: "mova_run_npm_v0",
      description:
        "Run an allowlisted npm script and return bounded stdout/stderr.",
      inputSchema: {
        type: "object",
        properties: {
          script: { type: "string" },
          args: { type: "array", items: { type: "string" } }
        },
        required: ["script"],
        additionalProperties: false
      }
    },
    {
      name: "mova_run_envelope_v0",
      description:
        "POST a MOVA envelope to the gateway with idempotency protection.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          body: { type: "object", default: {} },
          idempotency_key: { type: "string" },
          mode: { type: "string", enum: ["dry_run", "live"], default: "dry_run" },
          timeout_ms: { type: "number", default: 30000 }
        },
        required: ["path", "idempotency_key"],
        additionalProperties: false
      }
    },
    {
      name: "mova_search_episodes_v0",
      description: "Search episodes from the MOVA memory API (read-only).",
      inputSchema: {
        type: "object",
        properties: {
          filter: { type: "object", default: {} },
          limit: { type: "number", default: 20 }
        },
        additionalProperties: false
      }
    }
  ]
}));

function createLimitedCollector(maxBytes) {
  let size = 0;
  let truncated = false;
  const chunks = [];
  return {
    onData(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (size >= maxBytes) {
        truncated = true;
        return;
      }
      const remaining = maxBytes - size;
      if (buffer.length > remaining) {
        chunks.push(buffer.subarray(0, remaining));
        size = maxBytes;
        truncated = true;
        return;
      }
      chunks.push(buffer);
      size += buffer.length;
    },
    getResult() {
      return {
        text: Buffer.concat(chunks, size).toString("utf8"),
        truncated
      };
    }
  };
}

async function runNpmScript(script, args) {
  if (!ALLOWED_SCRIPTS.has(script)) {
    throw new Error("DENY: script not allowed");
  }

  const start = Date.now();
  const stdoutCollector = createLimitedCollector(MAX_STREAM_BYTES);
  const stderrCollector = createLimitedCollector(MAX_STREAM_BYTES);
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const commandArgs = ["run", script, "--", ...(args || [])];

  return await new Promise((resolve) => {
    const child = spawn(npmCmd, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    child.stdout.on("data", (chunk) => stdoutCollector.onData(chunk));
    child.stderr.on("data", (chunk) => stderrCollector.onData(chunk));

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      const stdout = stdoutCollector.getResult();
      const stderr = stderrCollector.getResult();
      resolve({
        exit_code: typeof code === "number" ? code : -1,
        stdout: stdout.text,
        stderr: stderr.text,
        duration_ms: durationMs,
        truncated: stdout.truncated || stderr.truncated
      });
    });
  });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`DENY: missing env ${name}`);
  }
  return value;
}

function buildUrl(baseUrl, path) {
  const trimmedBase = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return {
      http_status: response.status,
      headers: response.headers,
      json,
      duration_ms: Date.now() - start
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  if (name === "mova_ping_v0") {
    const payload = { ok: true, ts: new Date().toISOString() };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }

  if (name === "mova_run_npm_v0") {
    const parsed = RunNpmInputSchema.safeParse(rawArgs || {});
    if (!parsed.success) {
      throw new Error("DENY: invalid input");
    }
    const result = await runNpmScript(parsed.data.script, parsed.data.args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }

  if (name === "mova_run_envelope_v0") {
    const parsed = RunEnvelopeInputSchema.safeParse(rawArgs || {});
    if (!parsed.success) {
      throw new Error("DENY: invalid input");
    }
    const baseUrl = requireEnv("MOVA_GATEWAY_BASE_URL");
    const token = requireEnv("MOVA_GATEWAY_AUTH_TOKEN");
    const url = buildUrl(baseUrl, parsed.data.path);
    const payload = { ...parsed.data.body, mode: parsed.data.mode };
    const result = await fetchJsonWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-idempotency-key": parsed.data.idempotency_key
        },
        body: JSON.stringify(payload)
      },
      parsed.data.timeout_ms
    );
    const gwRequestId = result.headers.get("x-gw-request-id");
    const responsePayload = {
      http_status: result.http_status,
      gw_request_id: gwRequestId,
      json: result.json,
      duration_ms: result.duration_ms
    };
    return { content: [{ type: "text", text: JSON.stringify(responsePayload) }] };
  }

  if (name === "mova_search_episodes_v0") {
    const parsed = SearchEpisodesInputSchema.safeParse(rawArgs || {});
    if (!parsed.success) {
      throw new Error("DENY: invalid input");
    }
    const baseUrl = requireEnv("MOVA_MEMORY_BASE_URL");
    const token = requireEnv("MOVA_MEMORY_AUTH_TOKEN");
    const url = buildUrl(baseUrl, "/episode/search");
    const result = await fetchJsonWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filter: parsed.data.filter,
          limit: parsed.data.limit
        })
      },
      30000
    );
    const responsePayload = {
      http_status: result.http_status,
      json: result.json,
      duration_ms: result.duration_ms
    };
    return { content: [{ type: "text", text: JSON.stringify(responsePayload) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

process.on("uncaughtException", (err) => {
  console.error(err);
});

process.on("unhandledRejection", (err) => {
  console.error(err);
});

const transport = new StdioServerTransport();
await server.connect(transport);
