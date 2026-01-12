#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = process.cwd();

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") parsed.config = argv[++i];
    else if (arg === "--label") parsed.label = argv[++i];
    else if (arg === "--help" || arg === "-h") parsed.help = true;
  }
  return parsed;
}

function printHelp() {
  console.log("Usage: node tools/attempt_run.mjs --config <path/to/config.json> [--label <label>]");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeLabel(label) {
  return label.replace(/[^a-zA-Z0-9._-]/g, "_") || "attempt";
}

function template(value, map) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => map[key] ?? "");
}

function expand(value, map) {
  if (Array.isArray(value)) return value.map((v) => expand(v, map));
  if (value && typeof value === "object") {
    const clone = {};
    for (const [k, v] of Object.entries(value)) clone[k] = expand(v, map);
    return clone;
  }
  if (typeof value === "string") return template(value, map);
  return value;
}

const RESULT_METADATA_KEYS = new Set(["metadata", "meta"]);

function stripResultMetadata(item) {
  if (Array.isArray(item)) {
    return item.map(stripResultMetadata);
  }
  if (item && typeof item === "object") {
    const cleaned = {};
    for (const [key, value] of Object.entries(item)) {
      if (RESULT_METADATA_KEYS.has(key)) continue;
      cleaned[key] = stripResultMetadata(value);
    }
    return cleaned;
  }
  return item;
}

function buildResultCore(result) {
  if (!result || typeof result !== "object") return result;
  return stripResultMetadata(result);
}

function gitCommitSha() {
  try {
    const res = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (res.status === 0) return res.stdout.trim();
  } catch {
    /* noop */
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.config) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  const configPath = path.resolve(repoRoot, args.config);
  const config = loadJson(configPath);
  const label = sanitizeLabel(args.label || config.label || "attempt");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const attemptDir = path.join(repoRoot, "artifacts", "attempts", label, runId);
  ensureDir(attemptDir);

  const replacements = {
    ATTEMPT_DIR: path.relative(repoRoot, attemptDir).replace(/\\/g, "/"),
    ATTEMPT_LABEL: label,
    ATTEMPT_RUN_ID: runId,
  };

  const command = config.command || "node";
  const argsExpanded = expand(config.args || [], replacements);
  const captures = expand(config.captures || [], replacements);
  const runtimeEnv = { ...process.env, ...(config.env_vars || {}) };

  const startedAt = new Date();
  const result = spawnSync(command, argsExpanded, {
    cwd: repoRoot,
    env: runtimeEnv,
    encoding: "utf8",
  });

  fs.writeFileSync(path.join(attemptDir, "stdout.log"), result.stdout ?? "", "utf8");
  fs.writeFileSync(path.join(attemptDir, "stderr.log"), result.stderr ?? "", "utf8");

  const copySummary = [];
  const resultCaptures = [];
  for (const capturePath of captures) {
    const absPath = path.isAbsolute(capturePath)
      ? capturePath
      : path.join(repoRoot, capturePath);
    const record = { source: capturePath, copied: false };
    try {
      if (fs.existsSync(absPath)) {
        const destPath = path.join(attemptDir, path.basename(absPath));
        ensureDir(path.dirname(destPath));
        fs.copyFileSync(absPath, destPath);
        record.destination = path.relative(repoRoot, destPath).replace(/\\/g, "/");
        record.copied = true;
        if (path.basename(absPath) === "result.json") {
          resultCaptures.push({ runDir: path.dirname(absPath), destPath });
        }
      }
    } catch (err) {
      record.error = err.message;
    }
    copySummary.push(record);
  }

  const rootResultCorePath = path.join(attemptDir, "result_core.json");
  for (const info of resultCaptures) {
    try {
      const rawResult = JSON.parse(fs.readFileSync(info.destPath, "utf8"));
      const core = buildResultCore(rawResult);
      const serialized = JSON.stringify(core, null, 2);
      const runCorePath = path.join(info.runDir, "result_core.json");
      fs.writeFileSync(runCorePath, serialized, "utf8");
      fs.writeFileSync(rootResultCorePath, serialized, "utf8");
    } catch {
      /* ignore result_core on parse failure */
    }
  }

  const finishedAt = new Date();
  const meta = {
    label,
    run_id: runId,
    attempt_dir: path.relative(repoRoot, attemptDir).replace(/\\/g, "/"),
    command,
    args: argsExpanded,
    exit_code: result.status ?? 1,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    config_path: path.relative(repoRoot, configPath).replace(/\\/g, "/"),
    captures: copySummary,
  };
  fs.writeFileSync(path.join(attemptDir, "attempt_meta.json"), JSON.stringify(meta, null, 2), "utf8");

  if (config.copy_config !== false) {
    const destConfig = path.join(attemptDir, path.basename(configPath));
    fs.copyFileSync(configPath, destConfig);
  }

  if (config.env) {
    const envConfigExpanded = expand(config.env, replacements);
    const { schema: envSchemaRel, ...envPayload } = envConfigExpanded;
    envPayload.run_id ??= runId;
    envPayload.label ??= label;
    envPayload.runtime = {
      ...(envPayload.runtime || {}),
      command,
      args: argsExpanded,
      exit_code: result.status ?? 1,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    };
    envPayload.meta = envPayload.meta || {};
    const gitSha = gitCommitSha();
    if (gitSha) envPayload.meta.git_commit = gitSha;
    const envPath = path.join(attemptDir, "env.json");
    if (envSchemaRel) {
      const envSchemaPath = path.resolve(repoRoot, envSchemaRel);
      const envSchema = loadJson(envSchemaPath);
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(envSchema);
      if (!validate(envPayload)) {
        const message = ajv.errorsText(validate.errors, { separator: " | " });
        throw new Error(`env validation failed: ${message}`);
      }
    }
    fs.writeFileSync(envPath, JSON.stringify(envPayload, null, 2), "utf8");
  }

  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error("[attempt_run] FAIL:", err.message);
  process.exit(1);
});
