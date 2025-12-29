import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const entrypoint = path.resolve(repoRoot, "skills/wf_cycle_compute_compare_basic/impl/bindings/node/compute_compare.mjs");
const args = process.argv.slice(2);
const child = spawnSync(process.execPath, [entrypoint, ...args], { stdio: "inherit" });
process.exit(child.status ?? 1);
