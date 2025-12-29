import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

const TARGET = "skills/wf_cycle_winner_pack_basic/impl/bindings/node/build_winner_pack.mjs";

const targetAbs = path.resolve(repoRoot, TARGET);

const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [targetAbs, ...args], { stdio: "inherit" });

process.exit(r.status ?? 1);
