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
  episode_store: { enabled: true, reason: "episode store enabled by default policy" },
  finish_branch: {
    enabled: true,
    mode: "preflight",
    base: "origin/main",
    reason: "finish branch enabled by default policy",
  },
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

function mergeEpisodeStoreStep(cfg, fallback) {
  return {
    enabled: typeof cfg?.enabled === "boolean" ? cfg.enabled : (fallback?.enabled ?? true),
    strict: typeof cfg?.strict === "boolean" ? cfg.strict : false,
    reason: cfg?.reason ?? fallback?.reason ?? (cfg?.enabled === false ? "disabled in request" : ""),
  };
}

function mergeFinishBranchStep(cfg, fallback) {
  return {
    enabled: typeof cfg?.enabled === "boolean" ? cfg.enabled : (fallback?.enabled ?? true),
    mode: typeof cfg?.mode === "string" ? cfg.mode : fallback?.mode || "preflight",
    base: typeof cfg?.base === "string" ? cfg.base : fallback?.base || "origin/main",
    reason: cfg?.reason ?? fallback?.reason ?? (cfg?.enabled === false ? "disabled in request" : ""),
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
    episode_store: mergeEpisodeStoreStep(stepsReq.episode_store, defaultPolicy.episode_store),
    finish_branch: mergeFinishBranchStep(stepsReq.finish_branch, defaultPolicy.finish_branch),
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
const resultPath = path.join(runDir, "station_cycle_result.json");

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
const finishBranchWrapperScript = path.resolve(
  repoRoot,
  ".codex",
  "skills",
  "mova_finish_branch_v1",
  "scripts",
  "run.mjs"
);
const storeWrapperScript = path.resolve(
  repoRoot,
  ".codex",
  "skills",
  "mova_skill_ingest_store_episode_basic",
  "scripts",
  "run.mjs"
);

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

function collectEvidencePaths(extra = []) {
  const set = new Set([relRepo(runDir), relRepo(policyEventsPath)]);
  for (const step of stepResults) {
    if (step.log) set.add(step.log);
    if (step.output) set.add(step.output);
    if (step.report_json) set.add(step.report_json);
    if (step.result_json) set.add(step.result_json);
  }
  for (const item of extra) if (item) set.add(relRepo(item));
  return Array.from(set);
}
function relRepo(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

function hasFatalFailures(list = stepResults) {
  return list.some((s) => s.status === "fail" && s.fatal !== false);
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

function runEpisodeStoreStep(config, baselineStatus) {
  const name = "episode_store";
  const logPath = path.join(runDir, `${name}.log`);
  const policyEval = evaluatePolicy(name);
  const policyRef = relRepo(policyPath);
  const evidencePath = path.join(runDir, "episode_store_evidence.json");

  function writeEvidence(data) {
    const payload = {
      run_id: runId,
      step: name,
      timestamp: new Date().toISOString(),
      ...data,
    };
    fs.writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
    return relRepo(evidencePath);
  }

  if (!config.enabled) {
    const reason = config.reason || "episode store disabled";
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

  const storeScriptExists = fs.existsSync(storeWrapperScript);
  if (!storeScriptExists) {
    const reason = "episode store wrapper unavailable locally; skipping";
    fs.writeFileSync(logPath, `skipped: ${reason}\n`, "utf8");
    const evidenceRel = writeEvidence({ status: "skipped", reason });
    appendPolicyEvent({
      step: name,
      enabled: true,
      decision: policyDecision,
      reason,
      policy_ref: policyRef,
      exit_code: null,
    });
    stepResults.push({
      name,
      enabled: true,
      status: "skipped",
      exit_code: null,
      log: relRepo(logPath),
      output: evidenceRel,
      reason,
      policy: { decision: policyDecision, policy_ref: policyRef },
      fatal: false,
    });
    return;
  }

  const episodePath = path.join(runDir, "episode.json");
  const storeRequestPath = path.join(runDir, "store_episode_request.json");
  const episodeId = `station_cycle_v1__${runId}`;
  const now = new Date();
  const envelopeId = `station_cycle_store__${runId}`;
  const envelope = {
    mova_version: "4.0.0",
    envelope_type: "env.skill_ingest_run_store_episode_v1",
    envelope_id: envelopeId,
    requested_by: "station_cycle_v1",
    requested_at: now.toISOString(),
    episode: {
      mova_version: "4.0.0",
      episode_id: episodeId,
      envelope_id: envelopeId,
      run_result: {
        mova_version: "4.0.0",
        run_id: runId,
        status: baselineStatus === "failed" ? "failed" : "success",
        timing: {
          started_at: startedAt.toISOString(),
          finished_at: now.toISOString(),
          duration_ms: now.getTime() - startedAt.getTime(),
        },
        output_locations: {
          data_dir: relRepo(runDir),
        },
      },
      notes: "Auto-stored station cycle episode",
      context: {
        executor: "station_cycle_v1",
        repo: path.basename(repoRoot),
        tool_version: "station_cycle_v1.5",
        project_id: "station_cycle",
      },
    },
  };
  fs.writeFileSync(storeRequestPath, JSON.stringify(envelope, null, 2));

  const episodeRecord = {
    episode_id: episodeId,
    type: "station_cycle_run_v1",
    ts: now.toISOString(),
    policy_ref: relRepo(policyPath),
    policy_events_log: relRepo(policyEventsPath),
    request_ref: requestAbs ? relRepo(requestAbs) : "(default)",
    result_ref: relRepo(resultPath),
    evidence: collectEvidencePaths([episodePath, storeRequestPath]),
    summary: {
      run_id: runId,
      status: baselineStatus,
      steps: stepResults.map((s) => ({
        name: s.name,
        status: s.status,
        log: s.log,
        output: s.output,
      })),
    },
  };
  fs.writeFileSync(episodePath, JSON.stringify(episodeRecord, null, 2));

  let child;
  try {
    child = spawnSync(
      process.execPath,
      [storeWrapperScript, "--request", storeRequestPath],
      { cwd: repoRoot, encoding: "utf8" }
    );
  } catch (err) {
    child = { status: null, stdout: "", stderr: err.message, error: err };
  }
  const combined = `${child.stdout ?? ""}${child.stderr ?? ""}` || "no output\n";
  fs.writeFileSync(logPath, combined, "utf8");

  let outputPath = null;
  try {
    const parsed = JSON.parse(child.stdout || "");
    outputPath = path.join(runDir, "episode_store_result.json");
    fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
  } catch {
    outputPath = null;
  }

  const exitFailed = child.error || (child.status ?? 1) !== 0;
  if (exitFailed && !config.strict) {
    const reason =
      child.error?.message ||
      `episode store exited with code ${child.status ?? "unknown"}; skipping in local mode`;
    const evidenceRel = writeEvidence({ status: "skipped", reason });
    appendPolicyEvent({
      step: name,
      enabled: true,
      decision: policyDecision,
      reason,
      policy_ref: policyRef,
      exit_code: child.status ?? 1,
    });
    stepResults.push({
      name,
      enabled: true,
      status: "skipped",
      exit_code: child.status ?? 1,
      log: relRepo(logPath),
      output: evidenceRel,
      reason,
      policy: { decision: policyDecision, policy_ref: policyRef },
      fatal: false,
    });
    return;
  }

  const status = child.status === 0 ? "pass" : "fail";
  const fatal = status === "fail" && config.strict;
  stepResults.push({
    name,
    enabled: true,
    status,
    exit_code: child.status ?? 1,
    log: relRepo(logPath),
    output: outputPath ? relRepo(outputPath) : null,
    reason:
      status === "fail"
        ? fatal
          ? "episode store failed (strict)"
          : "episode store failed (non-strict)"
        : null,
    policy: { decision: policyDecision, policy_ref: policyRef },
    fatal,
  });
  appendPolicyEvent({
    step: name,
    enabled: true,
    decision: policyDecision,
    reason: status === "fail" ? (fatal ? "fatal failure" : "non-strict failure") : null,
    policy_ref: policyRef,
    exit_code: child.status ?? 1,
  });
}

function runFinishBranchStep(config) {
  const name = "finish_branch";
  const logPath = path.join(runDir, `${name}.log`);
  const policyEval = evaluatePolicy(name);
  const policyRef = relRepo(policyPath);

  if (!config.enabled) {
    const reason = config.reason || "finish_branch disabled";
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

  const finishRequest = {
    base_branch: config.base || "origin/main",
    mode: config.mode || "preflight",
  };
  if (normalizedRequest.notes) finishRequest.notes = normalizedRequest.notes;
  const requestPath = path.join(runDir, "finish_branch_request.json");
  fs.writeFileSync(requestPath, JSON.stringify(finishRequest, null, 2));

  const child = spawnSync(
    process.execPath,
    [finishBranchWrapperScript, "--request", requestPath],
    { cwd: repoRoot, encoding: "utf8" }
  );

  const combined = `${child.stdout ?? ""}${child.stderr ?? ""}` || "no output\n";
  fs.writeFileSync(logPath, combined, "utf8");

  let parsed = null;
  let resultCopyPath = null;
  try {
    parsed = JSON.parse(child.stdout || "");
    resultCopyPath = path.join(runDir, "finish_branch_result.json");
    fs.writeFileSync(resultCopyPath, JSON.stringify(parsed, null, 2));
  } catch {
    parsed = null;
  }

  const reportMdSource = parsed?.report_md || null;
  const reportJsonSource = parsed?.report_json || null;
  const finishLogReason =
    policyDecision === "allow_override" ? policyReason : null;

  let vendoredMd = null;
  if (reportMdSource) {
    try {
      const source = path.resolve(repoRoot, reportMdSource);
      vendoredMd = path.join(runDir, "finish_branch_report.md");
      fs.copyFileSync(source, vendoredMd);
    } catch (err) {
      vendoredMd = null;
      fs.appendFileSync(logPath, `\n[vendor] failed to copy report.md: ${err.message}\n`);
    }
  }
  let vendoredJson = null;
  if (reportJsonSource) {
    try {
      const source = path.resolve(repoRoot, reportJsonSource);
      vendoredJson = path.join(runDir, "finish_branch_report.json");
      fs.copyFileSync(source, vendoredJson);
    } catch (err) {
      vendoredJson = null;
      fs.appendFileSync(logPath, `\n[vendor] failed to copy report.json: ${err.message}\n`);
    }
  }

  stepResults.push({
    name,
    enabled: true,
    status: child.status === 0 ? "pass" : "fail",
    exit_code: child.status ?? 1,
    log: relRepo(logPath),
    output: vendoredMd
      ? relRepo(vendoredMd)
      : reportMdSource || (resultCopyPath ? relRepo(resultCopyPath) : null),
    report_md: vendoredMd ? relRepo(vendoredMd) : reportMdSource,
    report_json: vendoredJson ? relRepo(vendoredJson) : reportJsonSource,
    result_json: resultCopyPath ? relRepo(resultCopyPath) : null,
    request: relRepo(requestPath),
    report_origin_md: reportMdSource || null,
    report_origin_json: reportJsonSource || null,
    reason: finishLogReason,
    policy: { decision: policyDecision, policy_ref: policyRef },
  });
  appendPolicyEvent({
    step: name,
    enabled: true,
    decision: policyDecision,
    reason: finishLogReason,
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
runEpisodeStoreStep(steps.episode_store, hasFatalFailures(stepResults) ? "failed" : "success");
runFinishBranchStep(steps.finish_branch);

const overallStatus = hasFatalFailures() ? "fail" : "pass";
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

fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
const envPath = path.join(runDir, "station_cycle_env.json");
fs.writeFileSync(envPath, JSON.stringify(env, null, 2));

console.log(JSON.stringify(result, null, 2));
process.exit(overallStatus === "pass" ? 0 : 1);
