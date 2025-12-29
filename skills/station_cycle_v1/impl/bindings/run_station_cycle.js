const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const requestArg = getArg("--request");
if (!requestArg) {
  console.error("Missing --request <path>");
  process.exit(1);
}

const requestAbs = path.resolve(process.cwd(), requestArg);
let request = {};
try {
  request = JSON.parse(fs.readFileSync(requestAbs, "utf8"));
} catch (err) {
  console.error("Failed to read request JSON:", err.message);
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "../../../..");
const artifactsRoot = path.join(repoRoot, "artifacts", "station_cycle");
fs.mkdirSync(artifactsRoot, { recursive: true });

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(artifactsRoot, runId);
fs.mkdirSync(runDir, { recursive: true });

const stepResults = [];

const wrappers = {
  snapshot: {
    script: ".codex/skills/mova_repo_snapshot_basic/scripts/run.mjs",
    needsRequest: true,
  },
  gates: {
    script: ".codex/skills/mova_run_gates/scripts/run.mjs",
    needsRequest: false,
  },
  wf_scaffold: {
    script: ".codex/skills/mova_wf_cycle_scaffold_basic/scripts/run.mjs",
    needsRequest: true,
  },
  wf_compare: {
    script: ".codex/skills/mova_wf_cycle_compute_compare_basic/scripts/run.mjs",
    needsRequest: true,
  },
  wf_winner_pack: {
    script: ".codex/skills/mova_wf_cycle_winner_pack_basic/scripts/run.mjs",
    needsRequest: true,
  },
};

function relRepo(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

function runWrapper(name, config, wrapper) {
  const enabled = !!(config && config.enabled);
  const logPath = path.join(runDir, `${name}.log`);

  if (!enabled) {
    fs.writeFileSync(logPath, "skipped\n", "utf8");
    stepResults.push({
      name,
      enabled: false,
      status: "skipped",
      exit_code: null,
      log: relRepo(logPath),
      output: null,
    });
    return;
  }

  const args = [path.resolve(repoRoot, wrapper.script)];
  let tempRequestPath = null;

  if (wrapper.needsRequest) {
    const payload = config.request ?? {};
    tempRequestPath = path.join(runDir, `${name}_request.json`);
    fs.writeFileSync(tempRequestPath, JSON.stringify(payload, null, 2));
    args.push("--request", tempRequestPath);
  }

  const child = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  const combined = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  fs.writeFileSync(logPath, combined, "utf8");

  let outputPath = null;
  try {
    const parsed = JSON.parse(child.stdout);
    outputPath = path.join(runDir, `${name}_result.json`);
    fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
  } catch {
    outputPath = null;
  }

  stepResults.push({
    name,
    enabled: true,
    status: child.status === 0 ? "pass" : "fail",
    exit_code: child.status ?? 1,
    log: relRepo(logPath),
    output: outputPath ? relRepo(outputPath) : null,
  });
}

const steps = request.steps || {};
const wfCycle = steps.wf_cycle || {};

runWrapper("snapshot", steps.snapshot, wrappers.snapshot);
runWrapper("gates", steps.gates, wrappers.gates);
runWrapper("wf_scaffold", wfCycle.scaffold, wrappers.wf_scaffold);
runWrapper("wf_compare", wfCycle.compare, wrappers.wf_compare);
runWrapper("wf_winner_pack", wfCycle.winner_pack, wrappers.wf_winner_pack);

const overallStatus = stepResults.some((s) => s.status === "fail") ? "fail" : "pass";
const result = {
  skill: "station_cycle_v1",
  run_id: runId,
  status: overallStatus,
  artifacts_dir: relRepo(runDir),
  steps: stepResults,
  notes: request.notes || "",
};

const env = {
  run_id: runId,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  artifacts_dir: relRepo(runDir),
  request_path: relRepo(requestAbs),
};

const resultPath = path.join(runDir, "station_cycle_result.json");
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
const envPath = path.join(runDir, "station_cycle_env.json");
fs.writeFileSync(envPath, JSON.stringify(env, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(overallStatus === "pass" ? 0 : 1);
