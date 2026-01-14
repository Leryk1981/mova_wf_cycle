#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadStationRegistry, resolvePackPathAbs } from "./station_registry_helpers_v0.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadStationRegistry(repoRoot);
const mcdaPackRoot = resolvePackPathAbs(repoRoot, "mcda_matrix_v0", registry);
const runtimePath = path.join(mcdaPackRoot, "runtime", "mcda_score_wsm_minmax_v0.mjs");
const casesPath = path.join(mcdaPackRoot, "examples", "neg", "neg_cases_v0.json");

function readJson(relPath) {
  const absPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function resolvePackRef(relPath) {
  if (!relPath) return relPath;
  const normalized = relPath.replace(/\\/g, "/");
  const prefix = "packs/mcda_matrix_v0/";
  if (normalized.startsWith(prefix)) {
    return path.join(mcdaPackRoot, normalized.slice(prefix.length));
  }
  return relPath;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runRuntime(envPath, outDir, logPath) {
  ensureDir(outDir);
  const child = spawnSync(
    process.execPath,
    [runtimePath, "--in", envPath, "--out", outDir],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const combined = `${child.stdout ?? ""}${child.stderr ?? ""}` || "(no output)\n";
  fs.writeFileSync(logPath, combined, "utf8");
  return {
    exit_code: child.status ?? 1,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? ""
  };
}

function main() {
  const runId = makeRunId();
  const baseDir = path.join(repoRoot, "artifacts", "quality", "mcda_matrix", runId);
  ensureDir(baseDir);

  const suite = readJson(casesPath);
  const report = {
    run_id: runId,
    mode: "negative",
    started_at: new Date().toISOString(),
    status: "pass",
    cases: []
  };

  for (const testCase of suite.cases || []) {
    const caseId = testCase.id;
    const caseDir = path.join(baseDir, "cases", caseId);
    ensureDir(caseDir);

    if (!testCase.env_file) {
      report.status = "fail";
    }

    const envPathSrc = resolvePackRef(testCase.env_file);
    const env = envPathSrc ? readJson(envPathSrc) : null;
    const envPath = path.join(baseDir, `case_${caseId}_env.json`);
    if (env) {
      fs.writeFileSync(envPath, JSON.stringify(env, null, 2));
    }

    const logPath = path.join(caseDir, "run.log");
    const result = env ? runRuntime(envPath, caseDir, logPath) : { exit_code: 1, stderr: "missing env_file" };
    const expectedFail = testCase.expect_error === true;
    const pass = expectedFail ? result.exit_code !== 0 : result.exit_code === 0;

    report.cases.push({
      id: caseId,
      problem_file: testCase.problem_file,
      env_file: testCase.env_file || null,
      env_resolved: envPathSrc ? path.relative(repoRoot, envPathSrc).replace(/\\/g, "/") : null,
      expected_fail: expectedFail,
      exit_code: result.exit_code,
      pass,
      error: pass ? null : (result.stderr || result.stdout || "unknown error"),
      env: env ? path.relative(repoRoot, envPath).replace(/\\/g, "/") : null,
      log: path.relative(repoRoot, logPath).replace(/\\/g, "/")
    });

    if (!pass) report.status = "fail";
  }

  report.finished_at = new Date().toISOString();
  const reportPath = path.join(baseDir, "neg_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  if (report.status !== "pass") {
    console.error("[quality_mcda_matrix_neg] FAIL");
    process.exit(1);
  }
  console.log("[quality_mcda_matrix_neg] PASS");
}

try {
  main();
} catch (error) {
  console.error("[quality_mcda_matrix_neg] ERROR:", error.message);
  process.exit(1);
}
