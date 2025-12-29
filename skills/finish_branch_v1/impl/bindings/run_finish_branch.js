const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const process = require("node:process");

const repoRoot = process.cwd();
const defaultRequest = {
  base_branch: "origin/main",
  include_git_log: true,
  include_diffstat: true,
  max_commits: 10,
  mode: "preflight"
};

const commandEntries = [];

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function rel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

function runCommand(cmd, args) {
  const started = new Date().toISOString();
  const result = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  commandEntries.push({
    timestamp: started,
    command: [cmd, ...args].join(" "),
    exitCode: result.status ?? 0,
    stdout: (result.stdout || "").trimEnd(),
    stderr: (result.stderr || "").trimEnd()
  });
  return result;
}

function parseJsonFile(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function parseCount(output) {
  const num = parseInt(String(output || "").trim(), 10);
  return Number.isFinite(num) ? num : 0;
}

function ensureNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeMode(value) {
  const mode = typeof value === "string" ? value.toLowerCase() : "";
  if (mode === "preflight") return "preflight";
  if (mode === "report") return "report";
  return "preflight";
}

const requestArg = getArgValue("--request");
const requestPayload = requestArg ? parseJsonFile(path.resolve(repoRoot, requestArg)) : {};
const request = { ...defaultRequest, ...requestPayload };
if (!request.target_branch || !request.target_branch.trim()) {
  request.target_branch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
}
if (!request.base_branch || !request.base_branch.trim()) {
  request.base_branch = defaultRequest.base_branch;
}
request.max_commits = ensureNumber(request.max_commits, defaultRequest.max_commits);
request.mode = normalizeMode(request.mode || defaultRequest.mode);

const runId = new Date().toISOString().replace(/:/g, "-");
const artifactsDir = path.join(repoRoot, "artifacts", "finish_branch", runId);
fs.mkdirSync(artifactsDir, { recursive: true });

const startedAt = new Date().toISOString();
const statusOutput = runCommand("git", ["status", "-sb"]).stdout.trim();
const statusLines = statusOutput.split(/\r?\n/).filter(Boolean);
const workspaceLines = statusLines.filter((line, idx) => idx === 0 ? false : true);
const workspaceClean = workspaceLines.length === 0;

let ahead = 0;
let behind = 0;
const lrOutput = runCommand("git", ["rev-list", "--left-right", "--count", `${request.base_branch}...${request.target_branch}`]).stdout.trim();
if (lrOutput) {
  const parts = lrOutput.split(/\s+/);
  if (parts.length >= 2) {
    behind = parseCount(parts[0]);
    ahead = parseCount(parts[1]);
  }
}

let gitLog = "";
if (request.include_git_log !== false) {
  gitLog = runCommand(
    "git",
    ["log", "--oneline", "--decorate", `${request.base_branch}..${request.target_branch}`, "-n", String(request.max_commits)]
  ).stdout.trim();
}
let diffstat = "";
if (request.include_diffstat !== false) {
  diffstat = runCommand("git", ["diff", "--stat", `${request.base_branch}..${request.target_branch}`]).stdout.trim();
}

const reasons = [];
let status = "ready";
if (behind > 0) {
  status = "needs_rebase";
  reasons.push(`Behind ${behind} commits from ${request.base_branch}`);
}
if (!workspaceClean) {
  status = status === "ready" ? "dirty_workspace" : status;
  reasons.push("Working tree has pending changes");
}
const summary = reasons.length ? reasons.join("; ") : "Branch is ready for PR.";
const recommendedActions = [];
if (request.mode === "preflight" && !workspaceClean) {
  recommendedActions.push("Working tree is dirty; stash or commit pending changes before PR.");
  if (behind > 0) {
    recommendedActions.push(`Update branch with ${request.base_branch} to drop ${behind} pending commits.`);
  }
  if (ahead === 0) {
    recommendedActions.push("No commits ahead of base; push actual changes before requesting review.");
  }
}

const reportJsonPath = path.join(artifactsDir, "finish_branch_report.json");
const reportMdPath = path.join(artifactsDir, "finish_branch_report.md");
const commandsLogPath = path.join(artifactsDir, "commands.log");

const finishedAt = new Date().toISOString();

const report = {
  skill: "finish_branch_v1",
  run_id: runId,
  status,
  started_at: startedAt,
  finished_at: finishedAt,
  artifacts_dir: rel(artifactsDir),
  request_path: requestArg ? rel(path.resolve(repoRoot, requestArg)) : null,
  report_json: rel(reportJsonPath),
  report_md: rel(reportMdPath),
  commands_log: rel(commandsLogPath),
  branch: {
    base: request.base_branch,
    target: request.target_branch,
    ahead_commits: ahead,
    behind_commits: behind,
    workspace_clean: workspaceClean
  },
  git_status: statusOutput,
  git_log: gitLog,
  diffstat,
  notes: request.notes || summary,
  recommended_actions: recommendedActions,
  request
};

const logLines = commandEntries.map((entry, idx) => {
  return `[#${idx + 1}] ${entry.timestamp} $ ${entry.command}\nexit_code: ${entry.exitCode}\nstdout:\n${entry.stdout || "(empty)"}\n---\nstderr:\n${entry.stderr || "(empty)"}`;
});
fs.writeFileSync(commandsLogPath, logLines.join("\n\n") + "\n");

const mdLines = [];
mdLines.push("# Finish branch readiness");
mdLines.push("");
mdLines.push(`- Run ID: ${runId}`);
mdLines.push(`- Status: ${status}`);
mdLines.push(`- Base branch: ${request.base_branch}`);
mdLines.push(`- Target branch: ${request.target_branch}`);
mdLines.push(`- Ahead commits: ${ahead}`);
mdLines.push(`- Behind commits: ${behind}`);
mdLines.push(`- Workspace clean: ${workspaceClean ? "yes" : "no"}`);
mdLines.push(`- Summary: ${summary}`);
if (request.notes) mdLines.push(`- Operator notes: ${request.notes}`);
if (recommendedActions.length) {
  mdLines.push("");
  mdLines.push("## Recommended actions");
  for (const action of recommendedActions) mdLines.push(`- ${action}`);
}
mdLines.push("");
mdLines.push("## Git status");
mdLines.push("```");
mdLines.push(statusOutput || "(no output)");
mdLines.push("```");
mdLines.push("");
if (request.include_git_log === false) {
  mdLines.push("## Git log");
  mdLines.push("(skipped)");
} else {
  mdLines.push("## Git log");
  mdLines.push("```");
  mdLines.push(gitLog || "(no commits ahead of base)");
  mdLines.push("```");
}
mdLines.push("");
if (request.include_diffstat === false) {
  mdLines.push("## Diffstat");
  mdLines.push("(skipped)");
} else {
  mdLines.push("## Diffstat");
  mdLines.push("```");
  mdLines.push(diffstat || "(no diff)");
  mdLines.push("```");
}
mdLines.push("");
mdLines.push("## Next steps");
if (status === "ready") {
  mdLines.push("- Prepare PR and run final CI gate");
} else {
  mdLines.push(`- Resolve: ${summary}`);
}
fs.writeFileSync(reportMdPath, mdLines.join("\n"));

fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));

const consoleOutput = {
  skill: report.skill,
  run_id: runId,
  status,
  report_json: report.report_json,
  report_md: report.report_md,
  commands_log: report.commands_log,
  branch: report.branch,
  summary,
  recommended_actions: recommendedActions
};

console.log(JSON.stringify(consoleOutput, null, 2));
