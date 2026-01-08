#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const generator = path.join(repoRoot, "packs", "agent_template_v0", "tools", "agent_template_generate_v0.mjs");
const requestPath = path.join(repoRoot, "packs", "agent_template_v0", "docs", "examples", "pos", "agent_template_request_min.json");

const child = spawnSync(process.execPath, [generator, "--request", requestPath], {
  cwd: repoRoot,
  encoding: "utf8"
});
if (child.status !== 0) {
  console.error(child.stderr || child.stdout || "agent_template generator failed");
  process.exit(child.status ?? 1);
}
let result;
try {
  result = JSON.parse(child.stdout || "{}");
} catch (error) {
  console.error("failed to parse generator output", error.message);
  process.exit(1);
}
const bundleDir = result.bundle_dir ? path.resolve(repoRoot, result.bundle_dir) : null;
console.log(`bundle_dir: ${bundleDir || result.bundle_dir || "(unknown)"}`);
console.log(`artifact run_id: ${result.run_id || "(unknown)"}`);
process.exit(0);
