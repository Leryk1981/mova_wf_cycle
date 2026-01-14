#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadStationRegistry, resolvePackPathAbs } from "../../../../tools/station_registry_helpers_v0.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const registry = loadStationRegistry(repoRoot);
const packDir = resolvePackPathAbs(repoRoot, "domain_pack_scaffold_v0", registry);
const generator = path.join(packDir, "tools", "domain_pack_scaffold_generate_v0.mjs");
const requestPath = path.join(packDir, "docs", "examples", "pos", "domain_pack_scaffold_request_min.json");

const child = spawnSync(process.execPath, [generator, "--request", requestPath], {
  cwd: repoRoot,
  encoding: "utf8"
});
if (child.status !== 0) {
  console.error(child.stderr || child.stdout || "domain_pack_scaffold generator failed");
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
