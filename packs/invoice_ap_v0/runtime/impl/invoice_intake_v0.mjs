#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  "ds.invoice_intake_request_v0.schema.json"
);

function printHelp() {
  console.log("Usage: node invoice_intake_v0.mjs --in <input.json> --out <outDir> [--dry-run]");
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    switch (current) {
      case "--in":
        args.inPath = argv[++i];
        break;
      case "--out":
        args.outPath = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function ensureArg(value, label) {
  if (!value) {
    throw new Error(`Missing required argument: ${label}`);
  }
  return value;
}

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeLineItem(line) {
  const quantity = Number(line.quantity ?? 0);
  const unitPrice = Number(line.unit_price ?? 0);
  const vatRate = Number(line.vat_rate ?? 0);
  return {
    description: line.description ?? "",
    quantity,
    unit_price: unitPrice,
    vat_rate: vatRate,
    ...(line.account_code ? { account_code: line.account_code } : {}),
    ...(line.notes ? { notes: line.notes } : {}),
  };
}

function computeLineStats(line) {
  const lineTotal = roundCurrency(line.quantity * line.unit_price);
  const vatAmount = roundCurrency((lineTotal * line.vat_rate) / 100);
  return {
    ...line,
    line_total: lineTotal,
    vat_amount: vatAmount,
  };
}

function buildIdempotencyKey(payload) {
  const seed = `${payload.invoice_number ?? ""}|${payload.invoice_date ?? ""}|${payload.vendor?.vat_id ?? ""}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

function sanitizeVendor(vendor = {}) {
  const sanitized = {
    name: vendor.name ?? "",
  };
  if (vendor.vat_id) {
    sanitized.vat_id = vendor.vat_id;
  }
  if (vendor.address) {
    sanitized.address = vendor.address;
  }
  return sanitized;
}

function toRepoRelative(targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  if (!relative || relative === "") {
    return ".";
  }
  return relative.split(path.sep).join("/");
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

  const rawInput = loadJSON(inPath);
  const requestSchema = loadJSON(requestSchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateRequest = ajv.compile(requestSchema);
  if (!validateRequest(rawInput)) {
    throw new Error(
      `invoice intake validation failed: ${ajv.errorsText(validateRequest.errors, { separator: " | " })}`
    );
  }

  const normalizedLineItems = rawInput.line_items.map(normalizeLineItem);
  const computedLineItems = normalizedLineItems.map(computeLineStats);
  const subtotal = roundCurrency(computedLineItems.reduce((acc, line) => acc + line.line_total, 0));
  const vatTotal = roundCurrency(computedLineItems.reduce((acc, line) => acc + line.vat_amount, 0));
  const grandTotal = roundCurrency(subtotal + vatTotal);
  const totals = {
    subtotal,
    vat_total: vatTotal,
    grand_total: grandTotal,
  };

  const attachments = Array.isArray(rawInput.attachments)
    ? rawInput.attachments.filter((item) => typeof item === "string" && item.length > 0)
    : [];

  const idempotencyKey = rawInput.idempotency_key ?? buildIdempotencyKey(rawInput);
  const normalizedRequest = {
    vendor: sanitizeVendor(rawInput.vendor),
    invoice_number: rawInput.invoice_number,
    invoice_date: rawInput.invoice_date,
    currency: rawInput.currency,
    line_items: normalizedLineItems,
    idempotency_key: idempotencyKey,
    computed_totals: totals,
  };
  if (rawInput.due_date) {
    normalizedRequest.due_date = rawInput.due_date;
  }
  if (rawInput.timezone) {
    normalizedRequest.timezone = rawInput.timezone;
  }
  if (attachments.length > 0) {
    normalizedRequest.attachments = attachments;
  }
  if (rawInput.meta) {
    normalizedRequest.meta = rawInput.meta;
  }
  if (rawInput.ext) {
    normalizedRequest.ext = rawInput.ext;
  }

  const evidenceDir = path.join(outPath, "evidence");
  ensureDir(evidenceDir);
  const evidencePath = path.join(evidenceDir, "totals.json");
  const evidencePayload = {
    generated_at: new Date().toISOString(),
    invoice_number: normalizedRequest.invoice_number,
    totals,
    line_items: computedLineItems,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidencePayload, null, 2), "utf8");
  const logPath = path.join(evidenceDir, "run.log");
  const logLines = [
    `invoice_intake_v0`,
    `in: ${inPath}`,
    `out: ${outPath}`,
    `lines: ${computedLineItems.length}`,
    `subtotal=${totals.subtotal}, vat_total=${totals.vat_total}, grand_total=${totals.grand_total}`,
    `dry_run=${Boolean(args.dryRun)}`,
    `timestamp=${evidencePayload.generated_at}`,
  ];
  fs.writeFileSync(logPath, logLines.join("\n"), "utf8");

  const artifactsRef = toRepoRelative(outPath);
  const evidenceRef = toRepoRelative(evidencePath);
  const resultEnvelope = {
    ok: true,
    invoice_number: normalizedRequest.invoice_number,
    currency: normalizedRequest.currency,
    totals,
    line_items: computedLineItems,
    artifacts_dir: artifactsRef,
    evidence_refs: [evidenceRef],
    ext: {},
  };
  if (normalizedRequest.timezone) {
    resultEnvelope.ext.timezone = normalizedRequest.timezone;
  }
  if (attachments.length > 0) {
    resultEnvelope.ext.attachments = attachments;
  }
  if (args.dryRun) {
    resultEnvelope.ext.dry_run = true;
  }

  const requestPath = path.join(outPath, "request.json");
  fs.writeFileSync(requestPath, JSON.stringify(normalizedRequest, null, 2), "utf8");
  const resultPath = path.join(outPath, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(resultEnvelope, null, 2), "utf8");

  console.log(
    `[invoice_intake_v0] wrote request/result (${computedLineItems.length} line_items, subtotal ${totals.subtotal})`
  );
}

try {
  await main();
} catch (err) {
  console.error("[invoice_intake_v0] FAIL:", err.message);
  process.exit(1);
}
