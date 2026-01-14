#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadStationRegistry, resolvePackPathAbs } from "./station_registry_helpers_v0.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadStationRegistry(repoRoot);
const flashslotPackDir = resolvePackPathAbs(repoRoot, "flashslot_v0", registry);
const publishScript = path.join(flashslotPackDir, "runtime", "impl", "publish_offer_v0.mjs");
const flashslotPrefix = "packs/flashslot_v0/";

function parseArgs(argv) {
  const args = { driver: "noop", dryRun: true };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case "--set":
        args.setPath = argv[++i];
        break;
      case "--out":
        args.outDir = argv[++i];
        break;
      case "--driver":
        args.driver = argv[++i];
        break;
      case "--dry-run":
        {
          const next = argv[i + 1];
          if (next === "false" || next === "0") {
            args.dryRun = false;
            i += 1;
          } else {
            args.dryRun = true;
          }
        }
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.setPath) {
    throw new Error("--set is required");
  }
  if (!args.outDir) {
    throw new Error("--out is required");
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function toRepoRelative(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

function buildDeterministicId(setId, attemptId) {
  const seed = `${setId || ""}|${attemptId || ""}`;
  return `flashslot_exp_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

function validateSet(setPath) {
  const normalized = setPath.replace(/\\/g, "/");
  const absPath = path.isAbsolute(normalized)
    ? normalized
    : (normalized.startsWith(flashslotPrefix)
        ? path.join(flashslotPackDir, normalized.slice(flashslotPrefix.length))
        : path.resolve(repoRoot, setPath));
  if (!fs.existsSync(absPath)) {
    throw new Error(`hypothesis set not found: ${setPath}`);
  }
  const data = readJson(absPath);
  if (!data || typeof data !== "object") {
    throw new Error("hypothesis set must be a JSON object");
  }
  if (!data.id || typeof data.id !== "string") {
    throw new Error("hypothesis set missing string id");
  }
  if (!Array.isArray(data.hypotheses) || data.hypotheses.length === 0) {
    throw new Error("hypothesis set must include non-empty hypotheses array");
  }
  for (const hyp of data.hypotheses) {
    if (!hyp?.id || typeof hyp.id !== "string") {
      throw new Error("each hypothesis requires an id");
    }
    if (!hyp?.offer_path || typeof hyp.offer_path !== "string") {
      throw new Error(`hypothesis ${hyp.id} missing offer_path`);
    }
  }
  return { absPath, data };
}

function spawnPublish({ inputPath, outDir, driver, dryRun }) {
  const args = [publishScript, "--in", inputPath, "--out", outDir, "--driver", driver];
  if (dryRun) {
    args.push("--dry-run");
  }
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
}

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
}

function runAttempt(setData, hypothesis, outDirAbs, driver, dryRun) {
  const attemptDir = path.join(outDirAbs, "attempts", hypothesis.id);
  if (fs.existsSync(attemptDir)) {
    fs.rmSync(attemptDir, { recursive: true, force: true });
  }
  ensureDir(attemptDir);
  const offerAbs = path.resolve(repoRoot, hypothesis.offer_path);
  if (!fs.existsSync(offerAbs)) {
    throw new Error(`offer file missing for hypothesis ${hypothesis.id}: ${hypothesis.offer_path}`);
  }

  const offerData = readJson(offerAbs);
  const resolvedOffer = offerData.offer ?? offerData;
  writeJson(path.join(attemptDir, "offer.json"), resolvedOffer);

  const runId = buildDeterministicId(setData.id, hypothesis.id);
  const inputPayload = {
    ...offerData,
    offer: resolvedOffer,
    idempotency_key: runId,
    meta: {
      ...(offerData.meta ?? {}),
      experiment_set_id: setData.id,
      experiment_attempt_id: hypothesis.id,
      experiment_run_id: runId,
    },
  };
  const inputPath = path.join(attemptDir, "offer_input.json");
  writeJson(inputPath, inputPayload);

  const startedAt = Date.now();
  const execResult = spawnPublish({
    inputPath,
    outDir: attemptDir,
    driver,
    dryRun,
  });
  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;

  fs.writeFileSync(path.join(attemptDir, "stdout.log"), execResult.stdout ?? "", "utf8");
  fs.writeFileSync(path.join(attemptDir, "stderr.log"), execResult.stderr ?? "", "utf8");

  const resultPath = path.join(attemptDir, "result.json");
  const resultExists = fs.existsSync(resultPath);
  const resultData = resultExists ? readJson(resultPath) : null;
  const ok = execResult.status === 0 && resultData?.ok !== false;

  const metrics = {
    attempt_id: hypothesis.id,
    run_id: runId,
    attempt_dir: toRepoRelative(attemptDir),
    ok,
    duration_ms: durationMs,
    errors_count: Array.isArray(resultData?.errors) ? resultData.errors.length : ok ? 0 : 1,
    driver,
  };
  if (typeof resultData?.stats?.sent === "number") {
    metrics.deliveries_sent = resultData.stats.sent;
  }
  if (typeof resultData?.stats?.failed === "number") {
    metrics.deliveries_failed = resultData.stats.failed;
  }

  return {
    metrics,
    attemptDir,
    ok,
    resultExists,
    resultData,
    runId,
  };
}

function selectWinner(attemptResults) {
  const eligible = attemptResults.filter((item) => item.ok);
  const candidates = eligible.length > 0 ? eligible : attemptResults;
  return candidates.reduce((best, current) => {
    const bestSent = typeof best.metrics.deliveries_sent === "number" ? best.metrics.deliveries_sent : -1;
    const currentSent =
      typeof current.metrics.deliveries_sent === "number" ? current.metrics.deliveries_sent : -1;
    if (currentSent !== bestSent) {
      return currentSent > bestSent ? current : best;
    }
    const bestErrors = best.metrics.errors_count ?? Number.MAX_SAFE_INTEGER;
    const currentErrors = current.metrics.errors_count ?? Number.MAX_SAFE_INTEGER;
    if (currentErrors !== bestErrors) {
      return currentErrors < bestErrors ? current : best;
    }
    const bestDuration = best.metrics.duration_ms ?? Number.MAX_SAFE_INTEGER;
    const currentDuration = current.metrics.duration_ms ?? Number.MAX_SAFE_INTEGER;
    if (currentDuration !== bestDuration) {
      return currentDuration < bestDuration ? current : best;
    }
    return current.metrics.attempt_id < best.metrics.attempt_id ? current : best;
  });
}

function buildWinnerPack(attemptDir, winnerPackDir) {
  if (fs.existsSync(winnerPackDir)) {
    fs.rmSync(winnerPackDir, { recursive: true, force: true });
  }
  ensureDir(winnerPackDir);
  copyIfExists(path.join(attemptDir, "offer.json"), path.join(winnerPackDir, "offer.json"));
  copyIfExists(path.join(attemptDir, "request.json"), path.join(winnerPackDir, "request.json"));
  copyIfExists(path.join(attemptDir, "result.json"), path.join(winnerPackDir, "result.json"));
  copyIfExists(path.join(attemptDir, "stdout.log"), path.join(winnerPackDir, "stdout.log"));
  copyIfExists(path.join(attemptDir, "stderr.log"), path.join(winnerPackDir, "stderr.log"));

  const evidenceDir = path.join(attemptDir, "evidence");
  if (fs.existsSync(evidenceDir)) {
    copyIfExists(evidenceDir, path.join(winnerPackDir, "evidence"));
  }
}

function main() {
  const { setPath, outDir, driver, dryRun } = parseArgs(process.argv.slice(2));
  const outDirAbs = path.resolve(repoRoot, outDir);
  ensureDir(outDirAbs);

  const summary = {
    ok: false,
    set_id: null,
    attempts: [],
    winner_attempt_id: null,
    winner_dir: null,
    winner_pack_dir: null,
    out_dir: toRepoRelative(outDirAbs),
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  try {
    const { data: setData } = validateSet(setPath);
    summary.set_id = setData.id;
    const attemptResults = [];
    for (const hypothesis of setData.hypotheses) {
      const attemptResult = runAttempt(setData, hypothesis, outDirAbs, driver, dryRun);
      summary.attempts.push(attemptResult.metrics);
      attemptResults.push(attemptResult);
      if (!attemptResult.ok) {
        summary.ok = false;
      }
    }

    const winner = selectWinner(attemptResults);
    summary.winner_attempt_id = winner.metrics.attempt_id;
    summary.winner_dir = toRepoRelative(winner.attemptDir);

    const winnerPackDir = path.join(outDirAbs, "winner_pack");
    buildWinnerPack(winner.attemptDir, winnerPackDir);
    summary.winner_pack_dir = toRepoRelative(winnerPackDir);
    summary.ok = summary.attempts.every((attempt) => attempt.ok !== false);

    console.log(
      `[flashslot_experiment_keep_artifacts_ci] PASS: set=${setData.id} winner=${summary.winner_attempt_id} out=${toRepoRelative(outDirAbs)}`
    );
  } catch (err) {
    summary.error = err.message;
    console.error("[flashslot_experiment_keep_artifacts_ci] FAIL:", err.message);
  } finally {
    summary.finished_at = new Date().toISOString();
    writeJson(path.join(outDirAbs, "experiment_summary.json"), summary);
    if (summary.ok !== true) {
      process.exit(1);
    }
  }
}

try {
  main();
} catch (error) {
  console.error("[flashslot_experiment_keep_artifacts_ci] FAIL:", error.message);
  process.exit(1);
}
