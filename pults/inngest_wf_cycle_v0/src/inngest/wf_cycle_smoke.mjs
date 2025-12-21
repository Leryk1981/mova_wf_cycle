import { mkdirSync, writeFileSync } from "node:fs";
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

export default function wfCycleSmoke(inngest) {
  return inngest.createFunction(
    { id: "lab.wf_cycle.smoke.v0" },
    { event: "lab/wf_cycle.smoke" },
    async ({ event, step }) => {
      const repoRoot = resolve(process.cwd(), "..", "..");
      const eventTag = event?.id || "no_event_id";
      const runId = event?.id ? String(event.id) : `${Date.now()}_${eventTag}`;
      const outDir = join(repoRoot, "lab", "inngest_runs", runId);
      mkdirSync(outDir, { recursive: true });

      const stepsDir = join(outDir, "steps");
      mkdirSync(stepsDir, { recursive: true });

      const steps = [
        { id: "01_validate", label: "validate", command: "npm run validate" },
        { id: "02_test", label: "test", command: "npm test" },
        { id: "03_smoke", label: "smoke_wf_cycle", command: "npm run smoke:wf_cycle" }
      ];

      const stepSummaries = [];
      let overallOk = true;

      for (const stepCfg of steps) {
        if (!overallOk) break;

        const currentDir = join(stepsDir, stepCfg.id);
        mkdirSync(currentDir, { recursive: true });

        const execResult = await step.run(stepCfg.label, async () => run(stepCfg.command, repoRoot));

        writeFileSync(join(currentDir, "stdout.log"), execResult.stdout, "utf8");
        writeFileSync(join(currentDir, "stderr.log"), execResult.stderr, "utf8");

        const summary = {
          id: stepCfg.id,
          label: stepCfg.label,
          command: stepCfg.command,
          exit_code: execResult.exitCode,
          ok: execResult.exitCode === 0
        };
        if (execResult.error) {
          summary.error = execResult.error;
        }

        writeFileSync(join(currentDir, "result.json"), JSON.stringify(summary, null, 2), "utf8");
        stepSummaries.push(summary);

        if (!summary.ok) {
          overallOk = false;
        }
      }

      const finalResult = { runId, ok: overallOk, steps: stepSummaries };
      writeFileSync(join(outDir, "result.json"), JSON.stringify(finalResult, null, 2), "utf8");
      return finalResult;
    }
  );
}
