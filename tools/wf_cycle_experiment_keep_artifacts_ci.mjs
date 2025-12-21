#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureSrcAbs = path.resolve(repoRoot, "lab/examples/wf_cycle_public_fixture");

function parseArgs(argv) {
  const args = { fixture: "lab/examples/wf_cycle_public_fixture", attempts: "A,B,C" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out") {
      args.out = argv[i + 1];
      i += 1;
    } else if (token === "--fixture") {
      args.fixture = argv[i + 1];
      i += 1;
    } else if (token === "--attempts") {
      args.attempts = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.out) {
    throw new Error("--out is required");
  }
  return args;
}

function runNodeScript(scriptRel, args, cwd = repoRoot) {
  const scriptPath = path.join(repoRoot, scriptRel);
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  });
  return res;
}

function relativeToRepo(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function rebasePath(original, newFixtureAbs) {
  const absOriginal = path.resolve(repoRoot, original);
  if (!absOriginal.startsWith(fixtureSrcAbs)) {
    return relativeToRepo(absOriginal);
  }
  const rel = path.relative(fixtureSrcAbs, absOriginal);
  const rebasedAbs = path.join(newFixtureAbs, rel);
  return relativeToRepo(rebasedAbs);
}

function runAttempt(attemptId, outDirAbs, fixtureRel) {
  const attemptDir = path.join(outDirAbs, "attempts", attemptId);
  if (fs.existsSync(attemptDir)) {
    throw new Error(`attempt directory already exists: ${attemptDir}`);
  }
  const args = ["--out", attemptDir, "--fixture", fixtureRel];
  const res = runNodeScript("tools/wf_cycle_run_keep_artifacts_ci.mjs", args);
  const ok = res.status === 0;
  const summaryPath = path.join(attemptDir, "run_summary.json");
  let summary = null;
  if (fs.existsSync(summaryPath)) {
    summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  }
  return {
    id: attemptId,
    ok,
    dir: attemptDir,
    summary,
    output: res
  };
}

function buildCompareCase(template, leftFixtureAbs, rightFixtureAbs, outputDirAbs) {
  const caseData = JSON.parse(JSON.stringify(template));
  caseData.left.run_dir = rebasePath(template.left.run_dir, leftFixtureAbs);
  caseData.left.artifacts_dir = rebasePath(template.left.artifacts_dir, leftFixtureAbs);
  caseData.left.binding_map_path = rebasePath(template.left.binding_map_path, leftFixtureAbs);

  caseData.right.run_dir = rebasePath(template.right.run_dir, rightFixtureAbs);
  caseData.right.artifacts_dir = rebasePath(template.right.artifacts_dir, rightFixtureAbs);
  caseData.right.binding_map_path = rebasePath(template.right.binding_map_path, rightFixtureAbs);

  caseData.output_compare_dir = relativeToRepo(outputDirAbs);
  return caseData;
}

function buildWinnerCase(template, attemptsRootAbs, compareDirAbs, outputDirAbs, abcSummaryAbs) {
  const caseData = JSON.parse(JSON.stringify(template));
  caseData.compare_dir = relativeToRepo(compareDirAbs);
  caseData.attempts_root = relativeToRepo(attemptsRootAbs);
  caseData.output_dir = relativeToRepo(outputDirAbs);
  if (caseData.include?.abc_summary_path) {
    caseData.include.abc_summary_path = relativeToRepo(abcSummaryAbs);
  }
  return caseData;
}

function main() {
  const { out, fixture, attempts } = parseArgs(process.argv.slice(2));
  const outDirAbs = path.resolve(repoRoot, out);
  const fixtureRel = fixture;
  ensureDir(outDirAbs);

  const summary = {
    ok: false,
    outDir: relativeToRepo(outDirAbs),
    attempts: {},
    startedAt: new Date().toISOString(),
    finishedAt: null,
    winner: null,
    winner_pack_dir: null
  };

  const attemptIds = attempts
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (attemptIds.length === 0) {
    throw new Error("no attempts specified");
  }

  const attemptResults = [];

  try {
    for (const attemptId of attemptIds) {
      const result = runAttempt(attemptId, outDirAbs, fixtureRel);
      summary.attempts[attemptId] = {
        ok: result.ok,
        dir: relativeToRepo(result.dir)
      };
      attemptResults.push(result);
      if (!result.ok) {
        throw new Error(`attempt ${attemptId} failed`);
      }
    }

    const templateCompare = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "skills/wf_cycle_compute_compare_basic/cases/case_WF_EX_WF_BUILD_WORKFLOW_001_B_topdown.json"),
        "utf8"
      )
    );
    const templateWinner = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "skills/wf_cycle_winner_pack_basic/cases/case_WF_EX_WF_BUILD_WORKFLOW_001_pack_from_B_topdown.json"),
        "utf8"
      )
    );

    const attemptFixtures = attemptResults.map((res) => ({
      id: res.id,
      fixtureDir: path.join(res.dir, "fixture")
    }));
    const fallbackFixture = attemptFixtures[0].fixtureDir;
    const leftFixture = attemptFixtures[0]?.fixtureDir ?? fallbackFixture;
    const rightFixture = attemptFixtures[1]?.fixtureDir ?? fallbackFixture;
    const winnerFixture = attemptFixtures[2]?.fixtureDir ?? rightFixture;

    const compareOutputDirAbs = path.join(outDirAbs, "compare", "experiment");
    ensureDir(compareOutputDirAbs);
    const compareCase = buildCompareCase(templateCompare, leftFixture, rightFixture, compareOutputDirAbs);
    const compareCasePath = path.join(outDirAbs, "case_compare.json");
    writeJson(compareCasePath, compareCase);

    const compareRes = runNodeScript(
      "skills/wf_cycle_compute_compare_basic/impl/bindings/node/compute_compare.mjs",
      ["--request-file", relativeToRepo(compareCasePath)]
    );
    if (compareRes.status !== 0) {
      throw new Error(`compare failed: ${compareRes.stderr}`);
    }
    const compareResult = JSON.parse(compareRes.stdout || "{}");
    if (compareResult.status !== "ok" || !compareResult.winner_label) {
      throw new Error("compare did not produce a winner");
    }
    summary.winner = compareResult.winner_label;

    const winnerPackDirAbs = path.join(outDirAbs, "winner_pack");
    const winnerCase = buildWinnerCase(
      templateWinner,
      path.join(winnerFixture, "attempts"),
      compareOutputDirAbs,
      winnerPackDirAbs,
      path.join(winnerFixture, "compare", "ABC_summary.md")
    );
    const winnerCasePath = path.join(outDirAbs, "case_winner_pack.json");
    writeJson(winnerCasePath, winnerCase);

    const winnerRes = runNodeScript(
      "skills/wf_cycle_winner_pack_basic/impl/bindings/node/build_winner_pack.mjs",
      ["--request-file", relativeToRepo(winnerCasePath)]
    );
    if (winnerRes.status !== 0) {
      throw new Error(`winner_pack failed: ${winnerRes.stderr}`);
    }
    summary.winner_pack_dir = relativeToRepo(winnerPackDirAbs);

    summary.ok = true;
    console.log(`[wf_cycle_experiment_keep_artifacts_ci] PASS: outDir=${summary.outDir}`);
  } catch (err) {
    console.error("[wf_cycle_experiment_keep_artifacts_ci] FAIL:", err.message);
    summary.error = err.message;
  } finally {
    summary.finishedAt = new Date().toISOString();
    writeJson(path.join(outDirAbs, "experiment_summary.json"), summary);
    if (!summary.ok) {
      process.exit(1);
    }
  }
}

try {
  main();
} catch (error) {
  console.error("[wf_cycle_experiment_keep_artifacts_ci] FAIL:", error.message);
  process.exit(1);
}
