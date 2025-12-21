
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

function quote(value) {
  return `"${value.replace(/\"/g, '\"')}"`;
}

export default function flashslotPublish(inngest) {
  return inngest.createFunction(
    { id: "lab.flashslot.publish.v0" },
    { event: "lab/flashslot.publish" },
    async ({ event, step }) => {
      const repoRoot = resolve(process.cwd(), "..", "..");
      const runId = event?.id ? String(event.id) : `${Date.now()}_flashslot`;
      const runRoot = join(repoRoot, "lab", "inngest_runs", runId);
      const outDir = join(runRoot, "flashslot_publish");
      const stepDir = join(runRoot, "steps", "01_flashslot_publish");
      mkdirSync(outDir, { recursive: true });
      mkdirSync(stepDir, { recursive: true });

      const publishScript = join(
        repoRoot,
        "packs",
        "flashslot_v0",
        "runtime",
        "impl",
        "publish_offer_v0.mjs"
      );
      const inputPath = join(
        repoRoot,
        "packs",
        "flashslot_v0",
        "examples",
        "hypothesis_001_dentist.json"
      );
      const cmd = `${quote(process.execPath)} ${quote(publishScript)} --in ${quote(inputPath)} --out ${quote(outDir)} --driver noop --dry-run`;

      const execResult = await step.run("flashslot_publish", async () => run(cmd, repoRoot));

      writeFileSync(join(stepDir, "stdout.log"), execResult.stdout, "utf8");
      writeFileSync(join(stepDir, "stderr.log"), execResult.stderr, "utf8");

      const summary = {
        command: cmd,
        exit_code: execResult.exitCode,
        ok: execResult.exitCode === 0,
        outDir
      };
      if (execResult.error) {
        summary.error = execResult.error;
      }
      writeFileSync(join(stepDir, "result.json"), JSON.stringify(summary, null, 2), "utf8");

      const finalResult = { runId, ok: summary.ok, outDir };
      writeFileSync(join(runRoot, "result.json"), JSON.stringify(finalResult, null, 2), "utf8");

      if (!summary.ok) {
        throw new Error("FlashSlot publish inngest run failed");
      }
      return finalResult;
    }
  );
}
