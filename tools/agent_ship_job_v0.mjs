import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = path.join("artifacts", "agent_ship", runId);

function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

function usage() {
  return [
    "Usage:",
    "  node tools/agent_ship_job_v0.mjs [--vercel-cwd <path>] [--vercel-mode prod|preview] [--cf-worker-dir <path>] [--cf-env prod|dev]"
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--vercel-cwd") {
      args.vercelCwd = argv[i + 1];
      i += 1;
    } else if (token === "--vercel-mode") {
      args.vercelMode = argv[i + 1];
      i += 1;
    } else if (token === "--cf-worker-dir") {
      args.cfWorkerDir = argv[i + 1];
      i += 1;
    } else if (token === "--cf-env") {
      args.cfEnv = argv[i + 1];
      i += 1;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      args.error = `Unknown argument: ${token}`;
    }
  }
  return args;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function writeSkipDeployArtifacts({ baseDir, label, reason }) {
  await ensureDir(baseDir);
  const stdoutPath = path.join(baseDir, "stdout");
  const stderrPath = path.join(baseDir, "stderr");
  await fs.writeFile(stdoutPath, "", "utf8");
  await fs.writeFile(stderrPath, "", "utf8");
  const deployPath = path.join(baseDir, "deploy.json");
  const reportPath = path.join(baseDir, "report.json");
  await writeJson(deployPath, {
    status: "SKIP",
    reason,
    stdout_path: toPosixPath(stdoutPath),
    stderr_path: toPosixPath(stderrPath)
  });
  await writeJson(reportPath, {
    status: "SKIP",
    reason,
    duration_ms: 0,
    deploy_json: toPosixPath(deployPath)
  });
  return {
    status: "SKIP",
    reason,
    report_path: toPosixPath(reportPath),
    runner: {
      stdout_path: toPosixPath(stdoutPath),
      stderr_path: toPosixPath(stderrPath)
    }
  };
}

async function runCommand({ label, command, args, cwd, outDir }) {
  await ensureDir(outDir);
  const stdoutPath = path.join(outDir, "stdout");
  const stderrPath = path.join(outDir, "stderr");
  const stdoutStream = fsSync.createWriteStream(stdoutPath, { encoding: "utf8" });
  const stderrStream = fsSync.createWriteStream(stderrPath, { encoding: "utf8" });
  const start = Date.now();

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          CI: "1"
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32"
      });
    } catch (error) {
      stdoutStream.end();
      stderrStream.end();
      resolve({
        label,
        status: "FAIL",
        exit_code: -1,
        duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        stdout_path: toPosixPath(stdoutPath),
        stderr_path: toPosixPath(stderrPath)
      });
      return;
    }

    child.stdout.on("data", (chunk) => stdoutStream.write(chunk));
    child.stderr.on("data", (chunk) => stderrStream.write(chunk));

    child.on("error", (error) => {
      stdoutStream.end();
      stderrStream.end();
      resolve({
        label,
        status: "FAIL",
        exit_code: -1,
        duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        stdout_path: toPosixPath(stdoutPath),
        stderr_path: toPosixPath(stderrPath)
      });
    });

    child.on("close", (code) => {
      stdoutStream.end();
      stderrStream.end();
      resolve({
        label,
        status: code === 0 ? "PASS" : "FAIL",
        exit_code: typeof code === "number" ? code : -1,
        duration_ms: Date.now() - start,
        stdout_path: toPosixPath(stdoutPath),
        stderr_path: toPosixPath(stderrPath)
      });
    });
  });
}

async function runJsonCommand({ label, command, args, cwd, outDir }) {
  await ensureDir(outDir);
  const stdoutPath = path.join(outDir, "stdout");
  const stderrPath = path.join(outDir, "stderr");
  const stdoutStream = fsSync.createWriteStream(stdoutPath, { encoding: "utf8" });
  const stderrStream = fsSync.createWriteStream(stderrPath, { encoding: "utf8" });
  const start = Date.now();
  let stdoutBuffer = "";

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          CI: "1"
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32"
      });
    } catch (error) {
      stdoutStream.end();
      stderrStream.end();
      resolve({
        label,
        status: "FAIL",
        exit_code: -1,
        duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        stdout_path: toPosixPath(stdoutPath),
        stderr_path: toPosixPath(stderrPath),
        stdout_json: null
      });
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdoutStream.write(chunk);
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      stdoutBuffer += text;
    });
    child.stderr.on("data", (chunk) => stderrStream.write(chunk));

    child.on("error", (error) => {
      stdoutStream.end();
      stderrStream.end();
      resolve({
        label,
        status: "FAIL",
        exit_code: -1,
        duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        stdout_path: toPosixPath(stdoutPath),
        stderr_path: toPosixPath(stderrPath),
        stdout_json: null
      });
    });

    child.on("close", (code) => {
      stdoutStream.end();
      stderrStream.end();
      let parsed = null;
      try {
        parsed = JSON.parse(stdoutBuffer.trim());
      } catch {
        parsed = null;
      }
      resolve({
        label,
        status: code === 0 ? "PASS" : "FAIL",
        exit_code: typeof code === "number" ? code : -1,
        duration_ms: Date.now() - start,
        stdout_path: toPosixPath(stdoutPath),
        stderr_path: toPosixPath(stderrPath),
        stdout_json: parsed
      });
    });
  });
}

async function pathExists(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.error) {
    throw new Error(`${args.error}\n${usage()}`);
  }

  const startedAt = new Date().toISOString();
  await ensureDir(artifactsDir);

  const gatesDir = path.join(artifactsDir, "gates");
  const gateResults = {};
  const gateSteps = [
    {
      id: "validate",
      command: "npm",
      args: ["run", "validate"]
    },
    {
      id: "test",
      command: "npm",
      args: ["test"]
    },
    {
      id: "smoke_wf_cycle",
      command: "npm",
      args: ["run", "smoke:wf_cycle"]
    }
  ];

  let gatesOk = true;
  for (const step of gateSteps) {
    const result = await runCommand({
      label: step.id,
      command: step.command,
      args: step.args,
      cwd: process.cwd(),
      outDir: path.join(gatesDir, step.id)
    });
    gateResults[step.id] = result;
    if (result.status !== "PASS") {
      gatesOk = false;
      break;
    }
  }

  const deployResults = {};
  if (!gatesOk) {
    deployResults.vercel = await writeSkipDeployArtifacts({
      baseDir: path.join(artifactsDir, "deploy", "vercel"),
      label: "vercel",
      reason: "gates failed"
    });
    deployResults.cf_worker = await writeSkipDeployArtifacts({
      baseDir: path.join(artifactsDir, "deploy", "cf_worker"),
      label: "cf_worker",
      reason: "gates failed"
    });
  } else {
    const vercelCwd = args.vercelCwd || process.env.SHIP_VERCEL_CWD || null;
    const vercelMode = args.vercelMode || process.env.SHIP_VERCEL_MODE || "preview";
    if (!vercelCwd) {
      deployResults.vercel = await writeSkipDeployArtifacts({
        baseDir: path.join(artifactsDir, "deploy", "vercel"),
        label: "vercel",
        reason: "missing SHIP_VERCEL_CWD"
      });
    } else if (!(await pathExists(vercelCwd))) {
      deployResults.vercel = await writeSkipDeployArtifacts({
        baseDir: path.join(artifactsDir, "deploy", "vercel"),
        label: "vercel",
        reason: `missing path: ${vercelCwd}`
      });
    } else {
      const vercelArgs = [
        path.join("tools", "vercel_deploy_v0.mjs"),
        vercelMode === "prod" ? "--prod" : "--preview",
        "--cwd",
        vercelCwd
      ];
      const result = await runJsonCommand({
        label: "vercel",
        command: process.execPath,
        args: vercelArgs,
        cwd: process.cwd(),
        outDir: path.join(artifactsDir, "deploy", "vercel")
      });
      deployResults.vercel = {
        status: result.stdout_json?.status || result.status,
        url: result.stdout_json?.url ?? null,
        duration_ms: result.stdout_json?.duration_ms ?? result.duration_ms,
        report_path: result.stdout_json?.report_path ?? null,
        runner: {
          exit_code: result.exit_code,
          stdout_path: result.stdout_path,
          stderr_path: result.stderr_path
        }
      };
    }

    const cfWorkerDir = args.cfWorkerDir || process.env.SHIP_CF_WORKER_DIR || null;
    const cfEnv = args.cfEnv || process.env.SHIP_CF_ENV || "prod";
    if (!cfWorkerDir) {
      deployResults.cf_worker = await writeSkipDeployArtifacts({
        baseDir: path.join(artifactsDir, "deploy", "cf_worker"),
        label: "cf_worker",
        reason: "missing SHIP_CF_WORKER_DIR"
      });
    } else if (!(await pathExists(cfWorkerDir))) {
      deployResults.cf_worker = await writeSkipDeployArtifacts({
        baseDir: path.join(artifactsDir, "deploy", "cf_worker"),
        label: "cf_worker",
        reason: `missing path: ${cfWorkerDir}`
      });
    } else {
      const cfArgs = [
        path.join("tools", "cf_worker_deploy_v0.mjs"),
        "--cwd",
        cfWorkerDir,
        "--env",
        cfEnv
      ];
      const result = await runJsonCommand({
        label: "cf_worker",
        command: process.execPath,
        args: cfArgs,
        cwd: process.cwd(),
        outDir: path.join(artifactsDir, "deploy", "cf_worker")
      });
      deployResults.cf_worker = {
        status: result.stdout_json?.status || result.status,
        worker_url: result.stdout_json?.worker_url ?? null,
        duration_ms: result.stdout_json?.duration_ms ?? result.duration_ms,
        report_path: result.stdout_json?.report_path ?? null,
        runner: {
          exit_code: result.exit_code,
          stdout_path: result.stdout_path,
          stderr_path: result.stderr_path
        }
      };
    }
  }

  const finishedAt = new Date().toISOString();
  const overallStatus =
    gatesOk &&
    ["PASS", "SKIP"].includes(deployResults.vercel?.status ?? "SKIP") &&
    ["PASS", "SKIP"].includes(deployResults.cf_worker?.status ?? "SKIP")
      ? "PASS"
      : "FAIL";

  const report = {
    run_id: runId,
    status: overallStatus,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Date.parse(finishedAt) - Date.parse(startedAt),
    artifacts_dir: toPosixPath(artifactsDir),
    gates: gateResults,
    deploy: deployResults
  };

  const reportPath = path.join(artifactsDir, "agent_job_report.json");
  await writeJson(reportPath, report);

  console.log(`report_path=${toPosixPath(reportPath)}`);
  console.log(
    `status=${overallStatus} gates=${gatesOk ? "PASS" : "FAIL"} vercel=${deployResults.vercel?.status ?? "SKIP"} cf_worker=${deployResults.cf_worker?.status ?? "SKIP"}`
  );

  if (overallStatus !== "PASS") {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await ensureDir(artifactsDir);
    const reportPath = path.join(artifactsDir, "agent_job_report.json");
    await writeJson(reportPath, {
      run_id: runId,
      status: "FAIL",
      error: message,
      artifacts_dir: toPosixPath(artifactsDir)
    });
    console.log(`report_path=${toPosixPath(reportPath)}`);
    console.log("status=FAIL");
  } catch {
    console.log("status=FAIL");
  }
  process.exitCode = 1;
});
