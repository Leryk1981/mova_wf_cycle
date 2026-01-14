#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStationRegistry, resolvePackPathAbs } from "../../../../tools/station_registry_helpers_v0.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const registry = loadStationRegistry(repoRoot);
const scaffoldPackDir = resolvePackPathAbs(repoRoot, "domain_pack_scaffold_v0", registry);
const qualityPackDir = resolvePackPathAbs(repoRoot, "domain_pack_quality_v0", registry);

const demoPackPath = path.join(repoRoot, "artifacts", "domain_pack_scaffold", "demo_pack_v0");
if (!existsSync(demoPackPath)) {
  console.log("Generating demo scaffold pack...");
  execSync(`node ${path.join(scaffoldPackDir, "tools", "demo_domain_pack_scaffold_v0.mjs")}`, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

const envPath = path.join(qualityPackDir, "ds", "env.domain_pack_quality_request_v0.json");
execSync(`node ${path.join(qualityPackDir, "tools", "domain_pack_quality_v0.mjs")} ${envPath}`, {
  cwd: repoRoot,
  stdio: "inherit"
});

console.log("Demo completed successfully");
