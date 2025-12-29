import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const codexSkillsRoot = path.join(repoRoot, ".codex", "skills");

function statSafe(p) { try { return fs.statSync(p); } catch { return null; } }
function existsDir(p) { const st = statSafe(p); return !!st && st.isDirectory(); }
function existsFile(p) { const st = statSafe(p); return !!st && st.isFile(); }

function countFiles(dir) {
  if (!existsDir(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) count += 1;
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
  }
  return count;
}

console.log("[codex_skills_audit]");
console.log("root:", path.relative(repoRoot, codexSkillsRoot) || ".");

if (!existsDir(codexSkillsRoot)) {
  console.log("status: missing");
  process.exit(0);
}

const skills = fs.readdirSync(codexSkillsRoot, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

for (const name of skills) {
  const base = path.join(codexSkillsRoot, name);
  const mdPath = path.join(base, "SKILL.md");
  const mdStat = statSafe(mdPath);
  const scriptsDir = path.join(base, "scripts");
  const scriptsCount = countFiles(scriptsDir);
  console.log(`- ${name}: SKILL.md ${mdStat ? mdStat.size : 0} bytes; scripts: ${existsDir(scriptsDir) ? `yes (${scriptsCount})` : "no"}`);
}
