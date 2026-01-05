#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..");

const schemaPaths = {
  request: path.join(repoRoot, "packs", "mcda_matrix_v0", "env", "env.mcda_score_request_v1.json"),
  result: path.join(repoRoot, "packs", "mcda_matrix_v0", "ds", "ds.mcda_score_result_v1.json"),
  alternative: path.join(repoRoot, "packs", "mcda_matrix_v0", "ds", "ds.mcda_alternative_v1.json"),
  criterion: path.join(repoRoot, "packs", "mcda_matrix_v0", "ds", "ds.mcda_criterion_v1.json"),
  evaluation: path.join(repoRoot, "packs", "mcda_matrix_v0", "ds", "ds.mcda_evaluation_v1.json"),
  constraint: path.join(repoRoot, "packs", "mcda_matrix_v0", "ds", "ds.mcda_constraint_v1.json"),
  problem: path.join(repoRoot, "packs", "mcda_matrix_v0", "ds", "ds.mcda_problem_v1.json"),
  method: path.join(repoRoot, "packs", "mcda_matrix_v0", "ds", "ds.mcda_method_config_v1.json"),
};

function printHelp() {
  console.log("Usage: node mcda_score_wsm_minmax_v0.mjs --in <env.json> --out <outDir>");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === "--in") args.inPath = argv[++i];
    else if (cur === "--out") args.outPath = argv[++i];
    else if (cur === "--help" || cur === "-h") args.help = true;
  }
  return args;
}

function ensureArg(value, label) {
  if (!value) throw new Error(`Missing required argument: ${label}`);
  return value;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatAjvErrors(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join(" | ");
}

function compare(value, operator, threshold) {
  switch (operator) {
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "==":
      return value === threshold;
    case "!=":
      return value !== threshold;
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

function roundTo(value, precision) {
  if (precision === null || precision === undefined) return value;
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function ensureUnique(list, label) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item)) throw new Error(`Duplicate ${label}: ${item}`);
    seen.add(item);
  }
}

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function resolveValue(value, criterion) {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "boolean") {
    if (!criterion.value_mapping) {
      throw makeError(
        "missing_value_mapping",
        `Missing value_mapping for criterion ${criterion.criterion_id}`
      );
    }
    const key = String(value);
    if (!Object.prototype.hasOwnProperty.call(criterion.value_mapping, key)) {
      throw makeError(
        "missing_value_mapping_entry",
        `Missing value_mapping entry for ${criterion.criterion_id}: ${key}`
      );
    }
    const mapped = criterion.value_mapping[key];
    if (typeof mapped !== "number" || Number.isNaN(mapped)) {
      throw makeError(
        "invalid_value_mapping",
        `Invalid value_mapping for ${criterion.criterion_id}: ${key}`
      );
    }
    return mapped;
  }
  throw makeError(
    "unsupported_value_type",
    `Unsupported evaluation value type for ${criterion.criterion_id}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inPath = path.resolve(ensureArg(args.inPath, "--in"));
  const outPath = path.resolve(ensureArg(args.outPath, "--out"));
  ensureDir(outPath);

  const rawRequest = loadJson(inPath);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const schemaList = [
    schemaPaths.alternative,
    schemaPaths.criterion,
    schemaPaths.evaluation,
    schemaPaths.constraint,
    schemaPaths.problem,
    schemaPaths.method,
  ].map((schemaPath) => loadJson(schemaPath));
  for (const schema of schemaList) {
    if (schema.$id) ajv.addSchema(schema, schema.$id);
  }

  const requestSchema = loadJson(schemaPaths.request);
  const validateRequest = ajv.compile(requestSchema);
  if (!validateRequest(rawRequest)) {
    throw makeError(
      "invalid_request",
      `mcda_score_request invalid: ${formatAjvErrors(validateRequest.errors)}`
    );
  }

  const { problem, method_config: methodConfig } = rawRequest;
  if (methodConfig.method_version !== "v0") {
    throw makeError("unsupported_method_version", "Unsupported method_version; expected v0");
  }
  if (methodConfig.method !== "WSM") {
    throw makeError("unsupported_method", "Unsupported method; expected WSM");
  }
  if (methodConfig.normalization !== "MIN_MAX") {
    throw makeError("unsupported_normalization", "Unsupported normalization; expected MIN_MAX");
  }
  if (methodConfig.auto_normalize !== true) {
    throw makeError("invalid_auto_normalize", "auto_normalize must be true for v0");
  }

  const alternatives = problem.alternatives || [];
  const criteria = problem.criteria || [];
  const evaluations = problem.evaluations || [];
  const constraints = problem.constraints || [];

  ensureUnique(alternatives.map((alt) => alt.alternative_id), "alternative_id");
  ensureUnique(criteria.map((crit) => crit.criterion_id), "criterion_id");

  const alternativeMap = new Map(alternatives.map((alt) => [alt.alternative_id, alt]));
  const criterionMap = new Map(criteria.map((crit) => [crit.criterion_id, crit]));

  const evalMap = new Map();
  for (const evaluation of evaluations) {
    if (!alternativeMap.has(evaluation.alternative_id)) {
      throw makeError(
        "unknown_alternative_id",
        `Unknown alternative_id in evaluation: ${evaluation.alternative_id}`
      );
    }
    if (!criterionMap.has(evaluation.criterion_id)) {
      throw makeError(
        "unknown_criterion_id",
        `Unknown criterion_id in evaluation: ${evaluation.criterion_id}`
      );
    }
    const key = `${evaluation.alternative_id}::${evaluation.criterion_id}`;
    if (evalMap.has(key)) {
      throw makeError(
        "duplicate_evaluation",
        `Duplicate evaluation for ${evaluation.alternative_id}/${evaluation.criterion_id}`
      );
    }
    evalMap.set(key, evaluation);
  }

  const numericValues = new Map();
  for (const alt of alternatives) {
    for (const crit of criteria) {
      const key = `${alt.alternative_id}::${crit.criterion_id}`;
      const evaluation = evalMap.get(key);
      if (!evaluation) {
        throw makeError(
          "missing_evaluation",
          `Missing evaluation for ${alt.alternative_id}/${crit.criterion_id}`
        );
      }
      const numericValue = resolveValue(evaluation.value, crit);
      numericValues.set(key, {
        raw: evaluation.value,
        numeric: numericValue,
      });
    }
  }

  const ineligibleMap = new Map();
  function markIneligible(altId, reason) {
    if (!ineligibleMap.has(altId)) ineligibleMap.set(altId, new Set());
    ineligibleMap.get(altId).add(reason);
  }

  for (const constraint of constraints) {
    const constraintId = constraint.constraint_id;
    const reason = `constraint:${constraintId}`;
    if (constraint.kind === "exclude") {
      if (!constraint.target_alternative_id) {
        throw makeError(
          "invalid_constraint",
          `Constraint ${constraintId} missing target_alternative_id`
        );
      }
      if (!alternativeMap.has(constraint.target_alternative_id)) {
        throw makeError(
          "invalid_constraint",
          `Constraint ${constraintId} references unknown alternative`
        );
      }
      markIneligible(constraint.target_alternative_id, reason);
      continue;
    }

    if (constraint.kind === "custom") {
      if (constraint.target_alternative_id && alternativeMap.has(constraint.target_alternative_id)) {
        markIneligible(constraint.target_alternative_id, reason);
        continue;
      }
      throw makeError(
        "unsupported_constraint",
        `Unsupported custom constraint ${constraintId}`
      );
    }

    if (constraint.kind !== "min" && constraint.kind !== "max") {
      throw makeError(
        "unsupported_constraint",
        `Unsupported constraint kind ${constraint.kind}`
      );
    }

    if (!constraint.target_criterion_id) {
      throw makeError(
        "invalid_constraint",
        `Constraint ${constraintId} missing target_criterion_id`
      );
    }
    if (!criterionMap.has(constraint.target_criterion_id)) {
      throw makeError(
        "invalid_constraint",
        `Constraint ${constraintId} references unknown criterion`
      );
    }
    if (typeof constraint.threshold !== "number") {
      throw makeError(
        "invalid_constraint",
        `Constraint ${constraintId} missing numeric threshold`
      );
    }

    const operator = constraint.operator || (constraint.kind === "min" ? ">=" : "<=");
    const targetAlt = constraint.target_alternative_id;
    const targetList = targetAlt
      ? [alternativeMap.get(targetAlt)]
      : alternatives;

    for (const alt of targetList) {
      if (!alt) continue;
      const key = `${alt.alternative_id}::${constraint.target_criterion_id}`;
      const numeric = numericValues.get(key);
      if (!numeric) {
        throw makeError(
          "missing_evaluation",
          `Missing evaluation for constraint ${constraintId} on ${alt.alternative_id}`
        );
      }
      const ok = compare(numeric.numeric, operator, constraint.threshold);
      if (!ok) markIneligible(alt.alternative_id, reason);
    }
  }

  const eligibleAlternatives = alternatives.filter(
    (alt) => !ineligibleMap.has(alt.alternative_id)
  );

  const weights = criteria.map((crit) => crit.weight ?? 0);
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (weightSum <= 0) {
    throw makeError("weights_sum_zero", "Sum of criterion weights must be > 0");
  }
  const normalizedWeights = new Map(
    criteria.map((crit) => [crit.criterion_id, crit.weight / weightSum])
  );

  const normalizationSummary = [];
  for (const crit of criteria) {
    if (eligibleAlternatives.length === 0) break;
    const values = eligibleAlternatives.map((alt) =>
      numericValues.get(`${alt.alternative_id}::${crit.criterion_id}`).numeric
    );
    const min = Math.min(...values);
    const max = Math.max(...values);
    normalizationSummary.push({
      criterion_id: crit.criterion_id,
      min,
      max,
    });
  }

  const scorePrecision = Number.isInteger(methodConfig.score_precision)
    ? methodConfig.score_precision
    : null;

  let scores = [];
  if (eligibleAlternatives.length > 0) {
    scores = eligibleAlternatives.map((alt) => {
      const breakdown = [];
      let total = 0;
      for (const crit of criteria) {
        const key = `${alt.alternative_id}::${crit.criterion_id}`;
        const numeric = numericValues.get(key);
        const summary = normalizationSummary.find(
          (item) => item.criterion_id === crit.criterion_id
        );
        const min = summary?.min ?? 0;
        const max = summary?.max ?? 0;
        const range = max - min;
        let normalized = 1;
        if (range !== 0) {
          normalized =
            crit.kind === "cost"
              ? (max - numeric.numeric) / range
              : (numeric.numeric - min) / range;
        }
        const weight = normalizedWeights.get(crit.criterion_id) ?? 0;
        const contribution = normalized * weight;
        total += contribution;
        breakdown.push({
          criterion_id: crit.criterion_id,
          raw_value: numeric.raw,
          numeric_value: numeric.numeric,
          normalized_value: roundTo(normalized, scorePrecision),
          weight: roundTo(weight, scorePrecision),
          weighted_contribution: roundTo(contribution, scorePrecision),
        });
      }

      return {
        alternative_id: alt.alternative_id,
        score: roundTo(total, scorePrecision),
        breakdown,
      };
    });

    scores.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.alternative_id.localeCompare(b.alternative_id);
    });

    scores = scores.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }

  const ineligible = Array.from(ineligibleMap.entries()).map(([alternative_id, reasons]) => ({
    alternative_id,
    reasons: Array.from(reasons),
  }));

  const resultEnvelope = {
    status: eligibleAlternatives.length === 0 ? "NO_ELIGIBLE" : "OK",
    problem_id: problem.problem_id,
    method_config: methodConfig,
    eligible_count: eligibleAlternatives.length,
    ineligible,
    normalization_summary: eligibleAlternatives.length === 0 ? [] : normalizationSummary,
    scores,
  };

  const resultSchema = loadJson(schemaPaths.result);
  const validateResult = ajv.compile(resultSchema);
  if (!validateResult(resultEnvelope)) {
    throw makeError(
      "invalid_result",
      `mcda_score_result invalid: ${formatAjvErrors(validateResult.errors)}`
    );
  }

  fs.writeFileSync(path.join(outPath, "request.json"), JSON.stringify(rawRequest, null, 2));
  fs.writeFileSync(path.join(outPath, "result.json"), JSON.stringify(resultEnvelope, null, 2));

  console.log(`[mcda_score_wsm_minmax_v0] scored ${eligibleAlternatives.length}/${alternatives.length}`);
}

try {
  await main();
} catch (err) {
  try {
    const outIdx = process.argv.indexOf("--out");
    const outDir = outIdx !== -1 ? path.resolve(process.argv[outIdx + 1]) : null;
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      const fallbackRequest = process.argv.includes("--in")
        ? loadJson(path.resolve(process.argv[process.argv.indexOf("--in") + 1]))
        : null;
      const methodConfig = fallbackRequest?.method_config;
      const problemId = fallbackRequest?.problem?.problem_id;
      const errorResult = {
        status: "ERROR",
        problem_id: problemId,
        method_config: methodConfig,
        eligible_count: 0,
        ineligible: [],
        normalization_summary: [],
        scores: [],
        error: {
          code: err.code || "runtime_error",
          message: err.message,
        },
      };
      fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(errorResult, null, 2));
    }
  } catch {
    /* noop */
  }
  console.error("[mcda_score_wsm_minmax_v0] FAIL:", err.message);
  process.exit(1);
}
