#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const generatorScript = path.join(repoRoot, "packs", "domain_pack_scaffold_v0", "tools", "domain_pack_scaffold_generate_v0.mjs");
const defaultPositiveRequest = path.join(repoRoot, "packs", "domain_pack_scaffold_v0", "docs", "examples", "pos", "domain_pack_scaffold_request_min.json");
const actionsRequest = path.join(repoRoot, "packs", "domain_pack_scaffold_v0", "docs", "examples", "pos", "domain_pack_scaffold_request_with_actions.json");
const negativeSuitePath = path.join(repoRoot, "packs", "domain_pack_scaffold_v0", "docs", "domain_pack_scaffold_negative_suite_v0.json");
const qualityRoot = path.join(repoRoot, "artifacts", "quality", "domain_pack_scaffold");
const shipScript = path.join(repoRoot, "packs", "domain_pack_scaffold_v0", "tools", "ship_domain_pack_scaffold_v0.mjs");

function getArg(key) {
  const idx = process.argv.indexOf(key);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

const allowedHttpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

function resolveRequestPath(value) {
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  return path.join(repoRoot, value);
}

const positiveRequestOverride = getArg("--request") || process.env.AGENT_TEMPLATE_REQUEST || null;
const positiveRequestPath = positiveRequestOverride ? resolveRequestPath(positiveRequestOverride) : defaultPositiveRequest;

function runGenerator(requestPath) {
  const child = spawnSync(process.execPath, [generatorScript, "--request", requestPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return child;
}


function collectJsonPaths(rootDir) {
  const collected = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const resolved = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectJsonPaths(resolved));
      continue;
    }
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".json" || ext === ".jsonl") {
        collected.push(resolved);
      }
    }
  }
  return collected;
}

function validateJsonFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf8");
  try {
    if (ext === ".jsonl") {
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        JSON.parse(line);
      }
    } else {
      JSON.parse(content);
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function makeMd(report) {
  const lines = [
    `# Agent Template Quality Report (${report.mode})`,
    "",
    `- Run: ${report.run_id}`,
    `- Status: ${report.status.toUpperCase()}`,
    `- Bundle: ${report.bundle_dir || "(n/a)"}`,
    "",
    "## Checks"
  ];
  for (const check of report.checks || []) {
    lines.push(`- ${check.name}: ${check.status.toUpperCase()}`);
    if (check.details) {
      for (const detail of check.details) {
        lines.push(`  - ${detail}`);
      }
    }
  }
  if (report.mode === "negative" && Array.isArray(report.cases)) {
    lines.push("", "## Negative Suite");
    for (const entry of report.cases) {
      lines.push(`- ${entry.id}: ${entry.status.toUpperCase()}`);
      if (entry.errors && entry.errors.length) {
        for (const error of entry.errors) {
          lines.push(`  - ${error}`);
        }
      }
    }
  }
  return lines.join("\n") + "\n";
}

function writeReportDir(runId, suffix) {
  const dir = path.join(qualityRoot, runId);
  ensureDir(dir);
  return path.join(dir, suffix);
}

function runPositive() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const child = runGenerator(positiveRequestPath);
  if (child.status !== 0) {
    throw new Error("domain_pack_scaffold generator failed for positive request");
  }
  const result = (() => {
    try {
      return JSON.parse(child.stdout || "{}");
    } catch (err) {
      throw new Error("unable to parse generator output");
    }
  })();

  const bundleDir = path.join(repoRoot, result.bundle_dir || "");
  if (!bundleDir || !fs.existsSync(bundleDir)) {
    throw new Error("bundle directory missing after generation");
  }

  const checks = [];
  const jsonFiles = collectJsonPaths(bundleDir);
  const validationDetails = [];
  for (const filePath of jsonFiles) {
    const error = validateJsonFile(filePath);
    if (error) {
      validationDetails.push(`${rel(filePath)}: ${error}`);
    }
  }
  checks.push({
    name: "json_validation",
    status: validationDetails.length ? "fail" : "pass",
    details: validationDetails
  });

  const policyPath = path.join(bundleDir, "mova", "policy", "policy.v0.json");
  const policy = readJson(policyPath);
  const policyChecks = [];
  if (policy.default !== "deny") {
    policyChecks.push("policy.default != deny");
  }
  const allowActions = Array.isArray(policy.allow_actions) ? policy.allow_actions : [];
  if (allowActions.some((entry) => entry === "*")) {
    policyChecks.push("policy allowlist contains wildcard");
  }
  checks.push({
    name: "policy_allowlist",
    status: policyChecks.length ? "fail" : "pass",
    details: policyChecks
  });

  const rolesPath = path.join(bundleDir, "mova", "roles", "role_bundles_v0.json");
  const roleBundles = readJson(rolesPath);
  const roles = Array.isArray(roleBundles.roles) ? roleBundles.roles.map((r) => r.role_id) : [];
  const canonicalRoles = ["planner", "executor", "qa", "notary"];
  const missingRoles = canonicalRoles.filter((id) => !roles.includes(id));
  const extraRoles = roles.filter((id) => !canonicalRoles.includes(id));
  const roleDetails = [];
  if (roles.length !== 4 || missingRoles.length || extraRoles.length) {
    roleDetails.push(`found roles: ${roles.join(", ")}`);
  }
  checks.push({
    name: "role_bundle",
    status: roleDetails.length ? "fail" : "pass",
    details: roleDetails
  });

  const matrixPath = path.join(bundleDir, "mova", "roles", "role_matrix_v0.json");
  const matrix = readJson(matrixPath);
  const expectedTransitions = [
    { from_role: "planner", to_role: "executor" },
    { from_role: "executor", to_role: "qa" },
    { from_role: "qa", to_role: "notary" }
  ];
  const matrixList = Array.isArray(matrix.transitions) ? matrix.transitions : [];
  const missingTransitions = expectedTransitions.filter((expected) =>
    !matrixList.some((entry) => entry.from_role === expected.from_role && entry.to_role === expected.to_role)
  );
  const extraTransitions = matrixList.filter((entry) =>
    !expectedTransitions.some((expected) => entry.from_role === expected.from_role && entry.to_role === expected.to_role)
  );
  const matrixDetails = [];
  if (missingTransitions.length) {
    matrixDetails.push(`missing transitions: ${missingTransitions.map((t) => `${t.from_role}->${t.to_role}`).join(", ")}`);
  }
  if (extraTransitions.length) {
    matrixDetails.push(`unexpected transitions: ${extraTransitions.map((t) => `${t.from_role}->${t.to_role}`).join(", ")}`);
  }
  checks.push({
    name: "role_matrix",
    status: matrixDetails.length ? "fail" : "pass",
    details: matrixDetails
  });

  const commandDir = path.join(bundleDir, ".claude", "commands");
  const commandFiles = ["gates.md", "quality.md", "station.md", "ship.md"];
  const commandDetails = [];
  for (const filename of commandFiles) {
    const targetPath = path.join(commandDir, filename);
    if (!fs.existsSync(targetPath)) {
      commandDetails.push(`missing ${filename}`);
      continue;
    }
    const size = fs.statSync(targetPath).size;
    if (size === 0) {
      commandDetails.push(`${filename} is empty`);
    }
  }
  checks.push({
    name: "claude_commands",
    status: commandDetails.length ? "fail" : "pass",
    details: commandDetails
  });

  const shipChild = spawnSync(process.execPath, [shipScript, "--request", positiveRequestPath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (shipChild.status !== 0) {
    throw new Error(
      `[quality_domain_pack_scaffold] ship tool failed (exit ${shipChild.status ?? "unknown"}): ${shipChild.stderr?.trim() || shipChild.stdout?.trim() || "(no output)"}`
    );
  }
  let shipResult;
  try {
    shipResult = JSON.parse(shipChild.stdout || "{}");
  } catch (err) {
    throw new Error(`ship tool output invalid JSON: ${err.message}`);
  }
  const manifestPath = path.join(repoRoot, shipResult.manifest || "");
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error("ship manifest missing");
  }
  const manifest = readJson(manifestPath);
  const manifestErrors = [];
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  if (!manifestFiles.length) {
    manifestErrors.push("manifest.files empty");
  }
  for (const entry of manifestFiles) {
    if (typeof entry.rel_path !== "string" || !entry.rel_path) {
      manifestErrors.push("file entry missing rel_path");
    }
    if (typeof entry.bytes !== "number") {
      manifestErrors.push(`file ${entry.rel_path || "(unknown)"} missing bytes`);
    }
    if (typeof entry.sha256 !== "string" || !entry.sha256) {
      manifestErrors.push(`file ${entry.rel_path || "(unknown)"} missing sha256`);
    }
  }
  checks.push({
    name: "ship_manifest",
    status: manifestErrors.length ? "fail" : "pass",
    details: manifestErrors
  });

  const actionChecks = runActionsChecks();
  checks.push(...actionChecks);

  const reportStatus = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  const report = {
    run_id: runId,
    mode: "positive",
    status: reportStatus,
    bundle_dir: rel(bundleDir),
    generator_stdout: child.stdout?.trim() || "",
    generator_stderr: child.stderr?.trim() || "",
    ship_stdout: shipChild.stdout?.trim() || "",
    ship_stderr: shipChild.stderr?.trim() || "",
    ship_manifest: rel(manifestPath),
    checks,
    created_at: new Date().toISOString()
  };
  const reportPath = writeReportDir(runId, "quality_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(writeReportDir(runId, "quality_report.md"), makeMd(report), "utf8");
  return report;
}

function runActionsChecks() {
  const child = runGenerator(actionsRequest);
  if (child.status !== 0) {
    throw new Error("domain_pack_scaffold generator failed for actions request");
  }
  const result = (() => {
    try {
      return JSON.parse(child.stdout || "{}");
    } catch (err) {
      throw new Error("unable to parse actions generator output");
    }
  })();

  const bundleDir = path.join(repoRoot, result.bundle_dir || "");
  if (!bundleDir || !fs.existsSync(bundleDir)) {
    throw new Error("actions bundle directory missing after generation");
  }

  const policyPath = path.join(bundleDir, "mova", "policy", "policy.v0.json");
  const registryPath = path.join(bundleDir, "mova", "registry", "registry.jsonl");
  const actionsPolicy = readJson(policyPath);
  if (!fs.existsSync(registryPath)) {
    throw new Error("actions registry missing");
  }
  const registryLines = fs
    .readFileSync(registryPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const actionEntries = registryLines.filter((entry) => entry.type === "action");
  const actionIds = actionEntries.map((entry) => entry.entry_id);

  const checks = [];
  const allowList = Array.isArray(actionsPolicy.allow_actions) ? actionsPolicy.allow_actions : [];
  const allowSet = new Set(allowList);
  const registrySet = new Set(actionIds);
  const allowDetails = [];
  const missingFromPolicy = actionIds.filter((id) => !allowSet.has(id));
  if (missingFromPolicy.length) {
    allowDetails.push(`policy missing action_ids: ${missingFromPolicy.join(", ")}`);
  }
  const extraInPolicy = allowList.filter((id) => !registrySet.has(id));
  if (extraInPolicy.length) {
    allowDetails.push(`policy allows unknown action_ids: ${extraInPolicy.join(", ")}`);
  }
  checks.push({
    name: "actions_allowlist_registry",
    status: allowDetails.length ? "fail" : "pass",
    details: allowDetails
  });

  const policyDestinations = Array.isArray(actionsPolicy.destinations) ? actionsPolicy.destinations : [];
  const wildcardDetails = policyDestinations.filter((dest) => typeof dest === "string" && dest.includes("*"));
  checks.push({
    name: "actions_policy_destinations",
    status: wildcardDetails.length ? "fail" : "pass",
    details: wildcardDetails.map((dest) => `wildcard destination: ${dest}`)
  });

  const driverDetails = [];
  for (const entry of actionEntries) {
    const config = entry.driver_config && typeof entry.driver_config === "object" ? entry.driver_config : {};
    if (entry.driver_kind === "restricted_shell") {
      if (!config.command) {
        driverDetails.push(`${entry.entry_id}: missing restricted shell command`);
      }
    } else if (entry.driver_kind === "http") {
      if (!config.base_url) {
        driverDetails.push(`${entry.entry_id}: missing http base_url`);
      }
      if (!config.path) {
        driverDetails.push(`${entry.entry_id}: missing http path`);
      }
      if (!config.method) {
        driverDetails.push(`${entry.entry_id}: missing http method`);
      } else if (!allowedHttpMethods.includes(String(config.method).toUpperCase())) {
        driverDetails.push(`${entry.entry_id}: invalid http method ${config.method}`);
      }
    } else if (entry.driver_kind === "mcp_proxy") {
      if (!config.server_id) {
        driverDetails.push(`${entry.entry_id}: missing mcp_proxy server_id`);
      }
      if (!config.tool_name) {
        driverDetails.push(`${entry.entry_id}: missing mcp_proxy tool_name`);
      }
    } else {
      driverDetails.push(`${entry.entry_id}: unsupported driver_kind ${entry.driver_kind}`);
    }
  }
  checks.push({
    name: "actions_driver_config",
    status: driverDetails.length ? "fail" : "pass",
    details: driverDetails
  });

  return checks;
}

function runNegative() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const suite = readJson(negativeSuitePath);
  const cases = [];
  for (const entry of suite.cases || []) {
    const requestPath = path.join(repoRoot, entry.request);
    const child = runGenerator(requestPath);
    const expect = entry.expect || {};
    const caseResult = {
      id: entry.id,
      request: rel(requestPath),
      exit_code: child.status ?? 1,
      expected: expect,
      actual: {},
      status: "fail",
      errors: []
    };
    if (child.status === 0) {
      caseResult.errors.push("generator unexpectedly succeeded");
      caseResult.actual = {
        code: "SUCCESS",
        message: "generator succeeded in a negative case",
        stdout: (child.stdout || "").trim(),
        stderr: (child.stderr || "").trim()
      };
    } else {
      const firstLine = (child.stderr || "").split(/\r?\n/)[0] || "";
      const match = firstLine.match(/\[(?:[^\]]+)\]\s+(\S+)\s+(.+)/);
      const code = match ? match[1] : "(unknown)";
      const message = match ? match[2] : firstLine;
      caseResult.actual = {
        code,
        message,
        stderr: (child.stderr || "").trim(),
        stdout: (child.stdout || "").trim()
      };
      if (expect.code && code !== expect.code) {
        caseResult.errors.push(`code mismatch (got ${code})`);
      }
      if (expect.message_contains && !message.includes(expect.message_contains)) {
        caseResult.errors.push(`message mismatch`);
      }
    }
    caseResult.status = caseResult.errors.length ? "fail" : "pass";
    cases.push(caseResult);
  }
  const overall = cases.every((entry) => entry.status === "pass") ? "pass" : "fail";
  const report = {
    run_id: runId,
    mode: "negative",
    status: overall,
    cases,
    created_at: new Date().toISOString()
  };
  const reportDirJson = writeReportDir(runId, "quality_report_negative.json");
  fs.writeFileSync(reportDirJson, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(writeReportDir(runId, "quality_report_negative.md"), makeMd(report), "utf8");
  return report;
}

function main() {
  const mode = getArg("--mode") === "negative" ? "negative" : "positive";
  ensureDir(qualityRoot);
  const report = mode === "negative" ? runNegative() : runPositive();
  const prefix = `[quality_domain_pack_scaffold:${mode}]`;
  if (report.status === "pass") {
    console.log(`${prefix} PASS (reports: ${rel(path.dirname(writeReportDir(report.run_id, mode === "positive" ? "quality_report.json" : "quality_report_negative.json")))})`);
    process.exit(0);
  }
  console.error(`${prefix} FAIL`);
  process.exit(1);
}

main();
