import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec } from "node:child_process";

function run(cmd, cwd) {
  return new Promise((resolvePromise) => {
    exec(cmd, { cwd, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolvePromise({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: typeof err?.code === "number" ? err.code : 0,
        error: err ? { message: err.message } : null
      });
    });
  });
}

export default function wfCycleExperiment(inngest) {
  return inngest.createFunction(
    { id: "lab.wf_cycle.experiment.v0" },
    { event: "lab/wf_cycle.experiment" },
    async ({ event, step }) => {
      const repoRoot = resolve(process.cwd(), "..", "..");
      const eventTag = event?.id || "no_event_id";
      const runId = event?.id ? String(event.id) : `${Date.now()}_${eventTag}`;
      const runRoot = join(repoRoot, "lab", "inngest_runs", runId);
      mkdirSync(runRoot, { recursive: true });

      const stepsDir = join(runRoot, "steps");
      mkdirSync(stepsDir, { recursive: true });
      const experimentDir = join(runRoot, "wf_cycle_experiment");
      const stepDir = join(stepsDir, "01_wf_cycle_experiment");
      mkdirSync(stepDir, { recursive: true });

      const command = `node tools/wf_cycle_experiment_keep_artifacts_ci.mjs --out "${experimentDir}"`;
      const execResult = await step.run("wf_cycle_experiment", async () => run(command, repoRoot));

      writeFileSync(join(stepDir, "stdout.log"), execResult.stdout, "utf8");
      writeFileSync(join(stepDir, "stderr.log"), execResult.stderr, "utf8");

      const stepSummary = {
        id: "01_wf_cycle_experiment",
        label: "wf_cycle_experiment",
        command,
        exit_code: execResult.exitCode,
        ok: execResult.exitCode === 0,
        out_dir: experimentDir
      };
      if (execResult.error) {
        stepSummary.error = execResult.error;
      }

      const summaryPath = join(experimentDir, "experiment_summary.json");
      if (existsSync(summaryPath)) {
        try {
          const experimentSummary = JSON.parse(readFileSync(summaryPath, "utf8"));
          stepSummary.summary = experimentSummary;
          stepSummary.ok = stepSummary.ok && experimentSummary.ok !== false;
        } catch (err) {
          stepSummary.summary_error = err.message;
          stepSummary.ok = false;
        }
      } else {
        stepSummary.summary_error = "experiment_summary.json missing";
        stepSummary.ok = false;
      }

      writeFileSync(join(stepDir, "result.json"), JSON.stringify(stepSummary, null, 2), "utf8");

      const finalResult = {
        runId,
        ok: stepSummary.ok,
        experiment_summary: join("wf_cycle_experiment", "experiment_summary.json"),
        steps: [stepSummary]
      };
      writeFileSync(join(runRoot, "result.json"), JSON.stringify(finalResult, null, 2), "utf8");
      return finalResult;
    }
  );
}
