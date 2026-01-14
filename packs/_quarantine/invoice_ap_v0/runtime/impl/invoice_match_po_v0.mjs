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
  "ds.invoice_match_po_request_v0.schema.json"
);

function printHelp() {
  console.log("Usage: node invoice_match_po_v0.mjs --in <input.json> --out <outDir>");
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

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function normalizeSku(sku) {
  if (!sku) return null;
  return sku.trim().toLowerCase();
}

function normalizeDescription(desc) {
  if (!desc) return null;
  return desc.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLine(line) {
  return {
    sku: line.sku?.trim() || undefined,
    description: line.description?.trim() || undefined,
    quantity: toNumber(line.quantity),
    unit_price: roundCurrency(toNumber(line.unit_price)),
    notes: line.notes?.trim() || undefined,
  };
}

function sanitizeVendor(vendor = {}) {
  const result = {};
  if (vendor.name) result.name = vendor.name;
  if (vendor.vat_id) result.vat_id = vendor.vat_id;
  if (vendor.address) result.address = vendor.address;
  return result;
}

function buildNormalizedSection(section) {
  return {
    ...(section.invoice_number ? { invoice_number: section.invoice_number } : {}),
    ...(section.po_number ? { po_number: section.po_number } : {}),
    currency: section.currency,
    issue_date: section.issue_date,
    vendor: section.vendor ? sanitizeVendor(section.vendor) : undefined,
    line_items: section.line_items.map(normalizeLine),
  };
}

function createMatchSlot(line, index) {
  return {
    index,
    line,
    keySku: normalizeSku(line.sku),
    keyDesc: normalizeDescription(line.description),
    used: false,
  };
}

function findMatchSlot(slots, invoiceLine) {
  const skuKey = normalizeSku(invoiceLine.sku);
  if (skuKey) {
    const bySku = slots.find((slot) => !slot.used && slot.keySku && slot.keySku === skuKey);
    if (bySku) {
      bySku.used = true;
      return { slot: bySku, kind: "sku" };
    }
  }
  const descKey = normalizeDescription(invoiceLine.description);
  if (descKey) {
    const byDesc = slots.find((slot) => !slot.used && slot.keyDesc && slot.keyDesc === descKey);
    if (byDesc) {
      byDesc.used = true;
      return { slot: byDesc, kind: "description" };
    }
  }
  return { slot: null, kind: "unmatched" };
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

  const rawRequest = loadJson(inPath);
  const requestSchema = loadJson(requestSchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateRequest = ajv.compile(requestSchema);
  if (!validateRequest(rawRequest)) {
    throw new Error(`invoice_match_po request invalid: ${ajv.errorsText(validateRequest.errors, { separator: " | " })}`);
  }

  const normalizedInvoice = {
    invoice_number: rawRequest.invoice.invoice_number,
    currency: rawRequest.invoice.currency,
    issue_date: rawRequest.invoice.issue_date,
    vendor: rawRequest.invoice.vendor ? sanitizeVendor(rawRequest.invoice.vendor) : undefined,
    line_items: rawRequest.invoice.line_items.map(normalizeLine),
  };
  const normalizedPO = {
    po_number: rawRequest.purchase_order.po_number,
    currency: rawRequest.purchase_order.currency,
    issue_date: rawRequest.purchase_order.issue_date,
    vendor: rawRequest.purchase_order.vendor ? sanitizeVendor(rawRequest.purchase_order.vendor) : undefined,
    line_items: rawRequest.purchase_order.line_items.map(normalizeLine),
  };

  const requestEnvelope = {
    invoice: normalizedInvoice,
    purchase_order: normalizedPO,
  };
  if (rawRequest.tolerances) requestEnvelope.tolerances = { ...rawRequest.tolerances };
  if (rawRequest.metadata) requestEnvelope.metadata = { ...rawRequest.metadata };

  const poSlots = normalizedPO.line_items.map((line, index) => createMatchSlot(line, index));
  const matches = [];
  const summary = {
    total_invoice_lines: normalizedInvoice.line_items.length,
    matched_lines: 0,
    partial_lines: 0,
    unmatched_lines: 0,
    total_quantity_variance: 0,
    total_amount_variance: 0,
  };

  for (let i = 0; i < normalizedInvoice.line_items.length; i += 1) {
    const invoiceLine = normalizedInvoice.line_items[i];
    const { slot, kind } = findMatchSlot(poSlots, invoiceLine);

    const invoiceQuantity = roundCurrency(invoiceLine.quantity);
    const invoiceUnitPrice = invoiceLine.unit_price;
    const invoiceLineTotal = roundCurrency(invoiceQuantity * invoiceUnitPrice);

    const poQuantity = slot ? roundCurrency(slot.line.quantity) : null;
    const poUnitPrice = slot ? slot.line.unit_price : null;
    const poLineTotal = slot ? roundCurrency(slot.line.quantity * slot.line.unit_price) : null;

    const quantityVariance = slot ? roundCurrency(invoiceQuantity - poQuantity) : invoiceQuantity;
    const unitPriceVariance = slot ? roundCurrency(invoiceUnitPrice - poUnitPrice) : invoiceUnitPrice;
    const lineTotalVariance = slot ? roundCurrency(invoiceLineTotal - poLineTotal) : invoiceLineTotal;

    let status = "unmatched";
    if (slot) {
      if (quantityVariance === 0 && unitPriceVariance === 0 && lineTotalVariance === 0) status = "matched";
      else status = "partial";
    }

    if (status === "matched") summary.matched_lines += 1;
    else if (status === "partial") summary.partial_lines += 1;
    else summary.unmatched_lines += 1;

    summary.total_quantity_variance = roundCurrency(summary.total_quantity_variance + quantityVariance);
    summary.total_amount_variance = roundCurrency(summary.total_amount_variance + lineTotalVariance);

    matches.push({
      invoice_index: i,
      invoice_sku: invoiceLine.sku,
      description: invoiceLine.description,
      po_index: slot ? slot.index : null,
      match_kind: kind,
      status,
      invoice_quantity: invoiceQuantity,
      invoice_unit_price: invoiceUnitPrice,
      invoice_line_total: invoiceLineTotal,
      po_quantity: poQuantity,
      po_unit_price: poUnitPrice,
      po_line_total: poLineTotal,
      quantity_variance: quantityVariance,
      unit_price_variance: unitPriceVariance,
      line_total_variance: lineTotalVariance,
    });
  }

  const resultEnvelope = {
    invoice_number: normalizedInvoice.invoice_number,
    purchase_order_number: normalizedPO.po_number,
    currency: normalizedInvoice.currency,
    matches,
    match_summary: summary,
  };
  if (requestEnvelope.metadata) resultEnvelope.metadata = requestEnvelope.metadata;

  const evidenceDir = path.join(outPath, "evidence");
  ensureDir(evidenceDir);
  const totalsPath = path.join(evidenceDir, "totals.json");
  const evidencePayload = {
    invoice_number: normalizedInvoice.invoice_number,
    purchase_order_number: normalizedPO.po_number,
    currency: normalizedInvoice.currency,
    match_summary: summary,
  };
  fs.writeFileSync(totalsPath, JSON.stringify(evidencePayload, null, 2));

  const logPath = path.join(evidenceDir, "run.log");
  const logLines = [
    "invoice_match_po_v0",
    `invoice_lines=${normalizedInvoice.line_items.length}`,
    `po_lines=${normalizedPO.line_items.length}`,
    `matched=${summary.matched_lines}`,
    `partial=${summary.partial_lines}`,
    `unmatched=${summary.unmatched_lines}`,
    `total_amount_variance=${summary.total_amount_variance}`,
  ];
  fs.writeFileSync(logPath, logLines.join("\n"));

  const requestOut = path.join(outPath, "request.json");
  const resultOut = path.join(outPath, "result.json");
  fs.writeFileSync(requestOut, JSON.stringify(requestEnvelope, null, 2));
  fs.writeFileSync(resultOut, JSON.stringify(resultEnvelope, null, 2));

  console.log(
    `[invoice_match_po_v0] matched ${summary.matched_lines}/${summary.total_invoice_lines} invoice lines (amount variance ${summary.total_amount_variance})`
  );
}

try {
  await main();
} catch (err) {
  console.error("[invoice_match_po_v0] FAIL:", err.message);
  process.exit(1);
}
