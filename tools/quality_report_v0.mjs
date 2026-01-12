#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath ? path.normalize(process.env.npm_execpath) : null;

function parseArgs(argv) {
  const parsed = { scope: "invoice_ap", negative: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--scope") parsed.scope = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--negative") parsed.negative = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
  }
  return parsed;
}

function printHelp() {
  console.log("Usage: node tools/quality_report_v0.mjs [--scope invoice_ap] [--negative]");
}

function readPackageJson() {
  const pkgPath = path.join(repoRoot, "package.json");
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
}

function relRepo(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runCommand(command, args, logPath, env = {}) {
  ensureDir(path.dirname(logPath));
  const started = Date.now();
  let child;
  try {
    child = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  } catch (err) {
    child = { status: null, stdout: "", stderr: err.message, error: err };
  }
  const duration = Date.now() - started;
  const combined = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  fs.writeFileSync(logPath, combined || "(no output)\n", "utf8");
  return {
    command: `${command} ${args.join(" ")}`.trim(),
    exit_code: child.status ?? 1,
    status: child.status === 0 ? "pass" : "fail",
    duration_ms: duration,
    log: relRepo(logPath),
    error: child.error?.message,
  };
}

function runNpmCommand(args, logPath) {
  if (npmCliPath && fs.existsSync(npmCliPath)) {
    return runCommand(process.execPath, [npmCliPath, ...args], logPath);
  }
  return runCommand(npmCmd, args, logPath);
}

function discoverWorkflows(scope) {
  const pkg = readPackageJson();
  const attempts = [];
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    if (!name.startsWith("attempt:")) continue;
    const parts = name.split(":").slice(1); // drop "attempt"
    if (parts.length < 2) continue;
    const variant = parts[parts.length - 1];
    if (variant !== "a" && variant !== "b") continue;
    const baseParts = parts.slice(0, parts.length - 1);
    const base = baseParts.join(":");
    const scopeKey = scope === "invoice_ap" ? "invoice" : scope;
    if (!base.startsWith(scopeKey)) continue;
    attempts.push({ name, script, base, variant });
  }
  const grouped = new Map();
  for (const entry of attempts) {
    if (!grouped.has(entry.base)) grouped.set(entry.base, { base: entry.base });
    grouped.get(entry.base)[entry.variant === "a" ? "scriptA" : "scriptB"] = entry;
  }
  return [...grouped.values()]
    .filter((g) => g.scriptA && g.scriptB)
    .sort((a, b) => a.base.localeCompare(b.base));
}

function extractLabel(scriptValue) {
  const match = scriptValue.match(/--label(?:=|\s+)([A-Za-z0-9._-]+)/);
  return match ? match[1] : null;
}

function findLatestAttempt(label) {
  const base = path.join(repoRoot, "artifacts", "attempts", label);
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    throw new Error(`No attempts for label=${label}: ${err.message}`);
  }
  if (!dirs.length) throw new Error(`No attempts directories for label=${label}`);
  const runId = dirs[dirs.length - 1];
  const dir = path.join(base, runId);
  return {
    label,
    run_id: runId,
    dir,
    relative: relRepo(dir),
  };
}

function makeSlug(base) {
  return base.replace(/[^a-z0-9]+/gi, "_");
}

function writeMarkdown(report, outPath) {
  const lines = [];
  lines.push(`# Quality Report – ${report.scope}`);
  lines.push("");
  lines.push(`- Run: \`${report.run_id}\``);
  lines.push(`- Mode: ${report.mode}`);
  lines.push(`- Status: ${report.status}`);
  lines.push("");
  lines.push("## Gates");
  for (const gate of report.gates) {
    lines.push(`- ${gate.label}: ${gate.status.toUpperCase()} (${gate.duration_ms} ms) — log \`${gate.log}\``);
  }
  lines.push("");
  if (report.workflows?.length) {
    for (const wf of report.workflows) {
      lines.push(`## Workflow ${wf.name} – ${wf.status.toUpperCase()}`);
      lines.push(
        `- Double-run primary: ${wf.double_run.primary.status} (${wf.double_run.primary.log})`
      );
      lines.push(
        `- Double-run repeat: ${wf.double_run.repeat.status} (${wf.double_run.repeat.log})`
      );
      lines.push(
        `- Proof of Invariance (result_core): ${wf.proof_of_invariance.status} (${wf.proof_of_invariance.log})`
      );
      if (wf.invariants) {
        lines.push(`- Invariants: ${wf.invariants.status} (${wf.invariants.log})`);
      }
      lines.push("");
    }
  }
  if (report.episode_store) {
    lines.push("## Episode store");
    lines.push(`- Status: ${report.episode_store.status}`);
    lines.push(`- Request: \`${report.episode_store.request}\``);
    if (report.episode_store.response) lines.push(`- Response: \`${report.episode_store.response}\``);
    if (report.episode_store.evidence) lines.push(`- Evidence: \`${report.episode_store.evidence}\``);
    lines.push("");
  }
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

function runInvariants(workflow, attemptDir, outDir, slugName = makeSlug(workflow)) {
  const scriptLogPath = path.join(outDir, `${slugName}_invariants.log`);
  const cmdLogPath = path.join(outDir, `${slugName}_invariants_cmd.log`);
  const reportPath = path.join(outDir, `${slugName}_invariants.json`);
  const child = runCommand(process.execPath, [
    "tools/invoice_invariants_v0.mjs",
    "--workflow",
    workflow,
    "--dir",
    attemptDir,
    "--out",
    reportPath,
    "--log",
    scriptLogPath,
  ], cmdLogPath);
  child.report_path = relRepo(reportPath);
  child.log = relRepo(scriptLogPath);
  child.command_log = relRepo(cmdLogPath);
  return child;
}

function buildEpisodeEnvelope(report, baseDir) {
  const runId = report.run_id;
  const now = new Date().toISOString();
  const envelopeId = `quality_invoice_ap__${runId}`;
  return {
    mova_version: "4.1.1",
    envelope_type: "env.skill_ingest_run_store_episode_v1",
    envelope_id: envelopeId,
    requested_by: "quality_report_v1",
    requested_at: now,
    episode: {
      mova_version: "4.1.1",
      episode_id: `invoice_ap_quality__${runId}`,
      envelope_id: envelopeId,
      run_result: {
        mova_version: "4.1.1",
        run_id: runId,
        status: report.status === "pass" ? "success" : "failed",
        timing: {
          started_at: report.started_at,
          finished_at: report.finished_at,
          duration_ms: new Date(report.finished_at).getTime() - new Date(report.started_at).getTime(),
        },
        output_locations: {
          data_dir: relRepo(baseDir),
          report_json: relRepo(path.join(baseDir, "quality_report.json")),
          report_md: relRepo(path.join(baseDir, "quality_report.md")),
        },
      },
      context: {
        executor: "quality_report_v0",
        repo: path.basename(repoRoot),
        workflow_scope: report.scope,
      },
      notes: "Quality report run (invoice_ap)",
    },
  };
}

function maybeStoreEpisode(report, baseDir) {
  const episodeDir = path.join(baseDir, "episode_store");
  ensureDir(episodeDir);
  const requestPath = path.join(episodeDir, "store_episode_request.json");
  const envelope = buildEpisodeEnvelope(report, baseDir);
  fs.writeFileSync(requestPath, JSON.stringify(envelope, null, 2));
  const remoteUrl = process.env.STORE_EPISODE_REMOTE_URL;
  const remoteToken = process.env.STORE_EPISODE_REMOTE_TOKEN;
  const entry = {
    status: "skipped",
    request: relRepo(requestPath),
  };
  if (!remoteUrl || !remoteToken) {
    const evidence = {
      reason: "STORE_EPISODE_REMOTE_URL/TOKEN not configured; skipped",
      requested_at: new Date().toISOString(),
    };
    const evidencePath = path.join(episodeDir, "episode_store_evidence.json");
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    entry.evidence = relRepo(evidencePath);
    return entry;
  }
  const logPath = path.join(episodeDir, "episode_store.log");
  const out = runCommand(process.execPath, [
    "skills/skill_ingest_store_episode_basic/impl/code/store_episode.js",
    "--request",
    requestPath,
  ], logPath, {
    STORE_EPISODE_REMOTE_URL: remoteUrl,
    STORE_EPISODE_REMOTE_TOKEN: remoteToken,
  });
  entry.status = out.status;
  entry.exit_code = out.exit_code;
  entry.log = out.log;
  try {
    const stdout = fs.readFileSync(path.join(repoRoot, out.log), "utf8");
    const response = JSON.parse(stdout || "{}");
    const responsePath = path.join(episodeDir, "store_episode_response.json");
    fs.writeFileSync(responsePath, JSON.stringify(response, null, 2));
    entry.response = relRepo(responsePath);
  } catch {
    /* noop */
  }
  return entry;
}

function runPositive(scope) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const baseDir = path.join(repoRoot, "artifacts", "quality", runId);
  const startedAt = new Date();
  ensureDir(baseDir);
  const gatesDir = path.join(baseDir, "gates");
  const workflows = [];
  const report = {
    scope,
    run_id: runId,
    mode: "positive",
    started_at: startedAt.toISOString(),
    gates: [],
    workflows,
  };

  const gateCommands = [
    { label: "npm run validate", args: ["run", "validate"], log: path.join(gatesDir, "npm_run_validate.log") },
    { label: "npm run test", args: ["run", "test"], log: path.join(gatesDir, "npm_test.log") },
    { label: "npm run smoke:wf_cycle", args: ["run", "smoke:wf_cycle"], log: path.join(gatesDir, "npm_run_smoke_wf_cycle.log") },
    { label: "npm run codex:wrappers:check", args: ["run", "codex:wrappers:check"], log: path.join(gatesDir, "npm_run_codex_wrappers_check.log") },
  ];
  for (const gate of gateCommands) {
    const result = runNpmCommand(gate.args, gate.log);
    report.gates.push({ label: gate.label, ...result });
  }

  const discovered = discoverWorkflows(scope);
  for (const workflow of discovered) {
    const slug = makeSlug(workflow.base);
    const wfDir = path.join(baseDir, "workflows", slug);
    ensureDir(wfDir);
    const entry = {
      name: workflow.base,
      slug,
      double_run: {},
    };
    const labelA = extractLabel(workflow.scriptA.script) || "ide";
    const labelB = extractLabel(workflow.scriptB.script) || "cli";
    entry.double_run.primary = runNpmCommand(
      ["run", workflow.scriptA.name],
      path.join(wfDir, `${slug}_primary.log`)
    );
    entry.double_run.repeat = runNpmCommand(
      ["run", workflow.scriptB.name],
      path.join(wfDir, `${slug}_repeat.log`)
    );
    const proofLog = path.join(wfDir, `${slug}_proof_of_invariance.log`);
    const proofOut = path.join(wfDir, `${slug}_proof_of_invariance.json`);
    const proof = runCommand(process.execPath, [
      "tools/attempt_compare.mjs",
      "--label-a",
      labelA,
      "--label-b",
      labelB,
      "--skill",
      workflow.base,
      "--out",
      proofOut,
    ], proofLog);
    proof.report_path = relRepo(proofOut);
    entry.proof_of_invariance = proof;

    let invariants = { status: "fail", log: "" };
    try {
      const cliAttempt = findLatestAttempt(labelB);
      const runDir = path.join(cliAttempt.dir, "run");
      invariants = runInvariants(workflow.base, runDir, wfDir, slug);
      invariants.attempt_dir = relRepo(runDir);
    } catch (err) {
      invariants = {
        status: "fail",
        exit_code: 1,
        log: relRepo(path.join(wfDir, `${slug}_invariants_error.log`)),
        error: err.message,
      };
      fs.writeFileSync(path.join(wfDir, `${slug}_invariants_error.log`), `error: ${err.message}\n`);
    }
    entry.invariants = invariants;

    entry.status =
      entry.double_run.primary.status === "pass" &&
      entry.double_run.repeat.status === "pass" &&
      entry.proof_of_invariance.status === "pass" &&
      entry.invariants.status === "pass"
        ? "pass"
        : "fail";
    workflows.push(entry);
  }

  report.status = [
    ...report.gates,
    ...workflows.flatMap((wf) => [
      wf.double_run.primary,
      wf.double_run.repeat,
      wf.proof_of_invariance,
      wf.invariants,
    ]),
  ].every((item) => item.status === "pass")
    ? "pass"
    : "fail";
  report.finished_at = new Date().toISOString();

  const episode = maybeStoreEpisode(report, baseDir);
  report.episode_store = episode;

  const reportJsonPath = path.join(baseDir, "quality_report.json");
  const reportMdPath = path.join(baseDir, "quality_report.md");
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
  writeMarkdown(report, reportMdPath);
  return { report, baseDir, jsonPath: relRepo(reportJsonPath), mdPath: relRepo(reportMdPath) };
}

function runNegative(scope) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const baseDir = path.join(repoRoot, "artifacts", "quality", runId);
  ensureDir(baseDir);
  const suitePath = path.join(repoRoot, "docs", "examples", "neg", `${scope}_negative_suite.json`);
  const suite = JSON.parse(fs.readFileSync(suitePath, "utf8"));
  const cases = [];
  for (const testCase of suite.cases || []) {
    const caseDir = path.join(baseDir, "negative", makeSlug(testCase.name));
    ensureDir(caseDir);
    const logPath = path.join(caseDir, "invariants.log");
    const reportPath = path.join(caseDir, "invariants.json");
    const result = runCommand(process.execPath, [
      "tools/invoice_invariants_v0.mjs",
      "--workflow",
      testCase.workflow,
      "--dir",
      testCase.dir,
      "--out",
      reportPath,
      "--log",
      logPath,
    ], logPath);
    result.report_path = relRepo(reportPath);
    const expectStatus = testCase.expect === "fail" ? "fail" : "pass";
    const match = (result.status === "pass" ? "pass" : "fail") === expectStatus;
    cases.push({
      name: testCase.name,
      workflow: testCase.workflow,
      expect: expectStatus,
      result: { ...result, match },
    });
  }
  const overallPass = cases.every((c) => c.result.match);
  const report = {
    scope,
    mode: "negative",
    run_id: runId,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: overallPass ? "pass" : "fail",
    cases,
  };
  const reportJsonPath = path.join(baseDir, "quality_report_negative.json");
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
  return { report, baseDir, jsonPath: relRepo(reportJsonPath) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.negative) {
    runNegative(args.scope);
    return;
  }
  runPositive(args.scope);
}

main().catch((err) => {
  console.error("[quality_report] ERROR", err.message);
  process.exit(1);
});
