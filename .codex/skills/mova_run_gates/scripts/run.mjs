import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const repoRoot = process.cwd();
const artifactsRoot = path.join(repoRoot, "artifacts", "run_gates");
fs.mkdirSync(artifactsRoot, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(artifactsRoot, timestamp);
fs.mkdirSync(runDir, { recursive: true });

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  { name: "validate", args: ["run", "validate"], label: "npm run validate" },
  { name: "test", args: ["test"], label: "npm test" },
  { name: "smoke", args: ["run", "smoke:wf_cycle"], label: "npm run smoke:wf_cycle" },
];

const report = {
  skill: "mova_run_gates",
  started_at: new Date().toISOString(),
  artifacts_dir: path.relative(repoRoot, runDir).replace(/\\/g, "/"),
  steps: [],
};

const spawnOptions = { cwd: repoRoot, encoding: "utf8", shell: false };

function runNpm(args) {
  let child = spawnSync(npmCmd, args, spawnOptions);
  if (child.error) {
    child = spawnSync(npmCmd, args, { ...spawnOptions, shell: true });
  }
  return child;
}

let failed = false;

for (const step of steps) {
  const logPath = path.join(runDir, `${step.name}.log`);
  const relLog = path.relative(repoRoot, logPath).replace(/\\/g, "/");

  if (failed) {
    const msg = `skipped because ${report.failure_step} failed\n`;
    fs.writeFileSync(logPath, msg, "utf8");
    report.steps.push({
      name: step.name,
      command: step.label,
      status: "skipped",
      exit_code: null,
      duration_ms: 0,
      log: relLog,
    });
    continue;
  }

  const started = performance.now();
  const child = runNpm(step.args);
  const duration = Math.round(performance.now() - started);
  const chunks = [];
  if (child.stdout) chunks.push(child.stdout);
  if (child.stderr) chunks.push(child.stderr);
  if (child.error) chunks.push(`[spawn error] ${child.error.message}\n`);
  const output = chunks.join("") || "no output captured\n";
  fs.writeFileSync(logPath, output, "utf8");
  const exitCode = typeof child.status === "number" ? child.status : (child.error ? 1 : 0);
  const status = exitCode === 0 ? "pass" : "fail";

  report.steps.push({
    name: step.name,
    command: step.label,
    status,
    exit_code: exitCode,
    duration_ms: duration,
    log: relLog,
  });

  if (status === "fail") {
    failed = true;
    report.failure_step = step.name;
  }
}

report.finished_at = new Date().toISOString();
report.status = failed ? "fail" : "pass";

const reportPath = path.join(runDir, "run_gates_report.json");
report.report_path = path.relative(repoRoot, reportPath).replace(/\\/g, "/");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));

process.exit(failed ? 1 : 0);
