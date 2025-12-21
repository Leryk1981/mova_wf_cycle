import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec } from "node:child_process";

function run(cmd, cwd) {
  return new Promise((resolvePromise) => {
    exec(
      cmd,
      { cwd, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolvePromise({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof err?.code === "number" ? err.code : 0,
          error: err ? { message: err.message } : null
        });
      }
    );
  });
}

function quote(value) {
  return `"${value.replace(/\"/g, '\\"')}"`;
}

export default function flashslotExperiment(inngest) {
  return inngest.createFunction(
    { id: "lab.flashslot.experiment.v0" },
    { event: "flashslot.experiment" },
    async ({ event, step }) => {
      const repoRoot = resolve(process.cwd(), "..", "..");
      if (!event?.id) {
        throw new Error("event id is required for deterministic FlashSlot experiment runs");
      }
      const runId = String(event.id);
      const runRoot = join(repoRoot, "lab", "inngest_runs", runId);
      const experimentDir = join(runRoot, "flashslot_experiment");
      const stepDir = join(runRoot, "steps", "01_flashslot_experiment");
      mkdirSync(experimentDir, { recursive: true });
      mkdirSync(stepDir, { recursive: true });

      const setPath = join(
        repoRoot,
        "packs",
        "flashslot_v0",
        "examples",
        "hypothesis_set_001_dentist_abc.json"
      );
      const runnerScript = join(repoRoot, "tools", "flashslot_experiment_keep_artifacts_ci.mjs");
      const command = `${quote(process.execPath)} ${quote(runnerScript)} --set ${quote(setPath)} --out ${quote(experimentDir)} --driver noop --dry-run`;

      const execResult = await step.run("flashslot_experiment", async () => run(command, repoRoot));

      writeFileSync(join(stepDir, "stdout.log"), execResult.stdout, "utf8");
      writeFileSync(join(stepDir, "stderr.log"), execResult.stderr, "utf8");

      const result = {
        id: "01_flashslot_experiment",
        label: "flashslot_experiment",
        command,
        exit_code: execResult.exitCode,
        ok: execResult.exitCode === 0
      };
      if (execResult.error) {
        result.error = execResult.error;
      }

      const summaryPath = join(experimentDir, "experiment_summary.json");
      if (existsSync(summaryPath)) {
        try {
          const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
          result.summary = summary;
          result.ok = result.ok && summary?.ok !== false;
        } catch (err) {
          result.summary_error = err.message;
          result.ok = false;
        }
      } else {
        result.summary_error = "experiment_summary.json missing";
        result.ok = false;
      }

      writeFileSync(join(stepDir, "result.json"), JSON.stringify(result, null, 2), "utf8");

      const finalResult = {
        runId,
        ok: result.ok,
        experiment_summary: join("flashslot_experiment", "experiment_summary.json"),
        winner_pack_dir: join("flashslot_experiment", "winner_pack"),
        steps: [result]
      };
      writeFileSync(join(runRoot, "result.json"), JSON.stringify(finalResult, null, 2), "utf8");
      if (!result.ok) {
        throw new Error("FlashSlot experiment run failed");
      }
      return finalResult;
    }
  );
}
