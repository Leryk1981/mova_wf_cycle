#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const generatorScript = path.join(repoRoot, "packs", "agent_profile_v0", "tools", "agent_profile_generate_v0.mjs");
const defaultRequest = path.join(repoRoot, "packs", "agent_profile_v0", "docs", "examples", "pos", "agent_profile_request_min.json");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function rel(target) {
  return path.relative(repoRoot, target).replace(/\\/g, "/");
}

function runGenerator(requestPath) {
  const child = spawnSync(process.execPath, [generatorScript, "--request", requestPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (child.status !== 0) {
    console.error(child.stdout ?? "", child.stderr ?? "");
    process.exit(child.status ?? 1);
  }
  try {
    return JSON.parse(child.stdout || "{}");
  } catch (err) {
    throw new Error(`ship: failed to parse generator output: ${err.message}`);
  }
}

function computeFiles(bundleRoot) {
  const files = [];
  const stack = [bundleRoot];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = path.relative(bundleRoot, resolved).replace(/\\/g, "/");
      const buffer = fs.readFileSync(resolved);
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      files.push({ rel_path: relPath, bytes: buffer.length, sha256: hash });
    }
  }
  return files.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
}

function run() {
  const requestPath = getArg("--request") || defaultRequest;
  if (!fs.existsSync(requestPath)) {
    throw new Error(`ship: request file missing: ${requestPath}`);
  }
  const generatorOutput = runGenerator(requestPath);
  const bundleDir = path.join(repoRoot, generatorOutput?.bundle_dir || "");
  if (!bundleDir || !fs.existsSync(bundleDir)) {
    throw new Error("ship: generator did not produce bundle directory");
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const shipRoot = path.join(repoRoot, "artifacts", "agent_ship", runId);
  const bundleTarget = path.join(shipRoot, "bundle");
  ensureDir(bundleTarget);
  fs.cpSync(bundleDir, bundleTarget, { recursive: true });

  const manifest = {
    agent_id: "agent_profile",
    mova_version: "4.1.1",
    created_at: new Date().toISOString(),
    files: computeFiles(bundleTarget)
  };
  const manifestPath = path.join(shipRoot, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const result = {
    run_id: runId,
    manifest: rel(manifestPath),
    bundle_dir: rel(bundleTarget)
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

try {
  run();
} catch (error) {
  console.error(`[ship_agent_profile] ${error.message}`);
  process.exit(1);
}
