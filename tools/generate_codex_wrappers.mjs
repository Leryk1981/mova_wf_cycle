import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}

function normalizePath(value) {
  if (!value) return value;
  return value.replace(/\\/g, "/");
}

function normalizeContent(content) {
  if (typeof content !== "string") return content;
  return content.replace(/\r\n/g, "\n");
}

const skillsRel = getArg("--skills", "skills");
const outRel = getArg("--out", ".codex/skills");
const reportRel = getArg("--report", "docs/skills/CODEX_WRAPPERS_GENERATED.json");
const overwrite = process.argv.includes("--overwrite");
const checkOnly = process.argv.includes("--check");

const repoRoot = process.cwd();
const skillsRoot = path.join(repoRoot, skillsRel);
const outRoot = path.join(repoRoot, outRel);
const reportPath = path.join(repoRoot, reportRel);

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function ensureDir(p) {
  if (checkOnly) return;
  fs.mkdirSync(p, { recursive: true });
}

function rel(p) {
  return normalizePath(path.relative(repoRoot, p));
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function listSkills() {
  if (!exists(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

function collectSchemas(skillDir) {
  const dsDir = path.join(skillDir, "mova", "ds");
  const envDir = path.join(skillDir, "mova", "env");
  const lower = s => s.toLowerCase();
  const info = { request: null, result: null, env: null };
  if (exists(dsDir)) {
    const files = fs.readdirSync(dsDir).filter(f => f.endsWith(".json"));
    info.request = files.find(f => lower(f).includes("request"));
    info.result = files.find(f => lower(f).includes("result"));
    if (info.request) info.request = rel(path.join(dsDir, info.request));
    if (info.result) info.result = rel(path.join(dsDir, info.result));
  }
  if (exists(envDir)) {
    const envFiles = fs.readdirSync(envDir).filter(f => f.endsWith(".json"));
    if (envFiles.length) info.env = rel(path.join(envDir, envFiles[0]));
  }
  return info;
}

function pickNodeScript(skillDir) {
  const nodeDir = path.join(skillDir, "impl", "bindings", "node");
  if (!exists(nodeDir)) return null;
  const files = fs.readdirSync(nodeDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".mjs"))
    .map(e => e.name);
  if (!files.length) return null;
  const priorities = ["cli", "run", "compute", "build", "main", "index"];
  for (const key of priorities) {
    const candidate = files.find(f => f.toLowerCase().includes(key));
    if (candidate) return rel(path.join(nodeDir, candidate));
  }
  return rel(path.join(nodeDir, files[0]));
}

function extractEntrypointFromBinding(bindingPath) {
  const json = readJson(bindingPath);
  if (!json) return null;
  let candidate = null;
  if (typeof json.entrypoint === "string") candidate = json.entrypoint;
  else if (json.entrypoint && typeof json.entrypoint === "object") {
    candidate = json.entrypoint.path || json.entrypoint.script || json.entrypoint.file || null;
  }
  if (!candidate) return null;
  if (typeof candidate !== "string") return null;
  candidate = normalizePath(candidate);
  if (!/\.mjs$|\.js$/i.test(candidate)) return null;
  const abs = path.resolve(repoRoot, candidate);
  if (!exists(abs)) return null;
  return rel(abs);
}

function pickEntryFromBindings(skillDir) {
  const bindingsDir = path.join(skillDir, "impl", "bindings");
  if (!exists(bindingsDir)) return null;
  const files = fs.readdirSync(bindingsDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".json"))
    .map(e => path.join(bindingsDir, e.name));
  for (const bindingPath of files) {
    const entry = extractEntrypointFromBinding(bindingPath);
    if (entry) return entry;
  }
  return null;
}

function yamlEscape(value) {
  if (!value) return "";
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderSkillMd(info) {
  const lines = [];
  lines.push("---");
  lines.push(`name: "MOVA: ${info.skill_id} (wrapper)"`);
  const description = info.manifest?.description ?? `Wrapper for skills/${info.skill_id}`;
  lines.push(`description: "${yamlEscape(description)}"`);
  lines.push("when_to_use:");
  const when = info.manifest?.title
    ? `Use when "${info.manifest.title}" must run through Codex automation`
    : `Use when skills/${info.skill_id} must run through Codex automation`;
  lines.push(`  - "${yamlEscape(when)}"`);
  lines.push("inputs:");
  if (info.schemas.request) {
    lines.push("  - kind: json");
    lines.push(`    schema: "${info.schemas.request}"`);
  } else {
    lines.push("  - kind: text");
    lines.push(`    schema: "No request schema detected; see skills/${info.skill_id}"`);
  }
  lines.push("outputs:");
  const outputs = [];
  if (info.schemas.result) {
    outputs.push("  - kind: json");
    outputs.push(`    schema: "${info.schemas.result}"`);
  }
  if (info.schemas.env) {
    outputs.push("  - kind: json");
    outputs.push(`    schema: "${info.schemas.env}"`);
  }
  if (!outputs.length) {
    outputs.push("  - kind: text");
    outputs.push(`    schema: "No result/env schema detected; see skills/${info.skill_id}"`);
  }
  lines.push(...outputs);
  lines.push(`deterministic: ${info.runnable ? "true" : "false"}`);
  lines.push("---");
  lines.push("");
  if (info.runnable) {
    lines.push("## Command");
    lines.push(`\`node .codex/skills/${info.wrapper_id}/scripts/run.mjs --request <request.json>\``);
    lines.push("");
  }
  lines.push("## Notes");
  if (info.runnable) {
    lines.push(`- Underlying entrypoint: ${info.entrypoint}`);
  } else {
    lines.push("- Prompt-first wrapper, coordinate execution manually.");
  }
  const evidence = info.schemas.env ?? info.schemas.result ?? `skills/${info.skill_id}`;
  lines.push(`- Evidence paths: ${evidence}`);
  lines.push("- Generated by tools/generate_codex_wrappers.mjs; edit if custom behavior is needed.");
  return lines.join("\n");
}

function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, normalizeContent(content));
}

function maybeWrite(filePath, content) {
  if (checkOnly) return;
  if (exists(filePath) && !overwrite) return;
  const normalizedContent = normalizeContent(content);
  const current = exists(filePath) ? normalizeContent(fs.readFileSync(filePath, "utf8")) : null;
  if (!overwrite && current === normalizedContent) return;
  writeFile(filePath, normalizedContent);
}

function buildRunScript(entrypoint) {
  if (!entrypoint) return null;
  const normalizedEntrypoint = normalizePath(entrypoint);
  return `import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const entrypoint = path.resolve(repoRoot, "${normalizedEntrypoint}");
const args = process.argv.slice(2);
const child = spawnSync(process.execPath, [entrypoint, ...args], { stdio: "inherit" });
process.exit(child.status ?? 1);
`;
}

function buildMeta(info) {
  const meta = {
    skill_id: info.skill_id,
    wrapper_id: info.wrapper_id,
    runnable: info.runnable,
    entrypoint: info.entrypoint,
    request_schema: info.schemas.request,
    result_schema: info.schemas.result,
    env_schema: info.schemas.env,
    generator: "tools/generate_codex_wrappers.mjs",
  };
  return JSON.stringify(meta, null, 2);
}

function processSkill(skillId) {
  const skillDir = path.join(skillsRoot, skillId);
  const manifest = readJson(path.join(skillDir, "manifest.skill.json"));
  const schemas = collectSchemas(skillDir);
  const entrypoint = normalizePath(pickNodeScript(skillDir) ?? pickEntryFromBindings(skillDir));
  const wrapperId = `mova_${skillId}`;
  ensureDir(path.join(outRoot, wrapperId));

  const info = {
    skill_id: skillId,
    wrapper_id: wrapperId,
    manifest,
    schemas,
    entrypoint,
    runnable: !!entrypoint,
  };

  const skillMdContent = renderSkillMd(info);
  const runScriptContent = buildRunScript(info.entrypoint);
  const metaContent = buildMeta(info);

  const skillMdPath = path.join(outRoot, wrapperId, "SKILL.md");
  const runScriptPath = path.join(outRoot, wrapperId, "scripts", "run.mjs");
  const metaPath = path.join(outRoot, wrapperId, "meta.json");

  if (checkOnly) {
    checkFile(skillMdPath, skillMdContent, true);
    checkFile(metaPath, metaContent, true);
    if (info.runnable) checkFile(runScriptPath, runScriptContent, true);
  } else {
    ensureDir(path.join(outRoot, wrapperId));
    maybeWrite(skillMdPath, skillMdContent);
    if (info.runnable) {
      ensureDir(path.join(outRoot, wrapperId, "scripts"));
      maybeWrite(runScriptPath, runScriptContent);
    }
    maybeWrite(metaPath, metaContent);
  }

  return {
    skill_id: skillId,
    wrapper_id: wrapperId,
    runnable: info.runnable,
    entrypoint: entrypoint,
  };
}

const checkDiffs = [];

function checkFile(filePath, expectedContent, shouldExist) {
  const existsOnDisk = exists(filePath);
  if (!existsOnDisk && shouldExist) {
    checkDiffs.push(rel(filePath));
    return;
  }
  if (existsOnDisk && shouldExist) {
    const current = normalizeContent(fs.readFileSync(filePath, "utf8"));
    const expected = normalizeContent(expectedContent);
    if (current !== expected) checkDiffs.push(rel(filePath));
  }
}

function main() {
  if (!exists(skillsRoot)) {
    console.error("Skills directory not found:", skillsRoot);
    process.exit(1);
  }
  if (!checkOnly) {
    ensureDir(outRoot);
    ensureDir(path.dirname(reportPath));
  }

  const skillIds = listSkills();
  const report = skillIds.map(processSkill);

  if (checkOnly) {
    if (checkDiffs.length) {
      console.error("[generate_codex_wrappers] check failed for:");
      for (const diff of checkDiffs) console.error(`- ${diff}`);
      process.exit(1);
    }
    console.log(`[generate_codex_wrappers] check passed (${report.length} skills)`);
    return;
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[generate_codex_wrappers] processed ${report.length} skills (overwrite=${overwrite})`);
}

main();
