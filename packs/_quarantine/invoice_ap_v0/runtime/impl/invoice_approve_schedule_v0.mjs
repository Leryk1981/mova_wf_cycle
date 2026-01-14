#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..", "..");
const requestSchemaPath = path.join(
  repoRoot,
  "packs",
  "invoice_ap_v0",
  "ds",
  "ds.invoice_approve_schedule_request_v0.schema.json"
);

function printHelp() {
  console.log("Usage: node invoice_approve_schedule_v0.mjs --in <input.json> --out <outDir>");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === "--in") args.inPath = argv[++i];
    else if (cur === "--out") args.outPath = argv[++i];
    else if (cur === "--help" || cur === "-h") args.help = true;
  }
  return args;
}

function ensureArg(value, label) {
  if (!value) throw new Error(`Missing required argument: ${label}`);
  return value;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizePolicy(policy = {}) {
  const varianceThreshold = typeof policy.variance_threshold === "number" ? policy.variance_threshold : 0;
  const requiredStatus = (policy.required_status || "matched").toLowerCase();
  return { varianceThreshold, requiredStatus };
}

function toPayAmount(invoice) {
  const raw = invoice?.totals?.grand_total ?? 0;
  return roundCurrency(Number(raw) || 0);
}

function parseDateUtc(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [_, y, m, d] = match;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function addDaysFormat(dateStr, days) {
  const base = parseDateUtc(dateStr) ?? new Date(Date.UTC(1970, 0, 1));
  const future = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const year = future.getUTCFullYear();
  const month = String(future.getUTCMonth() + 1).padStart(2, "0");
  const day = String(future.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const inPath = path.resolve(ensureArg(args.inPath, "--in"));
  const outPath = path.resolve(ensureArg(args.outPath, "--out"));
  ensureDir(outPath);

  const request = loadJson(inPath);
  const requestSchema = loadJson(requestSchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(requestSchema);
  if (!validate(request)) {
    throw new Error(
      `invoice_approve_schedule request invalid: ${ajv.errorsText(validate.errors, { separator: " | " })}`
    );
  }

  const policy = normalizePolicy(request.policy);
  const matchStatus = (request.match_summary.status || "").toLowerCase();
  const varianceTotal = roundCurrency(request.match_summary.total_amount_variance || 0);
  const payAmount = toPayAmount(request.invoice);
  const paymentDays =
    typeof request.payment_terms_days === "number" && request.payment_terms_days >= 0
      ? request.payment_terms_days
      : 14;

  const reasons = [];
  if (matchStatus !== policy.requiredStatus) {
    reasons.push(`match_status=${matchStatus || "unknown"} (expected ${policy.requiredStatus})`);
  }
  if (Math.abs(varianceTotal) > policy.varianceThreshold) {
    reasons.push(`variance ${varianceTotal} exceeds threshold ${policy.varianceThreshold}`);
  }

  const decision = reasons.length === 0 ? "approved" : "needs_review";
  const scheduledPaymentDate = addDaysFormat(request.invoice.invoice_date, paymentDays);
  const checklist = [
    "verify invoice metadata",
    `policy variance threshold ${policy.varianceThreshold}`,
    `match status ${matchStatus || "n/a"}`
  ];
  if (decision === "approved") checklist.push("notify treasury for payment scheduling");
  else checklist.push("escalate to AP reviewer");

  const requestOut = path.join(outPath, "request.json");
  const resultOut = path.join(outPath, "result.json");
  writeJson(requestOut, request);

  const result = {
    invoice_number: request.invoice.invoice_number,
    currency: request.invoice.currency,
    decision,
    reasons,
    scheduled_payment_date: scheduledPaymentDate,
    pay_amount: payAmount,
    match_summary: {
      status: matchStatus,
      total_amount_variance: varianceTotal
    },
    checklist,
    metadata: request.metadata
  };
  writeJson(resultOut, result);

  const evidenceDir = path.join(outPath, "evidence");
  ensureDir(evidenceDir);
  const totalsPath = path.join(evidenceDir, "totals.json");
  writeJson(totalsPath, {
    invoice_number: result.invoice_number,
    decision,
    pay_amount: result.pay_amount,
    reasons_count: reasons.length
  });

  const logPath = path.join(evidenceDir, "run.log");
  const logLines = [
    "invoice_approve_schedule_v0",
    `decision=${decision}`,
    `pay_amount=${payAmount}`,
    `scheduled_payment_date=${scheduledPaymentDate}`,
    `variance=${varianceTotal}`,
    `policy_threshold=${policy.varianceThreshold}`
  ];
  fs.writeFileSync(logPath, logLines.join("\n"));

  console.log(
    `[invoice_approve_schedule_v0] decision=${decision} pay_amount=${payAmount} scheduled=${scheduledPaymentDate}`
  );
}

try {
  await main();
} catch (err) {
  console.error("[invoice_approve_schedule_v0] FAIL:", err.message);
  process.exit(1);
}
