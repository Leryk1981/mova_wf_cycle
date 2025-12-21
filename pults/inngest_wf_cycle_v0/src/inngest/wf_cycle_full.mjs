import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec } from "node:child_process";

function run(cmd, cwd) {
  return new Promise((resolvePromise) => {
    exec(
      cmd,
      { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
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

export default function wfCycleFull(inngest) {
  return inngest.createFunction(
    { id: "lab.wf_cycle.full.v0" },
    { event: "lab/wf_cycle.full" },
    async ({ event, step }) => {
      const repoRoot = resolve(process.cwd(), "..", "..");
      const eventTag = event?.id || "no_event_id";
      const runId = event?.id ? String(event.id) : `${Date.now()}_${eventTag}`;
      const runRoot = join(repoRoot, "lab", "inngest_runs", runId);
      mkdirSync(runRoot, { recursive: true });

      const stepsDir = join(runRoot, "steps");
      mkdirSync(stepsDir, { recursive: true });
      const wfCycleDir = join(runRoot, "wf_cycle_full");
      const stepDir = join(stepsDir, "01_wf_cycle_full");
      mkdirSync(stepDir, { recursive: true });

      const fixtureDir = "lab/examples/wf_cycle_public_fixture";
      const command = [
        "node",
        "tools/wf_cycle_run_keep_artifacts_ci.mjs",
        "--out",
        `"${wfCycleDir}"`,
        "--fixture",
        `"${fixtureDir}"`
      ].join(" ");

      const execResult = await step.run("wf_cycle_full", async () => run(command, repoRoot));

      writeFileSync(join(stepDir, "stdout.log"), execResult.stdout, "utf8");
      writeFileSync(join(stepDir, "stderr.log"), execResult.stderr, "utf8");

      const stepSummary = {
        id: "01_wf_cycle_full",
        label: "wf_cycle_full",
        command,
        exit_code: execResult.exitCode,
        ok: execResult.exitCode === 0,
        out_dir: wfCycleDir
      };
      if (execResult.error) {
        stepSummary.error = execResult.error;
      }

      const summaryPath = join(wfCycleDir, "run_summary.json");
      if (existsSync(summaryPath)) {
        try {
          const runnerSummary = JSON.parse(readFileSync(summaryPath, "utf8"));
          stepSummary.runner_summary = runnerSummary;
          stepSummary.ok = stepSummary.ok && runnerSummary.ok !== false;
        } catch (err) {
          stepSummary.runner_summary_error = err.message;
          stepSummary.ok = false;
        }
      } else {
        stepSummary.runner_summary_error = "run_summary.json missing";
        stepSummary.ok = false;
      }

      const overallOk = stepSummary.ok;
      writeFileSync(
        join(stepDir, "result.json"),
        JSON.stringify(stepSummary, null, 2),
        "utf8"
      );

      const finalResult = {
        runId,
        ok: overallOk,
        outDir: wfCycleDir,
        steps: [stepSummary]
      };
      writeFileSync(join(runRoot, "result.json"), JSON.stringify(finalResult, null, 2), "utf8");
      return finalResult;
    }
  );
}
