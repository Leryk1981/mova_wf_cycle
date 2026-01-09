#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = path.join(
  repoRoot,
  "packs",
  "agent_runner_v0",
  "ds",
  "env.agent_runner_execute_request_v0.json"
);
const defaultRequest = path.join(
  repoRoot,
  "packs",
  "agent_runner_v0",
  "docs",
  "examples",
  "pos",
  "agent_runner_request_min.json"
);

function getArg(key) {
  const idx = process.argv.indexOf(key);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function tokenizeCommand(command) {
  const tokens = [];
  const regex = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\\s]+/g;
  let match;
  while ((match = regex.exec(command)) !== null) {
    let token = match[0];
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    tokens.push(token);
  }
  return tokens;
}

function parseCommand(command) {
  const tokens = tokenizeCommand(command || "");
  if (!tokens.length) {
    throw new Error("ERR_INVALID_CONTROL_MCP_COMMAND");
  }
  const [cmd, ...args] = tokens;
  return { command: cmd, args };
}

function ensureFile(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(message);
  }
}

function rel(target) {
  return path.relative(repoRoot, target).replace(/\\/g, "/");
}

function writeLog(logPath, message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function parseToolOutput(result) {
  if (!result?.content || !Array.isArray(result.content) || !result.content.length) {
    return null;
  }
  const first = result.content[0];
  if (first.type !== "text") {
    return null;
  }
  try {
    return JSON.parse(first.text);
  } catch {
    return { raw: first.text };
  }
}

function writeJsonFile(filePath, payload, maxLen) {
  const content = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const truncated = Buffer.byteLength(content, "utf8") > maxLen;
  const final = truncated ? content.slice(0, maxLen) : content;
  fs.writeFileSync(filePath, final, "utf8");
  return { path: filePath, truncated };
}

async function main() {
  const requestPath = getArg("--request") || defaultRequest;
  if (!fs.existsSync(requestPath)) {
    console.error("[agent_runner] request file missing", requestPath);
    process.exit(1);
  }

  const schemaRaw = fs.readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(request)) {
    const message = (validate.errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`ERR_REQUEST_SCHEMA ${message}`);
  }

  const limits = {
    timeout_ms: request.limits.timeout_ms ?? 60000,
    max_json_bytes: request.limits.max_json_bytes ?? 50000
  };

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactsDir = path.join(repoRoot, "artifacts", "agent_runner", runId);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const logPath = path.join(artifactsDir, "logs.txt");
  writeLog(logPath, `request ${rel(requestPath)}`);
  const requestCopy = path.join(artifactsDir, "request.json");
  fs.writeFileSync(requestCopy, JSON.stringify(request, null, 2), "utf8");

  const result = {
    status: "ok",
    request_id: request.request_id || `agent_runner-${runId}`,
    run_id: runId,
    pipeline_stage: request.pipeline_stage,
    role_id: request.role_id,
    summary: "",
    artifact_refs: [rel(requestCopy)],
    mcp_calls: [],
    error: null,
    created_at: new Date().toISOString()
  };

  const bundleDir = path.resolve(request.agent_bundle_dir);
  const policyPath = path.join(bundleDir, "mova", "policy", "policy.v0.json");
  const registryPath = path.join(bundleDir, "mova", "registry", "registry.jsonl");
  const rolesPath = path.join(bundleDir, "mova", "roles", "role_bundles_v0.json");
  const pipelinePath = path.join(bundleDir, "mova", "pipeline", "pipeline_v0.json");
  try {
    ensureFile(policyPath, "ERR_BUNDLE_POLICY missing policy.v0.json");
    ensureFile(registryPath, "ERR_BUNDLE_REGISTRY missing registry.jsonl");
    ensureFile(rolesPath, "ERR_BUNDLE_ROLES missing role_bundles_v0.json");
    ensureFile(pipelinePath, "ERR_BUNDLE_PIPELINE missing pipeline_v0.json");
  } catch (error) {
    result.status = "error";
    result.summary = error.message;
    result.error = { code: error.message.split(" ")[0], message: error.message };
    const resultPath = path.join(artifactsDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify({ run_id: runId, artifacts_dir: rel(artifactsDir), result_path: rel(resultPath) }));
    process.exit(1);
  }

  const control = request.control_mcp;
  if (control.mode !== "stdio") {
    throw new Error("ERR_CONTROL_MCP_MODE only stdio supported");
  }
  const parsedCmd = parseCommand(control.command);
  const envNames = Array.isArray(control.env_allowlist) ? control.env_allowlist : [];
  const envFilter = { PATH: process.env.PATH || "" };
  for (const name of envNames) {
    if (name === "PATH") continue;
    if (process.env[name]) {
      envFilter[name] = process.env[name];
    }
  }
  writeLog(logPath, `control_mcp ${parsedCmd.command} args=${parsedCmd.args.join(" ")} env=${envNames.join(",")}`);

  const transport = new StdioClientTransport({
    command: parsedCmd.command,
    args: parsedCmd.args,
    env: envFilter,
    cwd: control.cwd ? path.resolve(control.cwd) : repoRoot,
    stderr: "pipe"
  });
  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      writeLog(logPath, `[control stderr] ${chunk.toString().trim()}`);
    });
  }

  const client = new Client({ name: "agent-runner", version: "0.1.0" });
  await client.connect(transport);

  async function recordCall(toolName, args) {
    const start = Date.now();
    const callRecord = {
      tool_name: toolName,
      status: "pending",
      duration_ms: 0,
      artifact_refs: []
    };
    try {
      const response = await client.callTool({ name: toolName, arguments: args });
      const parsed = parseToolOutput(response) ?? response;
      const artifactName = path.join(
        artifactsDir,
        `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`
      );
      writeJsonFile(artifactName, parsed, limits.max_json_bytes);
      const duration = Date.now() - start;
      callRecord.status = "ok";
      callRecord.duration_ms = duration;
      callRecord.artifact_refs = [rel(artifactName)];
      result.mcp_calls.push(callRecord);
      writeLog(logPath, `${toolName} ok ${duration}ms`);
      return { success: true, parsed };
    } catch (error) {
      const duration = Date.now() - start;
      callRecord.status = "error";
      callRecord.duration_ms = duration;
      result.mcp_calls.push(callRecord);
      writeLog(logPath, `${toolName} fail ${error.message}`);
      return { success: false, error };
    }
  }

  try {
    const ping = await recordCall("mova_ping_v0", {});
    if (!ping.success) {
      throw ping.error;
    }
    const actionId = request.task?.action_id || "noop";
    const summaries = [];
    let firstCallError = null;
    if (request.pipeline_stage === "plan") {
      const planPath = request.task?.policy_check_path || "/api/mova.policy.check";
      const planOutcome = await recordCall("mova_run_envelope_v0", {
        path: planPath,
        body: {
          policy_path: rel(policyPath),
          registry_path: rel(registryPath),
          action_id: actionId,
          role_id: request.role_id,
          input: request.task?.input || {},
          stage: "plan"
        },
        idempotency_key: request.task?.idempotency_key || `${result.request_id}-plan`,
        mode: "dry_run",
        timeout_ms: limits.timeout_ms
      });
      if (planOutcome.success) {
        summaries.push("plan: ok");
      } else {
        summaries.push(`plan: skipped (${planOutcome.error.message})`);
        firstCallError = firstCallError || planOutcome.error;
      }
    }
    if (request.pipeline_stage === "execute") {
      const execPath = request.task?.execute_path || "/api/mova.run_action";
      const execOutcome = await recordCall("mova_run_envelope_v0", {
        path: execPath,
        body: {
          policy_path: rel(policyPath),
          registry_path: rel(registryPath),
          action_id: actionId,
          role_id: request.role_id,
          input: request.task?.input || {},
          stage: "execute"
        },
        idempotency_key: request.task?.idempotency_key || `${result.request_id}-exec`,
        mode: request.task?.mode || "live",
        timeout_ms: limits.timeout_ms
      });
      if (execOutcome.success) {
        summaries.push("execute: ok");
      } else {
        summaries.push(`execute: skipped (${execOutcome.error.message})`);
        firstCallError = firstCallError || execOutcome.error;
      }
    }
    if (request.pipeline_stage === "verify") {
      const verifyOutcome = await recordCall("mova_search_episodes_v0", {
        filter: request.task?.verify_filter || { request_id: result.request_id },
        limit: request.task?.verify_limit || 20
      });
      if (verifyOutcome.success) {
        summaries.push("verify: ok");
      } else {
        summaries.push(`verify: skipped (${verifyOutcome.error.message})`);
        firstCallError = firstCallError || verifyOutcome.error;
      }
    }
    if (request.pipeline_stage === "notarize") {
      const exportPath = request.task?.notarize_path || "/api/mova.export_pack";
      const notaryOutcome = await recordCall("mova_run_envelope_v0", {
        path: exportPath,
        body: {
          policy_path: rel(policyPath),
          registry_path: rel(registryPath),
          role_id: request.role_id,
          stage: "notarize"
        },
        idempotency_key: request.task?.idempotency_key || `${result.request_id}-notary`,
        mode: "live",
        timeout_ms: limits.timeout_ms
      });
      if (notaryOutcome.success) {
        summaries.push("notarize: ok");
      } else {
        const fallbackPath = path.join(artifactsDir, "notary_report.json");
        fs.writeFileSync(
          fallbackPath,
          JSON.stringify({ status: "local", message: notaryOutcome.error.message }, null, 2),
          "utf8"
        );
        result.artifact_refs.push(rel(fallbackPath));
        summaries.push(`notarize: fallback (${notaryOutcome.error.message})`);
        writeLog(logPath, `notarize fallback ${notaryOutcome.error.message}`);
        firstCallError = firstCallError || notaryOutcome.error;
      }
    }
    if (!firstCallError) {
      result.summary = summaries.join("; ") || "completed";
    } else {
      result.summary = summaries.join("; ");
      if (result.status === "ok") {
        result.status = "denied";
        result.error = {
          code: firstCallError.code || firstCallError.name || "ERR_MCP_CALL",
          message: firstCallError.message
        };
      }
    }
  } catch (error) {
    result.status = "error";
    result.summary = `failed: ${error.message}`;
    result.error = {
      code: error.code || "ERR_AGENT_RUNNER",
      message: error.message
    };
  } finally {
    await client.close();
    const resultPath = path.join(artifactsDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    result.artifact_refs.push(rel(logPath));
    result.artifact_refs.push(rel(resultPath));
    writeLog(logPath, `result ${result.status}`);
    console.log(
      JSON.stringify({
        run_id: runId,
        artifacts_dir: rel(artifactsDir),
        result_path: rel(resultPath),
        status: result.status
      })
    );
    process.exit(result.status === "error" ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
