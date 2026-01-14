#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..", "..");
const requestSchemaPath = path.join(
  repoRoot,
  "packs",
  "invoice_ap_v0",
  "ds",
  "ds.invoice_payment_export_request_v0.schema.json"
);

function printHelp() {
  console.log("Usage: node invoice_payment_export_v0.mjs --in <input.json> --out <outDir>");
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function canonicalPayments(payments) {
  return JSON.stringify(
    payments.map((p) => ({
      vendor_id: p.vendor_id,
      invoice_id: p.invoice_id,
      creditor_name: p.creditor_name,
      iban: p.iban,
      bic: p.bic ?? null,
      amount: p.amount,
      currency: p.currency,
      execution_date: p.execution_date,
      remittance_text: p.remittance_text
    }))
  );
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
      `invoice_payment_export request invalid: ${ajv.errorsText(validate.errors, { separator: " | " })}`
    );
  }

  const paymentsRaw = [...request.invoices];
  paymentsRaw.sort((a, b) => {
    if (a.vendor_id === b.vendor_id) return a.invoice_id.localeCompare(b.invoice_id);
    return a.vendor_id.localeCompare(b.vendor_id);
  });

  const payments = paymentsRaw.map((invoice) => ({
    vendor_id: invoice.vendor_id,
    invoice_id: invoice.invoice_id,
    creditor_name: invoice.vendor_name,
    iban: invoice.bank.iban,
    bic: invoice.bank.bic ?? null,
    amount: roundCurrency(invoice.amount),
    currency: invoice.currency,
    execution_date: invoice.execution_date,
    remittance_text:
      invoice.remittance_text ||
      `Invoice ${invoice.invoice_id} payment ${roundCurrency(invoice.amount)} ${invoice.currency}`
  }));

  const totalsByCurrency = payments.reduce((acc, payment) => {
    acc[payment.currency] = roundCurrency((acc[payment.currency] || 0) + payment.amount);
    return acc;
  }, {});

  const canonical = canonicalPayments(payments);
  const exportHash = crypto.createHash("sha256").update(canonical).digest("hex");

  const requestOut = path.join(outPath, "request.json");
  fs.writeFileSync(requestOut, JSON.stringify(request, null, 2));

  const result = {
    export_batch_id: request.export_batch_id,
    export_format: "payments_json_v0",
    payments,
    export_hash: exportHash,
    totals_by_currency: totalsByCurrency,
    metadata: request.metadata
  };
  const resultOut = path.join(outPath, "result.json");
  fs.writeFileSync(resultOut, JSON.stringify(result, null, 2));

  const evidenceDir = path.join(outPath, "evidence");
  ensureDir(evidenceDir);
  const totalsEvidence = {
    export_batch_id: request.export_batch_id,
    total_payments: payments.length,
    totals_by_currency: totalsByCurrency
  };
  fs.writeFileSync(path.join(evidenceDir, "totals.json"), JSON.stringify(totalsEvidence, null, 2));

  const logPath = path.join(evidenceDir, "run.log");
  const logLines = [
    "invoice_payment_export_v0",
    `payments=${payments.length}`,
    `export_hash=${exportHash}`,
    `currencies=${Object.keys(totalsByCurrency).join(",")}`
  ];
  fs.writeFileSync(logPath, logLines.join("\n"));

  console.log(
    `[invoice_payment_export_v0] exported ${payments.length} payments (hash ${exportHash.slice(0, 12)}…)`
  );
}

try {
  await main();
} catch (err) {
  console.error("[invoice_payment_export_v0] FAIL:", err.message);
  process.exit(1);
}
