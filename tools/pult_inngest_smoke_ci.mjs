#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import flashslotPublish from "../pults/inngest_wf_cycle_v0/src/inngest/flashslot_publish.mjs";
import wfCycleExperiment from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_experiment.mjs";
import wfCycleFull from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_full.mjs";
import wfCycleSmoke from "../pults/inngest_wf_cycle_v0/src/inngest/wf_cycle_smoke.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pultDir = path.join(repoRoot, "pults", "inngest_wf_cycle_v0");
const labRunsDir = path.join(repoRoot, "lab", "inngest_runs");

const inngestStub = {
  createFunction: (_opts, _trigger, handler) => ({ handler })
};

function createStepAdapter() {
  return {
    run: async (_label, cb) => cb()
  };
}

function resolveRunDir(runId) {
  return path.join(labRunsDir, runId);
}

async function runHandler(factory, label) {
  const fn = factory(inngestStub);
  const handler = fn?.handler;
  if (typeof handler !== "function") {
    throw new Error(`failed to resolve handler for ${label}`);
  }
  const safeLabel = label.replace(/[\\/]/g, "_");
  const eventId = `${Date.now()}_${safeLabel}`;
  const result = await handler({ event: { id: eventId }, step: createStepAdapter() });
  const runId = result?.runId ?? eventId;
  return { result, runId, runDir: resolveRunDir(runId) };
}

async function main() {
  fs.mkdirSync(labRunsDir, { recursive: true });
  const originalCwd = process.cwd();
  process.chdir(pultDir);

  try {
    const smoke = await runHandler(wfCycleSmoke, "lab/wf_cycle.smoke");
    const full = await runHandler(wfCycleFull, "lab/wf_cycle.full");
    const experiment = await runHandler(wfCycleExperiment, "lab/wf_cycle.experiment");
    const flashslot = await runHandler(flashslotPublish, "lab/flashslot.publish");

    const fullOut = full.result?.outDir ?? full.runDir;
    const experimentSummary = experiment.result?.experiment_summary
      ? path.join(experiment.runDir, experiment.result.experiment_summary)
      : experiment.runDir;
    const flashslotOut = flashslot.result?.outDir ?? flashslot.runDir;

    console.log(
      `[pult_inngest_smoke_ci] PASS: smoke=${smoke.runDir}, full=${fullOut}, experiment=${experimentSummary}, flashslot=${flashslotOut}`
    );
  } finally {
    process.chdir(originalCwd);
  }
}

main().catch((error) => {
  console.error("[pult_inngest_smoke_ci] FAIL:", error.message);
  process.exit(1);
});
