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

function readJson(relPath) {
  const absPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function formatErrors(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function main() {
  const runId = makeRunId();
  const artifactsDir = path.join(repoRoot, "artifacts", "mcda_matrix", runId);
  ensureDir(artifactsDir);

  const inputEnv = readJson("packs/mcda_matrix_v0/examples/pos/mcda_score_request_small_v0.json");

  const inputPath = path.join(artifactsDir, "input_env.json");
  fs.writeFileSync(inputPath, JSON.stringify(inputEnv, null, 2));

  const runtime = spawnSync(
    process.execPath,
    [runtimePath, "--in", inputPath, "--out", artifactsDir],
    { cwd: repoRoot, encoding: "utf8" }
  );

  if (runtime.status !== 0) {
    throw new Error(`runtime failed: ${runtime.stderr || runtime.stdout || "unknown"}`);
  }

  const resultPath = path.join(artifactsDir, "result.json");
  const result = readJson(resultPath);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const relPath of schemaPaths) {
    const schema = readJson(relPath);
    if (schema.$id) ajv.addSchema(schema, schema.$id);
  }

  const resultSchema = readJson("packs/mcda_matrix_v0/ds/ds.mcda_score_result_v1.json");
  const valid = ajv.validate(resultSchema.$id, result);
  const report = {
    ok: !!valid,
    errors: valid ? [] : ajv.errors || []
  };
  const reportPath = path.join(artifactsDir, "validation_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  if (!valid) {
    throw new Error(`result schema validation failed: ${formatErrors(ajv.errors)}`);
  }

  if (!Array.isArray(result.scores) || result.scores.length === 0) {
    throw new Error("result missing scores for smoke");
  }

  console.log(`[mcda_matrix_smoke_ci] PASS: ${result.scores.length} scores, status=${result.status}`);
}

try {
  main();
} catch (error) {
  console.error("[mcda_matrix_smoke_ci] FAIL:", error.message);
  process.exit(1);
}
