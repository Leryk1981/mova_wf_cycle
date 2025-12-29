const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const defaultPolicy = {
  snapshot: { enabled: false, reason: "disabled by default policy (snapshot handled separately)" },
  gates: { enabled: false, reason: "disabled by default policy (gates opt-in)" },
  wf_cycle: {
    scaffold: { enabled: false, reason: "wf scaffold disabled by default policy" },
    compare: { enabled: false, reason: "wf compare disabled by default policy" },
    winner_pack: { enabled: false, reason: "wf winner pack disabled by default policy" },
  },
};

function mergeStep(cfg, fallback) {
  if (!cfg) return { enabled: fallback.enabled, request: fallback.request || {}, reason: fallback.reason };
  return {
    enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : (fallback.enabled ?? false),
    request: cfg.request ?? fallback.request ?? {},
    reason: cfg.reason ?? fallback.reason ?? (cfg.enabled ? "" : "disabled in request"),
  };
}

const requestArg = getArg("--request");
let requestAbs = null;
let requestRaw = {};

if (requestArg) {
  requestAbs = path.resolve(process.cwd(), requestArg);
  try {
    requestRaw = JSON.parse(fs.readFileSync(requestAbs, "utf8"));
  } catch (err) {
    console.error("Failed to read request JSON:", err.message);
    process.exit(1);
  }
}

const stepsReq = requestRaw.steps || {};
const wfReq = stepsReq.wf_cycle || {};

const policyOverrideRaw = requestRaw.policy_override || {};
const policyOverride = {
  allow_steps: Array.isArray(policyOverrideRaw.allow_steps) ? policyOverrideRaw.allow_steps : [],
  reason: policyOverrideRaw.reason || "",
};

const normalizedRequest = {
  notes: requestRaw.notes || "",
  steps: {
    snapshot: mergeStep(stepsReq.snapshot, defaultPolicy.snapshot),
    gates: mergeStep(stepsReq.gates, defaultPolicy.gates),
    wf_cycle: {
      scaffold: mergeStep(wfReq.scaffold, defaultPolicy.wf_cycle.scaffold),
      compare: mergeStep(wfReq.compare, defaultPolicy.wf_cycle.compare),
      winner_pack: mergeStep(wfReq.winner_pack, defaultPolicy.wf_cycle.winner_pack),
    },
  },
};

const repoRoot = path.resolve(__dirname, "../../../..");
const artifactsRoot = path.join(repoRoot, "artifacts", "station_cycle");
fs.mkdirSync(artifactsRoot, { recursive: true });

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(artifactsRoot, runId);
fs.mkdirSync(runDir, { recursive: true });

const policyPath = path.join(
  repoRoot,
  "skills",
  "station_cycle_v1",
  "policy",
  "policy.station_cycle_v0.json"
);
let policy = {
  version: "v0",
  default: "deny",
  allow_steps: [],
  deny_steps: [],
};
try {
  policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
} catch (err) {
  console.warn("station_cycle policy missing or invalid, fallback to default deny:", err.message);
}

function evaluatePolicy(stepName) {
  if (policy.deny_steps && policy.deny_steps.includes(stepName)) {
    return { decision: "deny", reason: `policy deny for ${stepName}` };
  }
  if (policy.allow_steps && policy.allow_steps.includes(stepName)) {
    return { decision: "allow", reason: null };
  }
  const fallback = policy.default === "allow" ? "allow" : "deny";
  return { decision: fallback, reason: fallback === "deny" ? "policy default deny" : null };
}

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

const startedAt = new Date();
const stepResults = [];
let overrideSaved = false;
const overridePath = path.join(runDir, "policy_override.json");
if (Object.keys(policyOverrideRaw).length) {
  fs.writeFileSync(overridePath, JSON.stringify(policyOverride, null, 2));
  overrideSaved = true;
}
const policyEventsPath = path.join(runDir, "policy_events.jsonl");
function appendPolicyEvent(event) {
  fs.appendFileSync(policyEventsPath, JSON.stringify(event) + "\n");
}

function relRepo(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

function runWrapper(name, config, wrapper) {
  const enabled = !!config.enabled;
  const logPath = path.join(runDir, `${name}.log`);
  const policyEval = evaluatePolicy(name);
  const policyRef = relRepo(policyPath);

  if (!enabled) {
    const reason = config.reason || "disabled by request";
    fs.writeFileSync(logPath, `skipped: ${reason}\n`, "utf8");
    appendPolicyEvent({
      step: name,
      enabled: false,
      decision: "not_requested",
      reason,
      policy_ref: policyRef,
    });
    stepResults.push({
      name,
      enabled: false,
      status: "skipped",
      exit_code: null,
      log: relRepo(logPath),
      output: null,
      reason,
      policy: { decision: "not_requested", policy_ref: policyRef },
    });
    return;
  }

  let policyDecision = policyEval.decision;
  let policyReason = policyEval.reason || `policy ${policy.version} denies step`;
  if (policyDecision !== "allow") {
    const canOverride =
      policy.allow_overrides && policyOverride.allow_steps.includes(name);
    if (canOverride) {
      if (!overrideSaved && Object.keys(policyOverrideRaw).length) {
        fs.writeFileSync(
          path.join(runDir, "policy_override.json"),
          JSON.stringify(policyOverride, null, 2)
        );
        overrideSaved = true;
      }
      policyDecision = "allow_override";
      policyReason = policyOverride.reason || "manual override";
      appendPolicyEvent({
        step: name,
        enabled: true,
        decision: "allow_override",
        reason: policyReason,
        policy_ref: policyRef,
      });
    } else {
      fs.writeFileSync(logPath, `skipped: ${policyReason}\n`, "utf8");
      appendPolicyEvent({
        step: name,
        enabled: true,
        decision: "deny",
        reason: policyReason,
        policy_ref: policyRef,
      });
      stepResults.push({
        name,
        enabled: true,
        status: "skipped",
        exit_code: null,
        log: relRepo(logPath),
        output: null,
        reason: policyReason,
        policy: { decision: "deny", policy_ref: policyRef },
      });
      return;
    }
  }

  const args = [path.resolve(repoRoot, wrapper.script)];
  if (wrapper.needsRequest) {
    const payload = config.request ?? {};
    const tempRequestPath = path.join(runDir, `${name}_request.json`);
    fs.writeFileSync(tempRequestPath, JSON.stringify(payload, null, 2));
    args.push("--request", tempRequestPath);
  }

  const child = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  const combined = `${child.stdout ?? ""}${child.stderr ?? ""}` || "no output\n";
  fs.writeFileSync(logPath, combined, "utf8");

  let outputPath = null;
  try {
    const parsed = JSON.parse(child.stdout || "");
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
    reason: policyDecision === "allow_override" ? policyReason : null,
    policy: { decision: policyDecision, policy_ref: policyRef },
  });
  appendPolicyEvent({
    step: name,
    enabled: true,
    decision: policyDecision,
    reason: policyDecision === "allow_override" ? policyReason : null,
    policy_ref: policyRef,
    exit_code: child.status ?? 1,
  });
}

const steps = normalizedRequest.steps;
const wfCycle = steps.wf_cycle;

runWrapper("snapshot", steps.snapshot, wrappers.snapshot);
runWrapper("gates", steps.gates, wrappers.gates);
runWrapper("wf_scaffold", wfCycle.scaffold, wrappers.wf_scaffold);
runWrapper("wf_compare", wfCycle.compare, wrappers.wf_compare);
runWrapper("wf_winner_pack", wfCycle.winner_pack, wrappers.wf_winner_pack);

const overallStatus = stepResults.some((s) => s.status === "fail") ? "fail" : "pass";
const finishedAt = new Date();

const result = {
  skill: "station_cycle_v1",
  run_id: runId,
  status: overallStatus,
  artifacts_dir: relRepo(runDir),
  steps: stepResults,
  notes: normalizedRequest.notes,
  policy_events_log: relRepo(policyEventsPath),
};

const env = {
  run_id: runId,
  started_at: startedAt.toISOString(),
  finished_at: finishedAt.toISOString(),
  artifacts_dir: relRepo(runDir),
  request_path: requestAbs ? relRepo(requestAbs) : "(default)",
};

const resultPath = path.join(runDir, "station_cycle_result.json");
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
const envPath = path.join(runDir, "station_cycle_env.json");
fs.writeFileSync(envPath, JSON.stringify(env, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(overallStatus === "pass" ? 0 : 1);
