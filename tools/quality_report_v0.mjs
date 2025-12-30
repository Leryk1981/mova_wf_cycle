#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const repoRoot = process.cwd();
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

function runCommand(label, command, args, logPath) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const finished = Date.now();
  const errorOutput = result.error ? `${result.error.message}\n` : "";
  const output = `${result.stdout || ""}${result.stderr || ""}${errorOutput}`;
  fs.writeFileSync(logPath, output);
  return {
    label,
    command: [command, ...args].join(" "),
    exit_code: result.status ?? 1,
    status: result.status === 0 ? "pass" : "fail",
    duration_ms: finished - started,
    log: rel(logPath),
  };
}

function discoverWorkflows() {
  const pkgPath = path.join(repoRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const scripts = pkg.scripts || {};
  const re = /^(attempt:invoice:[^:]+):(a|b)$/;
  const workflows = new Map();
  for (const [name, script] of Object.entries(scripts)) {
    const match = name.match(re);
    if (!match) continue;
    const base = match[1];
    const variant = match[2];
    if (!workflows.has(base)) workflows.set(base, { base, scripts: {} });
    workflows.get(base).scripts[variant] = name;
  }
  return [...workflows.values()].filter((wf) => wf.scripts.a && wf.scripts.b);
}

function mkWorkflowName(base) {
  return base.replace(/^attempt:/, "");
}

function runWorkflow(baseDir, workflow) {
  const name = mkWorkflowName(workflow.base);
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const workDir = path.join(baseDir, "workflows", safeName);
  ensureDir(workDir);

  const attempts = {};
  for (const variant of ["a", "b"]) {
    const scriptName = workflow.scripts[variant];
    const logPath = path.join(workDir, `${safeName}_${variant}.log`);
    const result = runCommand(`${name}:${variant}`, npmBin, ["run", scriptName], logPath);
    attempts[variant] = result;
    if (result.status !== "pass") {
      return {
        name,
        attempts,
        compare: null,
        status: "fail",
      };
    }
  }

  const compareOut = path.join(workDir, `${safeName}_compare.json`);
  const compareLog = path.join(workDir, `${safeName}_compare.log`);
  const compareResult = runCommand(
    `${name}:compare`,
    "node",
    [
      "tools/attempt_compare.mjs",
      "--skill",
      name,
      "--out",
      rel(compareOut),
    ],
    compareLog
  );
  const compareStatus = compareResult.status;

  return {
    name,
    attempts,
    compare: {
      ...compareResult,
      report_path: rel(compareOut),
    },
    status:
      attempts.a.status === "pass" &&
      attempts.b.status === "pass" &&
      compareStatus === "pass"
        ? "pass"
        : "fail",
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# Quality Report – ${report.scope}`);
  lines.push("");
  lines.push(`Run ID: ${report.run_id}`);
  lines.push(`Started: ${report.started_at}`);
  lines.push(`Overall status: **${report.status.toUpperCase()}**`);
  lines.push("");
  lines.push("## Gates");
  for (const gate of report.gates) {
    lines.push(
      `- ${gate.label}: ${gate.status.toUpperCase()} (${gate.duration_ms}ms) [log](${gate.log})`
    );
  }
  lines.push("");
  lines.push("## Workflows");
  for (const wf of report.workflows) {
    const attemptAStatus = wf.attempts.a?.status || "n/a";
    const attemptBStatus = wf.attempts.b?.status || "n/a";
    lines.push(
      `- ${wf.name}: ${wf.status.toUpperCase()} – attempts: a=${attemptAStatus}, b=${attemptBStatus}, compare=${wf.compare?.status || "n/a"}`
    );
    const logParts = [`[a](${wf.attempts.a.log})`];
    if (wf.attempts.b) logParts.push(`[b](${wf.attempts.b.log})`);
    if (wf.compare) logParts.push(`[compare](${wf.compare.log})`);
    lines.push(`  - logs: ${logParts.join(", ")}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const scope = args.includes("--scope")
    ? args[args.indexOf("--scope") + 1] || "invoice_ap"
    : "invoice_ap";

  const workflows = discoverWorkflows();
  if (!workflows.length) {
    console.error("[quality_report] No workflows found");
    process.exit(1);
  }

  const runId = timestampId();
  const baseDir = path.join(repoRoot, "artifacts", "quality", runId);
  ensureDir(baseDir);

  const report = {
    scope,
    run_id: runId,
    started_at: new Date().toISOString(),
    gates: [],
    workflows: [],
    status: "pass",
  };

  const gatesDir = path.join(baseDir, "gates");
  ensureDir(gatesDir);
  const gateCommands = [
    { label: "npm run validate", args: ["run", "validate"] },
    { label: "npm test", args: ["test"] },
    { label: "npm run smoke:wf_cycle", args: ["run", "smoke:wf_cycle"] },
    { label: "npm run codex:wrappers:check", args: ["run", "codex:wrappers:check"] },
  ];

  for (const gate of gateCommands) {
    const logPath = path.join(
      gatesDir,
      gate.label.replace(/[^a-zA-Z0-9._-]/g, "_") + ".log"
    );
    const result = runCommand(gate.label, npmBin, gate.args, logPath);
    report.gates.push(result);
    if (result.status !== "pass") {
      report.status = "fail";
    }
  }

  const workflowsDir = path.join(baseDir, "workflows");
  ensureDir(workflowsDir);
  for (const wf of workflows) {
    const wfResult = runWorkflow(baseDir, wf);
    report.workflows.push(wfResult);
    if (wfResult.status !== "pass") {
      report.status = "fail";
    }
  }

  report.finished_at = new Date().toISOString();

  const jsonPath = path.join(baseDir, "quality_report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const mdPath = path.join(baseDir, "quality_report.md");
  fs.writeFileSync(mdPath, buildMarkdown(report));

  console.log("[quality_report] wrote:");
  console.log(`- ${rel(jsonPath)}`);
  console.log(`- ${rel(mdPath)}`);

  if (report.status !== "pass") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[quality_report] FAIL:", err.message);
  process.exit(1);
});
