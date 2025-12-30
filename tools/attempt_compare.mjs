#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

function parseArgs(argv) {
  const parsed = {
    labelA: "ide",
    labelB: "cli",
    files: ["run/request.json", "run/result.json", "run/evidence/totals.json"],
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
    "Usage: node tools/attempt_compare.mjs [--label-a ide --label-b cli --files file1,file2 --out path --skill <name>]"
  );
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
  const attemptA = findLatestAttempt(args.labelA);
  const attemptB = findLatestAttempt(args.labelB);

  const comparisons = args.files.map((file) => compareFiles(attemptA, attemptB, file));
  const mismatches = comparisons.filter((c) => !c.equal).map((c) => c.file);
  const report = {
    ...(args.skill ? { skill: args.skill } : {}),
    labels: { a: args.labelA, b: args.labelB },
    attempt_a: attemptA,
    attempt_b: attemptB,
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

  const banner = args.skill ? `[attempt_compare:${args.skill}]` : "[attempt_compare]";
  if (report.summary.identical) {
    console.log(`${banner} OK – files identical (${args.files.join(", ")})`);
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
