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
