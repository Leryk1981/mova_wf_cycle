#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

function parseArgs(argv) {
  const parsed = {
    labelA: "primary",
    labelB: "repeat",
    files: ["run/result_core.json"],
    out: path.join("artifacts", "attempts", "compare_latest.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--label-a") parsed.labelA = argv[++i];
    else if (arg === "--label-b") parsed.labelB = argv[++i];
    else if (arg === "--files") parsed.files = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--skill") parsed.skill = argv[++i];
    else if (arg === "--help" || arg === "-h") parsed.help = true;
  }
  return parsed;
}

function printHelp() {
  console.log(
    "Usage: node tools/attempt_compare.mjs [--label-a primary --label-b repeat --files run/result_core.json --out path --skill <name>]"
  );
}

const RESULT_METADATA_KEYS = new Set(["metadata", "meta"]);

function stripResultMetadata(item) {
  if (Array.isArray(item)) {
    return item.map(stripResultMetadata);
  }
  if (item && typeof item === "object") {
    const cleaned = {};
    for (const [key, value] of Object.entries(item)) {
      if (RESULT_METADATA_KEYS.has(key)) continue;
      cleaned[key] = stripResultMetadata(value);
    }
    return cleaned;
  }
  return item;
}

function buildResultCore(result) {
  if (!result || typeof result !== "object") return result;
  return stripResultMetadata(result);
}

function canonicalStringify(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function loadResultCoreCandidate(attemptDir, relPath) {
  const normalizedRel = relPath.replace(/\\/g, "/");
  const corePath = path.join(attemptDir, normalizedRel);
  if (fs.existsSync(corePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(corePath, "utf8"));
      return { obj: parsed, source: corePath, reason: "core" };
    } catch (err) {
      return { error: `failed to parse result_core (${err.message})`, source: corePath };
    }
  }
  if (normalizedRel.endsWith("result_core.json")) {
    const fallbackRel = normalizedRel.replace(/result_core\.json$/, "result.json");
    const fallbackPath = path.join(attemptDir, fallbackRel);
    if (fs.existsSync(fallbackPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
        return { obj: buildResultCore(raw), source: fallbackPath, reason: "fallback" };
      } catch (err) {
        return { error: `failed to parse result (${err.message})`, source: fallbackPath };
      }
    }
  }
  return null;
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
    throw new Error(`No attempts found for label "${label}" (${err.message})`);
  }
  if (!dirs.length) throw new Error(`No attempts directories under ${base}`);
  const run = dirs[dirs.length - 1];
  const dir = path.join(base, run);
  return {
    label,
    run_id: run,
    dir,
    relative: path.relative(repoRoot, dir).replace(/\\/g, "/"),
  };
}

function compareFiles(baseA, baseB, relPath) {
  const normalizedRel = relPath.replace(/\\/g, "/");
  if (normalizedRel.endsWith("result_core.json")) {
    const left = loadResultCoreCandidate(baseA.dir, normalizedRel);
    const right = loadResultCoreCandidate(baseB.dir, normalizedRel);
    const reasonParts = [];
    if (!left) {
      reasonParts.push("a missing result_core/result.json");
    } else if (left.error) {
      reasonParts.push(`a error: ${left.error}`);
    }
    if (!right) {
      reasonParts.push("b missing result_core/result.json");
    } else if (right.error) {
      reasonParts.push(`b error: ${right.error}`);
    }
    const pathA = left?.source ?? path.join(baseA.dir, normalizedRel);
    const pathB = right?.source ?? path.join(baseB.dir, normalizedRel);
    if (reasonParts.length) {
      return {
        file: relPath,
        equal: false,
        reason: reasonParts.join(" ; "),
        paths: {
          a: path.relative(repoRoot, pathA).replace(/\\/g, "/"),
          b: path.relative(repoRoot, pathB).replace(/\\/g, "/"),
        },
      };
    }
    const leftStr = canonicalStringify(left.obj);
    const rightStr = canonicalStringify(right.obj);
    const equal = leftStr === rightStr;
    return {
      file: relPath,
      equal,
      paths: {
        a: path.relative(repoRoot, pathA).replace(/\\/g, "/"),
        b: path.relative(repoRoot, pathB).replace(/\\/g, "/"),
      },
      ...(equal ? {} : { reason: "result_core differs (business output mismatch)" }),
    };
  }
  const fileA = path.join(baseA.dir, relPath);
  const fileB = path.join(baseB.dir, relPath);
  const existsA = fs.existsSync(fileA);
  const existsB = fs.existsSync(fileB);
  if (!existsA || !existsB) {
    return {
      file: relPath,
      equal: false,
      reason: `missing file (a:${existsA ? "yes" : "no"}, b:${existsB ? "yes" : "no"})`,
      paths: {
        a: path.relative(repoRoot, fileA).replace(/\\/g, "/"),
        b: path.relative(repoRoot, fileB).replace(/\\/g, "/"),
      },
    };
  }
  const contentA = fs.readFileSync(fileA, "utf8");
  const contentB = fs.readFileSync(fileB, "utf8");
  const equal = contentA === contentB;
  return {
    file: relPath,
    equal,
    paths: {
      a: path.relative(repoRoot, fileA).replace(/\\/g, "/"),
      b: path.relative(repoRoot, fileB).replace(/\\/g, "/"),
    },
    ...(equal ? {} : { reason: "content differs" }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const primaryAttempt = findLatestAttempt(args.labelA);
  const repeatAttempt = findLatestAttempt(args.labelB);

  const comparisons = args.files.map((file) => compareFiles(primaryAttempt, repeatAttempt, file));
  const mismatches = comparisons.filter((c) => !c.equal).map((c) => c.file);
  const report = {
    ...(args.skill ? { skill: args.skill } : {}),
    participants: { primary: args.labelA, repeat: args.labelB },
    labels: { primary: args.labelA, repeat: args.labelB },
    primary_attempt: primaryAttempt,
    repeat_attempt: repeatAttempt,
    files: comparisons,
    summary: {
      identical: mismatches.length === 0,
      mismatched_files: mismatches,
    },
    generated_at: new Date().toISOString(),
  };

  const outPath = path.resolve(repoRoot, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const banner = args.skill ? `[proof_of_invariance:${args.skill}]` : "[proof_of_invariance]";
  if (report.summary.identical) {
    console.log(`${banner} OK – result_core matches (${args.files.join(", ")})`);
  } else {
    console.log(
      `${banner} DIFF – mismatched files: ${report.summary.mismatched_files.join(", ") || "(none)"}`
    );
  }
  console.log(`- wrote ${path.relative(repoRoot, outPath).replace(/\\/g, "/")}`);
}

main().catch((err) => {
  console.error("[attempt_compare] FAIL:", err.message);
  process.exit(1);
});
