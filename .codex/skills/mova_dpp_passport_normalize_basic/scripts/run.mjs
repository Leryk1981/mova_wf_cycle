import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const entrypoint = path.resolve(repoRoot, "skills/dpp_passport_normalize_basic/impl/code/run_normalize.js");
const args = process.argv.slice(2);
const child = spawnSync(process.execPath, [entrypoint, ...args], { stdio: "inherit" });
process.exit(child.status ?? 1);
