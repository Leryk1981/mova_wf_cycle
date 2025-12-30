#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = process.cwd();
const requestSchemaPath = path.join(repoRoot, "packs", "invoice_ap_v0", "ds", "ds.invoice_intake_request_v0.schema.json");

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--in") parsed.inPath = argv[++i];
    else if (arg === "--out") parsed.outPath = argv[++i];
    else if (arg === "--help" || arg === "-h") parsed.help = true;
  }
  return parsed;
}

function printHelp() {
  console.log("Usage: node invoice_intake_v0.mjs --in <request.json> --out <outDir>");
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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizeLineItem(item) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unit_price) || 0;
  const vatRate = Number(item.vat_rate) || 0;
  const lineTotal = round2(quantity * unitPrice);
  const vatAmount = round2(lineTotal * (vatRate / 100));
  return {
    description: item.description,
    quantity: quantity,
    unit_price: unitPrice,
    vat_rate: vatRate,
    line_total: lineTotal,
    vat_amount: vatAmount
  };
}

function computeTotals(lineSummaries) {
  const subtotal = round2(lineSummaries.reduce((sum, li) => sum + li.line_total, 0));
  const vatTotal = round2(lineSummaries.reduce((sum, li) => sum + li.vat_amount, 0));
  const grandTotal = round2(subtotal + vatTotal);
  return { subtotal, vat_total: vatTotal, grand_total: grandTotal };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const inPath = path.resolve(repoRoot, ensureArg(args.inPath, "--in"));
  const outDir = path.resolve(repoRoot, ensureArg(args.outPath, "--out"));
  ensureDir(outDir);
  ensureDir(path.join(outDir, "evidence"));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const requestSchema = loadJson(requestSchemaPath);
  const validateRequest = ajv.compile(requestSchema);

  const request = loadJson(inPath);
  const valid = validateRequest(request);
  if (!valid) {
    throw new Error(`invoice intake validation failed: ${ajv.errorsText(validateRequest.errors, { separator: " | " })}`);
  }

  const normalizedLineItems = request.line_items.map(normalizeLineItem);
  const totals = computeTotals(normalizedLineItems);

  const normalizedRequest = {
    ...request,
    computed_totals: totals
  };
  const normalizedRequestPath = path.join(outDir, "request.json");
  fs.writeFileSync(normalizedRequestPath, JSON.stringify(normalizedRequest, null, 2), "utf8");

  const evidencePayload = {
    generated_at: new Date().toISOString(),
    invoice_number: request.invoice_number,
    totals,
    line_items: normalizedLineItems
  };
  const evidencePath = path.join(outDir, "evidence", "totals.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidencePayload, null, 2), "utf8");

  const result = {
    ok: true,
    invoice_number: request.invoice_number,
    currency: request.currency,
    totals,
    line_items: normalizedLineItems,
    artifacts_dir: path.relative(repoRoot, outDir).replace(/\\/g, "/"),
    evidence_refs: [
      path.relative(repoRoot, evidencePath).replace(/\\/g, "/")
    ],
    ext: {
      timezone: request.timezone
    }
  };
  const resultPath = path.join(outDir, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
}

try {
  await main();
} catch (err) {
  console.error("[invoice_intake_v0] FAIL:", err.message);
  process.exit(1);
}
