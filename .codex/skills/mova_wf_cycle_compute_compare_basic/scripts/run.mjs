import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

const TARGET = "skills/wf_cycle_compute_compare_basic/impl/bindings/node/compute_compare.mjs";

const targetAbs = path.resolve(repoRoot, TARGET);

const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [targetAbs, ...args], { stdio: "inherit" });

process.exit(r.status ?? 1);
