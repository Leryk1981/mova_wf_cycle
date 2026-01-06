import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = path.join("artifacts", "cf_worker_deploy", runId);
const stdoutPath = path.join(artifactsDir, "stdout");
const stderrPath = path.join(artifactsDir, "stderr");
const MAX_PARSE_BYTES = 200000;

function usage() {
  return [
    "Usage:",
    "  node tools/cf_worker_deploy_v0.mjs --cwd <worker_dir> --env prod|dev"
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    cwd: null,
    env: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--cwd") {
      args.cwd = argv[i + 1];
      i += 1;
    } else if (token === "--env") {
      args.env = argv[i + 1];
      i += 1;
    } else if (token === "--help" || token === "-h") {
      return { ...args, help: true };
    } else {
      return { ...args, error: `Unknown argument: ${token}` };
    }
  }

  return args;
}

function presentLen(value) {
  if (!value) {
    return "missing";
  }
  return `present len=${String(value).length}`;
}

function envSummary() {
  return {
    CLOUDFLARE_API_TOKEN: presentLen(process.env.CLOUDFLARE_API_TOKEN),
    CLOUDFLARE_API_KEY: presentLen(process.env.CLOUDFLARE_API_KEY),
    CLOUDFLARE_ACCOUNT_ID: presentLen(process.env.CLOUDFLARE_ACCOUNT_ID)
  };
}

function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

async function ensureEmptyFile(filePath) {
  await fs.writeFile(filePath, "", "utf8");
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function runProcess(command, args, options) {
  const start = Date.now();
  const stdoutStream = fsSync.createWriteStream(stdoutPath, { encoding: "utf8" });
  const stderrStream = fsSync.createWriteStream(stderrPath, { encoding: "utf8" });
  let stdoutBuffer = "";

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, options);
    } catch (error) {
      const durationMs = Date.now() - start;
      stdoutStream.end();
      stderrStream.end();
      resolve({
        status: "FAIL",
        exit_code: -1,
        duration_ms: durationMs,
        error: error instanceof Error ? error.message : String(error),
        stdout_sample: stdoutBuffer
      });
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdoutStream.write(chunk);
      if (stdoutBuffer.length < MAX_PARSE_BYTES) {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        stdoutBuffer += text.slice(0, Math.max(0, MAX_PARSE_BYTES - stdoutBuffer.length));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrStream.write(chunk);
    });

    child.on("error", (error) => {
      const durationMs = Date.now() - start;
      stdoutStream.end();
      stderrStream.end();
      resolve({
        status: "FAIL",
        exit_code: -1,
        duration_ms: durationMs,
        error: error instanceof Error ? error.message : String(error),
        stdout_sample: stdoutBuffer
      });
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      stdoutStream.end();
      stderrStream.end();
      resolve({
        status: code === 0 ? "PASS" : "FAIL",
        exit_code: typeof code === "number" ? code : -1,
        duration_ms: durationMs,
        stdout_sample: stdoutBuffer
      });
    });
  });
}

function extractUrl(text) {
  if (!text) {
    return null;
  }
  const matches = text.match(/https?:\/\/[^\s"'<>]+/g);
  if (!matches || matches.length === 0) {
    return null;
  }
  return matches.find((url) => url.includes("workers.dev")) || matches[matches.length - 1];
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
  if (!args.cwd || !args.env) {
    throw new Error(`Missing required args.\n${usage()}`);
  }
  if (!["prod", "dev"].includes(args.env)) {
    throw new Error(`Invalid --env ${args.env}. Expected prod|dev.`);
  }

  await fs.mkdir(artifactsDir, { recursive: true });

  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY;
  if (!token) {
    await ensureEmptyFile(stdoutPath);
    await ensureEmptyFile(stderrPath);
    const deployPayload = {
      run_id: runId,
      status: "SKIP",
      reason: "missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY",
      env: args.env,
      cwd: args.cwd,
      env_summary: envSummary(),
      stdout_path: toPosixPath(stdoutPath),
      stderr_path: toPosixPath(stderrPath)
    };
    const deployPath = path.join(artifactsDir, "deploy.json");
    const reportPath = path.join(artifactsDir, "report.json");
    await writeJson(deployPath, deployPayload);
    await writeJson(reportPath, {
      run_id: runId,
      status: "SKIP",
      reason: deployPayload.reason,
      duration_ms: 0,
      worker_url: null,
      artifacts_dir: toPosixPath(artifactsDir),
      deploy_json: toPosixPath(deployPath)
    });
    console.log(
      JSON.stringify({
        status: "SKIP",
        worker_url: null,
        duration_ms: 0,
        report_path: toPosixPath(reportPath)
      })
    );
    return;
  }

  const resolvedCwd = path.resolve(process.cwd(), args.cwd);
  const commandArgs = args.env === "prod" ? ["deploy"] : ["deploy", "--env", args.env];
  const runResult = await runProcess("wrangler", commandArgs, {
    cwd: resolvedCwd,
    env: {
      ...process.env,
      CI: "1"
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  const workerUrl = extractUrl(runResult.stdout_sample);
  const deployPayload = {
    run_id: runId,
    status: runResult.status,
    exit_code: runResult.exit_code,
    duration_ms: runResult.duration_ms,
    env: args.env,
    cwd: resolvedCwd,
    command: "wrangler",
    args: commandArgs,
    worker_url: workerUrl,
    env_summary: envSummary(),
    stdout_path: toPosixPath(stdoutPath),
    stderr_path: toPosixPath(stderrPath),
    error: runResult.error || null
  };
  const deployPath = path.join(artifactsDir, "deploy.json");
  const reportPath = path.join(artifactsDir, "report.json");
  await writeJson(deployPath, deployPayload);
  await writeJson(reportPath, {
    run_id: runId,
    status: runResult.status,
    duration_ms: runResult.duration_ms,
    worker_url: workerUrl,
    artifacts_dir: toPosixPath(artifactsDir),
    deploy_json: toPosixPath(deployPath)
  });

  console.log(
    JSON.stringify({
      status: runResult.status,
      worker_url: workerUrl,
      duration_ms: runResult.duration_ms,
      report_path: toPosixPath(reportPath)
    })
  );
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await fs.mkdir(artifactsDir, { recursive: true });
    await ensureEmptyFile(stdoutPath);
    await ensureEmptyFile(stderrPath);
    const deployPath = path.join(artifactsDir, "deploy.json");
    const reportPath = path.join(artifactsDir, "report.json");
    await writeJson(deployPath, {
      run_id: runId,
      status: "FAIL",
      reason: message,
      env_summary: envSummary(),
      stdout_path: toPosixPath(stdoutPath),
      stderr_path: toPosixPath(stderrPath)
    });
    await writeJson(reportPath, {
      run_id: runId,
      status: "FAIL",
      reason: message,
      duration_ms: 0,
      worker_url: null,
      artifacts_dir: toPosixPath(artifactsDir),
      deploy_json: toPosixPath(deployPath)
    });
    console.log(
      JSON.stringify({
        status: "FAIL",
        worker_url: null,
        duration_ms: 0,
        report_path: toPosixPath(reportPath)
      })
    );
  } catch {
    console.log(
      JSON.stringify({
        status: "FAIL",
        worker_url: null,
        duration_ms: 0,
        report_path: null
      })
    );
  }
  process.exitCode = 1;
});
