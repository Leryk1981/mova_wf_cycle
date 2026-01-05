#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(
  repoRoot,
  "packs",
  "mcda_matrix_v0",
  "runtime",
  "mcda_score_wsm_minmax_v0.mjs"
);
const casesPath = path.join(
  repoRoot,
  "packs",
  "mcda_matrix_v0",
  "examples",
  "pos",
  "pos_cases_v0.json"
);

const schemaPaths = [
  "packs/mcda_matrix_v0/ds/ds.mcda_alternative_v1.json",
  "packs/mcda_matrix_v0/ds/ds.mcda_criterion_v1.json",
  "packs/mcda_matrix_v0/ds/ds.mcda_evaluation_v1.json",
  "packs/mcda_matrix_v0/ds/ds.mcda_constraint_v1.json",
  "packs/mcda_matrix_v0/ds/ds.mcda_problem_v1.json",
  "packs/mcda_matrix_v0/ds/ds.mcda_method_config_v1.json",
  "packs/mcda_matrix_v0/ds/ds.mcda_score_result_v1.json",
  "packs/mcda_matrix_v0/env/env.mcda_score_request_v1.json"
];

const EPSILON = 1e-4;

function readJson(relPath) {
  const absPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatErrors(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
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
    stderr: child.stderr ?? "",
  };
}

function buildAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const relPath of schemaPaths) {
    const schema = readJson(relPath);
    if (schema.$id) ajv.addSchema(schema, schema.$id);
  }
  return ajv;
}

function validateResult(ajv, result) {
  const schema = readJson("packs/mcda_matrix_v0/ds/ds.mcda_score_result_v1.json");
  const valid = ajv.validate(schema.$id, result);
  return { valid, errors: ajv.errors || [] };
}

function rankedIds(result) {
  const scores = Array.isArray(result.scores) ? result.scores : [];
  const sorted = scores.slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return sorted.map((entry) => entry.alternative_id);
}

function checkRanks(result) {
  const scores = Array.isArray(result.scores) ? result.scores : [];
  const ranks = scores.map((entry) => entry.rank).filter((value) => Number.isInteger(value));
  const unique = new Set(ranks);
  if (unique.size !== ranks.length) return "rank values are not unique";
  const sorted = [...unique].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i + 1) return "rank values are not contiguous";
  }
  return null;
}

function checkContributions(result) {
  const scores = Array.isArray(result.scores) ? result.scores : [];
  for (const entry of scores) {
    if (!Array.isArray(entry.breakdown) || entry.breakdown.length === 0) {
      return `missing breakdown for ${entry.alternative_id}`;
    }
    const sum = entry.breakdown.reduce(
      (total, item) => total + (typeof item.weighted_contribution === "number" ? item.weighted_contribution : 0),
      0
    );
    if (typeof entry.score !== "number" || Math.abs(sum - entry.score) > EPSILON) {
      return `weighted contributions do not match score for ${entry.alternative_id}`;
    }
  }
  return null;
}

function main() {
  const runId = makeRunId();
  const baseDir = path.join(repoRoot, "artifacts", "quality", "mcda_matrix", runId);
  ensureDir(baseDir);

  const suite = readJson(casesPath);
  const ajv = buildAjv();

  const report = {
    run_id: runId,
    mode: "positive",
    started_at: new Date().toISOString(),
    status: "pass",
    cases: []
  };

  for (const testCase of suite.cases || []) {
    const caseId = testCase.id;
    const caseErrors = [];
    const caseDir = path.join(baseDir, "cases", caseId);
    const run1Dir = path.join(caseDir, "run1");
    const run2Dir = path.join(caseDir, "run2");
    ensureDir(caseDir);

    const problem = readJson(testCase.problem_file);
    const env = {
      request_id: `mcda-quality-${runId}-${caseId}`,
      problem,
      method_config: {
        method: "WSM",
        normalization: "MIN_MAX",
        auto_normalize: true,
        score_precision: 3
      }
    };

    const envPath = path.join(baseDir, `case_${caseId}_env.json`);
    fs.writeFileSync(envPath, JSON.stringify(env, null, 2));

    const log1 = path.join(caseDir, "run1.log");
    const log2 = path.join(caseDir, "run2.log");
    const result1 = runRuntime(envPath, run1Dir, log1);
    const result2 = runRuntime(envPath, run2Dir, log2);

    if (result1.exit_code !== 0 || result2.exit_code !== 0) {
      caseErrors.push("runtime failed");
    }

    let payload1 = null;
    let payload2 = null;
    if (result1.exit_code === 0) {
      payload1 = readJson(path.join(run1Dir, "result.json"));
      fs.writeFileSync(
        path.join(baseDir, `case_${caseId}_result.json`),
        JSON.stringify(payload1, null, 2)
      );
    }
    if (result2.exit_code === 0) {
      payload2 = readJson(path.join(run2Dir, "result.json"));
    }

    if (payload1 && payload2) {
      const same = JSON.stringify(payload1) === JSON.stringify(payload2);
      if (!same) caseErrors.push("determinism check failed");
    }

    if (payload1) {
      const validation = validateResult(ajv, payload1);
      if (!validation.valid) {
        caseErrors.push(`schema validation failed: ${formatErrors(validation.errors)}`);
      }

      if (testCase.expect_status && payload1.status !== testCase.expect_status) {
        caseErrors.push(`status mismatch: expected ${testCase.expect_status}`);
      }

      const ranked = rankedIds(payload1);
      if (Array.isArray(testCase.expect_top_ids)) {
        const top = ranked.slice(0, testCase.expect_top_ids.length);
        if (JSON.stringify(top) !== JSON.stringify(testCase.expect_top_ids)) {
          caseErrors.push("top ranking mismatch");
        }
      }
      if (Array.isArray(testCase.expect_ranked_ids)) {
        if (JSON.stringify(ranked) !== JSON.stringify(testCase.expect_ranked_ids)) {
          caseErrors.push("full ranking mismatch");
        }
      }

      const rankIssue = checkRanks(payload1);
      if (rankIssue) caseErrors.push(rankIssue);

      if (payload1.eligible_count !== (payload1.scores || []).length) {
        caseErrors.push("eligible_count mismatch");
      }

      const contributionIssue = checkContributions(payload1);
      if (contributionIssue) caseErrors.push(contributionIssue);
    }

    const casePass = caseErrors.length === 0;
    report.cases.push({
      id: caseId,
      problem_file: testCase.problem_file,
      pass: casePass,
      errors: caseErrors,
      env: path.relative(repoRoot, envPath).replace(/\\/g, "/"),
      result: payload1 ? path.relative(repoRoot, path.join(baseDir, `case_${caseId}_result.json`)).replace(/\\/g, "/") : null,
      logs: {
        run1: path.relative(repoRoot, log1).replace(/\\/g, "/"),
        run2: path.relative(repoRoot, log2).replace(/\\/g, "/")
      }
    });

    if (!casePass) report.status = "fail";
  }

  report.finished_at = new Date().toISOString();
  const reportPath = path.join(baseDir, "pos_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const mdLines = [
    "# MCDA Matrix Quality Report (pos)",
    "",
    `- Run: ${report.run_id}`,
    `- Status: ${report.status.toUpperCase()}`,
    "",
    "## Cases"
  ];
  for (const entry of report.cases) {
    mdLines.push(`- ${entry.id}: ${entry.pass ? "PASS" : "FAIL"}`);
    if (entry.errors.length) {
      mdLines.push(`  - ${entry.errors.join("; ")}`);
    }
  }
  fs.writeFileSync(path.join(baseDir, "pos_report.md"), mdLines.join("\n"));

  if (report.status !== "pass") {
    console.error("[quality_mcda_matrix] FAIL");
    process.exit(1);
  }
  console.log("[quality_mcda_matrix] PASS");
}

try {
  main();
} catch (error) {
  console.error("[quality_mcda_matrix] ERROR:", error.message);
  process.exit(1);
}
