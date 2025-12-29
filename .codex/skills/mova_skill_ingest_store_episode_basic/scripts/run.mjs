import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const entrypoint = path.resolve(repoRoot, "skills/skill_ingest_store_episode_basic/impl/code/store_episode.js");
const args = process.argv.slice(2);
const child = spawnSync(process.execPath, [entrypoint, ...args], { stdio: "inherit" });
process.exit(child.status ?? 1);
