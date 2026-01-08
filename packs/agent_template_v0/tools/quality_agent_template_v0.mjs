#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const generatorScript = path.join(repoRoot, "packs", "agent_template_v0", "tools", "agent_template_generate_v0.mjs");
const positiveRequest = path.join(repoRoot, "packs", "agent_template_v0", "docs", "examples", "pos", "agent_template_request_min.json");
const negativeSuitePath = path.join(repoRoot, "packs", "agent_template_v0", "docs", "agent_template_negative_suite_v0.json");
const qualityRoot = path.join(repoRoot, "artifacts", "quality", "agent_template");

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
  const child = runGenerator(positiveRequest);
  if (child.status !== 0) {
    throw new Error("agent_template generator failed for positive request");
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

  const reportStatus = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  const report = {
    run_id: runId,
    mode: "positive",
    status: reportStatus,
    bundle_dir: rel(bundleDir),
    generator_stdout: child.stdout?.trim() || "",
    generator_stderr: child.stderr?.trim() || "",
    checks,
    created_at: new Date().toISOString()
  };
  const reportPath = writeReportDir(runId, "quality_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(writeReportDir(runId, "quality_report.md"), makeMd(report), "utf8");
  return report;
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
  const prefix = `[quality_agent_template:${mode}]`;
  if (report.status === "pass") {
    console.log(`${prefix} PASS (reports: ${rel(path.dirname(writeReportDir(report.run_id, mode === "positive" ? "quality_report.json" : "quality_report_negative.json")))})`);
    process.exit(0);
  }
  console.error(`${prefix} FAIL`);
  process.exit(1);
}

main();
