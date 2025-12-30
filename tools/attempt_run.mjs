#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

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
  if (typeof value === "string") return template(value, map);
  return value;
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
  const env = { ...process.env, ...(config.env || {}) };

  const startedAt = new Date();
  const result = spawnSync(command, argsExpanded, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  fs.writeFileSync(path.join(attemptDir, "stdout.log"), result.stdout ?? "", "utf8");
  fs.writeFileSync(path.join(attemptDir, "stderr.log"), result.stderr ?? "", "utf8");

  const copySummary = [];
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
      }
    } catch (err) {
      record.error = err.message;
    }
    copySummary.push(record);
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

  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error("[attempt_run] FAIL:", err.message);
  process.exit(1);
});
