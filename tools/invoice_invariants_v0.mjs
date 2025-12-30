#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const repoRoot = process.cwd();

function parseArgs(argv) {
  const parsed = {
    files: {},
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workflow") parsed.workflow = argv[++i];
    else if (arg === "--dir") parsed.dir = argv[++i];
    else if (arg === "--request") parsed.files.request = argv[++i];
    else if (arg === "--result") parsed.files.result = argv[++i];
    else if (arg === "--totals") parsed.files.totals = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--log") parsed.log = argv[++i];
    else if (arg === "--help" || arg === "-h") parsed.help = true;
  }
  return parsed;
}

function printHelp() {
  console.log("Usage: node tools/invoice_invariants_v0.mjs --workflow <name> [--dir <path>]");
  console.log("       Provide --dir (containing request/result/evidence/totals.json) or explicit file paths.");
}

function resolvePath(candidate, fallback) {
  const rel = candidate ?? fallback;
  if (!rel) return null;
  return path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relRepo(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sum(values) {
  return values.reduce((acc, v) => acc + v, 0);
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function checkNoRuntimeKeys(target, issues, prefix) {
  const banned = ["run_id", "attempt_dir", "artifacts_dir", "out_dir", "stdout_log", "stderr_log", "started_at", "finished_at", "timestamp"];
  for (const key of Object.keys(target || {})) {
    if (banned.includes(key) || /(_log|_dir|_path)$/i.test(key)) {
      issues.push({ code: "runtime_key", message: `${prefix}${key} should not contain runtime metadata` });
    }
  }
}

function matchPoChecks(request, result, totals, issues) {
  const invoiceLines = request?.invoice?.line_items ?? [];
  if (!Array.isArray(result?.matches) || result.matches.length === 0) {
    issues.push({ code: "missing_matches", message: "matches[] must be a non-empty array" });
    return;
  }
  const statusCounts = { matched: 0, partial: 0, unmatched: 0 };
  let amountVariance = 0;
  for (const [idx, match] of result.matches.entries()) {
    if (!isNumber(match.invoice_quantity) || !isNumber(match.invoice_unit_price)) {
      issues.push({ code: "invalid_invoice_line", message: `match[${idx}] invoice quantities/prices must be numbers` });
    } else {
      const computed = round(match.invoice_quantity * match.invoice_unit_price);
      if (!isNumber(match.invoice_line_total) || round(match.invoice_line_total) !== computed) {
        issues.push({
          code: "line_total_mismatch",
          message: `match[${idx}] invoice_line_total should equal quantity*unit_price (${computed})`,
        });
      }
    }
    if (!isNumber(match.po_quantity) || !isNumber(match.po_unit_price)) {
      issues.push({ code: "invalid_po_line", message: `match[${idx}] PO quantities/prices must be numbers` });
    } else if (!isNumber(match.po_line_total)) {
      issues.push({ code: "missing_po_total", message: `match[${idx}] missing po_line_total` });
    }
    if (!isNumber(match.line_total_variance)) {
      issues.push({ code: "variance_missing", message: `match[${idx}] line_total_variance missing or invalid` });
    } else {
      amountVariance += match.line_total_variance;
    }
    if (statusCounts[match.status] === undefined) {
      issues.push({ code: "invalid_status", message: `match[${idx}] has invalid status "${match.status}"` });
    } else {
      statusCounts[match.status] += 1;
    }
  }
  const summary = result.match_summary || {};
  if (summary.total_invoice_lines !== invoiceLines.length) {
    issues.push({
      code: "invoice_line_count",
      message: `match_summary.total_invoice_lines (${summary.total_invoice_lines}) must equal invoice line items (${invoiceLines.length})`,
    });
  }
  if (summary.total_amount_variance !== undefined && round(summary.total_amount_variance) !== round(amountVariance)) {
    issues.push({
      code: "amount_variance_mismatch",
      message: "match_summary.total_amount_variance should equal sum of line_total_variance",
    });
  }
  if (summary.matched_lines !== undefined && summary.matched_lines !== statusCounts.matched) {
    issues.push({ code: "matched_count", message: "match_summary.matched_lines mismatch" });
  }
  if (summary.partial_lines !== undefined && summary.partial_lines !== statusCounts.partial) {
    issues.push({ code: "partial_count", message: "match_summary.partial_lines mismatch" });
  }
  if (summary.unmatched_lines !== undefined && summary.unmatched_lines !== statusCounts.unmatched) {
    issues.push({ code: "unmatched_count", message: "match_summary.unmatched_lines mismatch" });
  }
  if (totals?.match_summary && JSON.stringify(totals.match_summary) !== JSON.stringify(result.match_summary)) {
    issues.push({ code: "totals_summary_mismatch", message: "totals.match_summary must mirror result.match_summary" });
  }
}

function approveChecks(result, totals, issues) {
  const allowed = ["approved", "needs_review", "rejected"];
  if (!allowed.includes(result?.decision)) {
    issues.push({ code: "invalid_decision", message: `decision must be one of ${allowed.join(", ")}` });
  }
  if (!Array.isArray(result?.reasons)) {
    issues.push({ code: "reasons_type", message: "reasons must be an array" });
  }
  if (result.decision === "approved") {
    if (!result.scheduled_payment_date) {
      issues.push({ code: "missing_payment_date", message: "scheduled_payment_date required when approved" });
    }
    if (!isNumber(result.pay_amount) || result.pay_amount <= 0) {
      issues.push({ code: "invalid_pay_amount", message: "pay_amount must be > 0 when approved" });
    }
    if ((result.match_summary?.status || "unknown") !== "matched") {
      issues.push({ code: "match_status", message: "approved decision requires match_summary.status == matched" });
    }
  }
  if (totals?.pay_amount !== undefined && totals.pay_amount !== result.pay_amount) {
    issues.push({ code: "totals_pay_amount", message: "totals.pay_amount must equal result.pay_amount" });
  }
  if (isNumber(totals?.reasons_count) && Array.isArray(result.reasons) && totals.reasons_count !== result.reasons.length) {
    issues.push({ code: "totals_reasons", message: "totals.reasons_count must equal reasons.length" });
  }
}

function exportChecks(result, totals, issues) {
  if (result.export_format !== "payments_json_v0") {
    issues.push({ code: "export_format", message: "export_format must be payments_json_v0" });
  }
  if (!Array.isArray(result.payments) || result.payments.length === 0) {
    issues.push({ code: "payments_array", message: "payments[] must be a non-empty array" });
    return;
  }
  const sorted = [...result.payments].sort((a, b) => {
    const keyA = `${a.vendor_id || ""}::${a.invoice_id || ""}`;
    const keyB = `${b.vendor_id || ""}::${b.invoice_id || ""}`;
    return keyA.localeCompare(keyB);
  });
  if (JSON.stringify(sorted) !== JSON.stringify(result.payments)) {
    issues.push({ code: "payments_order", message: "payments[] must be sorted deterministically (vendor_id, invoice_id)" });
  }
  const sumByCurrency = new Map();
  for (const [idx, payment] of result.payments.entries()) {
    if (!payment.vendor_id || !payment.invoice_id) {
      issues.push({ code: "payment_identity", message: `payments[${idx}] missing vendor_id or invoice_id` });
    }
    if (!isNumber(payment.amount) || payment.amount <= 0) {
      issues.push({ code: "payment_amount", message: `payments[${idx}] amount must be > 0` });
    }
    if (!payment.currency) {
      issues.push({ code: "payment_currency", message: `payments[${idx}] currency missing` });
    }
    const key = payment.currency || "__";
    sumByCurrency.set(key, (sumByCurrency.get(key) ?? 0) + (payment.amount || 0));
  }
  const recomputed = Object.fromEntries([...sumByCurrency.entries()].map(([cur, value]) => [cur, round(value, 4)]));
  const totalsCurrencies = totals?.totals_by_currency || {};
  const canonicalTotals = Object.fromEntries(Object.entries(totalsCurrencies).map(([cur, value]) => [cur, round(value, 4)]));
  if (JSON.stringify(recomputed) !== JSON.stringify(canonicalTotals)) {
    issues.push({ code: "totals_currency", message: "totals.totals_by_currency must equal sum of payments" });
  }
  if (typeof result.export_hash === "string") {
    const hash = crypto.createHash("sha256").update(JSON.stringify(result.payments)).digest("hex");
    if (hash !== result.export_hash) {
      issues.push({ code: "export_hash", message: "export_hash must equal sha256(JSON.stringify(payments))" });
    }
  } else {
    issues.push({ code: "export_hash_missing", message: "export_hash missing" });
  }
}

function runChecks(workflow, request, result, totals) {
  const issues = [];
  if (!workflow) {
    issues.push({ code: "workflow_missing", message: "--workflow is required" });
    return issues;
  }
  checkNoRuntimeKeys(result, issues, "result.");
  checkNoRuntimeKeys(totals, issues, "totals.");
  if (workflow === "invoice:match_po") {
    matchPoChecks(request, result, totals, issues);
  } else if (workflow === "invoice:approve") {
    approveChecks(result, totals, issues);
  } else if (workflow === "invoice:export") {
    exportChecks(result, totals, issues);
  } else if (workflow === "invoice") {
    // Intake invariants (basic)
    if (!result?.invoice_number || !result?.currency) {
      issues.push({ code: "intake_summary", message: "invoice result must echo invoice_number + currency" });
    }
  } else {
    issues.push({ code: "workflow_unknown", message: `No invariants implemented for workflow "${workflow}"` });
  }
  return issues;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.workflow) {
    console.error("--workflow is required");
    process.exit(1);
  }

  const dirAbs = args.dir ? resolvePath(args.dir) : null;
  const requestPath = resolvePath(args.files.request, dirAbs ? path.join(dirAbs, "request.json") : null);
  const resultPath = resolvePath(args.files.result, dirAbs ? path.join(dirAbs, "result.json") : null);
  const totalsPath = resolvePath(args.files.totals, dirAbs ? path.join(dirAbs, "evidence", "totals.json") : null);
  const missing = [];
  if (!requestPath || !fs.existsSync(requestPath)) missing.push("request.json");
  if (!resultPath || !fs.existsSync(resultPath)) missing.push("result.json");
  if (!totalsPath || !fs.existsSync(totalsPath)) missing.push("totals.json");
  if (missing.length) {
    console.error(`[invoice_invariants] Missing required files: ${missing.join(", ")}`);
    process.exit(1);
  }

  const startedAt = new Date();
  let issues = [];
  let request;
  let result;
  let totals;
  try {
    request = loadJson(requestPath);
    result = loadJson(resultPath);
    totals = loadJson(totalsPath);
    issues = runChecks(args.workflow, request, result, totals);
  } catch (err) {
    issues.push({ code: "parse_error", message: err.message });
  }
  const finishedAt = new Date();

  const status = issues.length ? "fail" : "pass";
  const report = {
    workflow: args.workflow,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    request_path: relRepo(requestPath),
    result_path: relRepo(resultPath),
    totals_path: relRepo(totalsPath),
    status,
    issues,
  };

  if (args.out) {
    const outPath = resolvePath(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  }
  if (args.log) {
    const logPath = resolvePath(args.log);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const lines = [];
    lines.push(`[invoice_invariants] workflow=${args.workflow} status=${status}`);
    if (issues.length) {
      for (const issue of issues) lines.push(`- [${issue.code}] ${issue.message}`);
    } else {
      lines.push("- PASS – no issues detected");
    }
    fs.writeFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
  }

  if (status === "pass") {
    console.log(`[invoice_invariants] PASS ${args.workflow}`);
    process.exit(0);
  } else {
    console.error(`[invoice_invariants] FAIL ${args.workflow}`);
    for (const issue of issues) console.error(`- [${issue.code}] ${issue.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[invoice_invariants] ERROR", err.message);
  process.exit(1);
});
