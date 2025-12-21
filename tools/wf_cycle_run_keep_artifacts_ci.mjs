#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { fixture: "lab/examples/wf_cycle_public_fixture" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out") {
      args.out = argv[i + 1];
      i += 1;
    } else if (token === "--fixture") {
      args.fixture = argv[i + 1];
      i += 1;
    } else if (token && token.startsWith("--")) {
      throw new Error(`Unknown argument ${token}`);
    } else {
      throw new Error(`Unexpected argument ${token}`);
    }
  }
  if (!args.out) {
    throw new Error("--out <dir> is required");
  }
  return args;
}

function runNodeScript(scriptRelPath, args = []) {
  const scriptPath = path.isAbsolute(scriptRelPath)
    ? scriptRelPath
    : path.join(repoRoot, scriptRelPath);
  const argv = ["node", scriptPath, ...args];
  const res = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", cwd: repoRoot });
  if (res.error) throw res.error;
  return {
    status: res.status,
    stdout: res.stdout.trim(),
    stderr: res.stderr.trim()
  };
}

function ensureJsonResult(output, stepName) {
  if (!output.stdout) {
    throw new Error(`${stepName}: empty stdout\nstderr:\n${output.stderr}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(output.stdout);
  } catch (err) {
    throw new Error(`${stepName}: failed to parse JSON: ${err.message}\nstdout:\n${output.stdout}`);
  }
  if (output.status !== 0 && parsed.status !== "ok" && parsed.status !== "pass") {
    throw new Error(`${stepName}: process failed (exit ${output.status})\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`);
  }
  return parsed;
}

function writeTempJson(obj, prefix) {
  const tempFile = path.join(os.tmpdir(), `${prefix}_${Date.now()}.json`);
  fs.writeFileSync(tempFile, JSON.stringify(obj, null, 2), "utf8");
  return tempFile;
}

function relativeToRepo(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

function rebaseFixtureValue(value, fixtureSrcAbs, fixtureCopyAbs) {
  if (Array.isArray(value)) {
    return value.map((item) => rebaseFixtureValue(item, fixtureSrcAbs, fixtureCopyAbs));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, val] of Object.entries(value)) {
      next[key] = rebaseFixtureValue(val, fixtureSrcAbs, fixtureCopyAbs);
    }
    return next;
  }
  if (typeof value === "string") {
    const abs = path.resolve(repoRoot, value);
    if (abs.startsWith(fixtureSrcAbs)) {
      const relativeInsideFixture = path.relative(fixtureSrcAbs, abs);
      const rebasedAbs = path.join(fixtureCopyAbs, relativeInsideFixture);
      return relativeToRepo(rebasedAbs);
    }
  }
  return value;
}

function main() {
  const { out, fixture } = parseArgs(process.argv.slice(2));
  const outDirAbs = path.resolve(repoRoot, out);
  const fixtureSrcAbs = path.resolve(repoRoot, fixture);
  const fixtureCopyAbs = path.join(outDirAbs, "fixture");
  const startedAt = new Date().toISOString();
  const summary = {
    ok: false,
    outDir: relativeToRepo(outDirAbs),
    startedAt,
    finishedAt: null
  };

  let exitCode = 0;
  try {
    if (!fs.existsSync(fixtureSrcAbs)) {
      throw new Error(`fixture directory not found: ${fixtureSrcAbs}`);
    }
    if (fs.existsSync(outDirAbs)) {
      throw new Error(`output directory already exists: ${outDirAbs}`);
    }
    fs.mkdirSync(outDirAbs, { recursive: true });
    fs.cpSync(fixtureSrcAbs, fixtureCopyAbs, { recursive: true });

    const scaffoldId = `WF_EX_WF_CI_FULL_${Date.now()}`;
    const scaffoldDirAbs = path.join(outDirAbs, "experiments", scaffoldId);
    const scaffoldDirRel = relativeToRepo(scaffoldDirAbs);
    const scaffoldRequest = {
      experiment_id: scaffoldId,
      experiment_dir: scaffoldDirRel,
      participants: ["codex_ide", "codex_cli"],
      options: { safe_mode: true, write_files: true }
    };
    const scaffoldReqPath = writeTempJson(scaffoldRequest, "wf_cycle_scaffold_full");
    try {
      const scaffoldResult = ensureJsonResult(
        runNodeScript("skills/wf_cycle_scaffold_basic/impl/bindings/node/scaffold_experiment.mjs", [
          "--request-file",
          scaffoldReqPath
        ]),
        "scaffold"
      );
      if (scaffoldResult.status !== "ok") {
        throw new Error(`scaffold: status=${scaffoldResult.status} notes=${scaffoldResult.notes}`);
      }
    } finally {
      fs.unlinkSync(scaffoldReqPath);
    }

    const probeParticipant = scaffoldRequest.participants?.[0] || "codex_ide";
    const probeConfigRel = relativeToRepo(
      path.join(
        scaffoldDirAbs,
        "attempts",
        probeParticipant,
        "wf_cycle",
        "driver_probes",
        "driver_probes_config.json"
      )
    );
    const probeArtifactsRel = relativeToRepo(
      path.join(
        scaffoldDirAbs,
        "attempts",
        probeParticipant,
        "wf_cycle",
        "artifacts",
        "driver_probes"
      )
    );
    const driverProbeResult = ensureJsonResult(
      runNodeScript("tools/wf_cycle_driver_probes.mjs", [
        "--config",
        probeConfigRel,
        "--artifacts-dir",
        probeArtifactsRel
      ]),
      "driver_probes"
    );
    if (driverProbeResult.status !== "pass") {
      throw new Error(`driver_probes: status=${driverProbeResult.status}`);
    }

    const compareTemplatePath = "skills/wf_cycle_compute_compare_basic/cases/case_WF_EX_WF_BUILD_WORKFLOW_001_B_topdown.json";
    const compareTemplate = JSON.parse(fs.readFileSync(path.join(repoRoot, compareTemplatePath), "utf8"));
    const compareRebased = rebaseFixtureValue(compareTemplate, fixtureSrcAbs, fixtureCopyAbs);
    const compareCasePathAbs = path.join(outDirAbs, "case_compare.json");
    fs.writeFileSync(compareCasePathAbs, JSON.stringify(compareRebased, null, 2), "utf8");

    const compareResult = ensureJsonResult(
      runNodeScript("skills/wf_cycle_compute_compare_basic/impl/bindings/node/compute_compare.mjs", [
        "--request-file",
        relativeToRepo(compareCasePathAbs)
      ]),
      "compare"
    );
    if (compareResult.status !== "ok") {
      throw new Error(`compare: status=${compareResult.status} notes=${compareResult.notes}`);
    }
    if (!compareResult.winner_label) {
      throw new Error("compare: winner_label is empty");
    }
    if (!Array.isArray(compareResult.paths_written) || compareResult.paths_written.length < 1) {
      throw new Error("compare: expected paths_written output");
    }

    const winnerTemplatePath =
      "skills/wf_cycle_winner_pack_basic/cases/case_WF_EX_WF_BUILD_WORKFLOW_001_pack_from_B_topdown.json";
    const winnerTemplate = JSON.parse(fs.readFileSync(path.join(repoRoot, winnerTemplatePath), "utf8"));
    const winnerRebased = rebaseFixtureValue(winnerTemplate, fixtureSrcAbs, fixtureCopyAbs);
    const winnerCasePathAbs = path.join(outDirAbs, "case_winner_pack.json");
    fs.writeFileSync(winnerCasePathAbs, JSON.stringify(winnerRebased, null, 2), "utf8");

    const winnerPackResult = ensureJsonResult(
      runNodeScript("skills/wf_cycle_winner_pack_basic/impl/bindings/node/build_winner_pack.mjs", [
        "--request-file",
        relativeToRepo(winnerCasePathAbs)
      ]),
      "winner_pack"
    );
    if (winnerPackResult.status !== "ok") {
      throw new Error(`winner_pack: status=${winnerPackResult.status} notes=${winnerPackResult.notes}`);
    }
    if (Array.isArray(winnerPackResult.warnings) && winnerPackResult.warnings.length > 0) {
      throw new Error(`winner_pack: warnings present -> ${winnerPackResult.warnings.join(" | ")}`);
    }

    summary.ok = true;
    console.log("[wf_cycle_run_keep_artifacts_ci] PASS: scaffold, driver_probes, compare, winner_pack");
  } catch (error) {
    exitCode = 1;
    console.error("[wf_cycle_run_keep_artifacts_ci] FAIL:", error.message);
  } finally {
    summary.finishedAt = new Date().toISOString();
    try {
      fs.mkdirSync(outDirAbs, { recursive: true });
      fs.writeFileSync(
        path.join(outDirAbs, "run_summary.json"),
        JSON.stringify(summary, null, 2),
        "utf8"
      );
    } catch (err) {
      console.error("Failed to write run_summary.json:", err.message);
      exitCode = exitCode || 1;
    }
    console.log(
      `[wf_cycle_run_keep_artifacts_ci] Summary -> ${path.join(summary.outDir, "run_summary.json")}`
    );
    process.exit(exitCode);
  }
}

try {
  main();
} catch (error) {
  console.error("[wf_cycle_run_keep_artifacts_ci] FAIL:", error.message);
  process.exit(1);
}
