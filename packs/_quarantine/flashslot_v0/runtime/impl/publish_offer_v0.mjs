#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import noopDriver from "../drivers/noop_driver_v0.mjs";
import telegramShellDriver from "../drivers/telegram_shell_driver_v0.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..", "..");
const schemaPath = path.join(repoRoot, "packs", "flashslot_v0", "ds", "ds.flashslot_offer_v1.json");

const drivers = {
  noop: noopDriver,
  telegram_shell: telegramShellDriver,
};

function printHelp() {
  console.log(`Usage: node publish_offer_v0.mjs --in <input.json> --out <outDir> [--driver noop|telegram_shell] [--dry-run]`);
}

function parseArgs(argv) {
  const result = { driver: "noop", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--in":
        result.inPath = argv[++i];
        break;
      case "--out":
        result.outPath = argv[++i];
        break;
      case "--driver":
        result.driver = argv[++i];
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      default:
        break;
    }
  }
  return result;
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

function buildIdempotencyKey(offer) {
  const seed = `${offer.offer_id ?? ""}|${offer.starts_at ?? ""}|${offer.location_id ?? ""}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const inPath = path.resolve(ensureArg(args.inPath, "--in"));
  const outPath = path.resolve(ensureArg(args.outPath, "--out"));
  const driverName = args.driver ?? "noop";
  const dryRun = Boolean(args.dryRun);
  const driverFn = drivers[driverName];
  if (!driverFn) {
    throw new Error(`Unknown driver: ${driverName}`);
  }
  ensureDir(outPath);
  const inputData = loadJSON(inPath);
  const offer = inputData.offer ?? inputData;
  if (!offer || typeof offer !== "object") {
    throw new Error("Input JSON must contain an offer object");
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = loadJSON(schemaPath);
  const validateOffer = ajv.compile(schema);
  if (!validateOffer(offer)) {
    throw new Error(`offer validation failed: ${ajv.errorsText(validateOffer.errors, { separator: " | " })}`);
  }
  const idempotencyKey = inputData?.idempotency_key ?? buildIdempotencyKey(offer);
  const channelConfig = inputData.channel_config ?? {};
  const requestEnvelope = {
    offer,
    dry_run: dryRun,
    idempotency_key: idempotencyKey,
    channel_config: channelConfig,
    meta: {
      driver: driverName,
      generated_at: new Date().toISOString(),
    },
  };
  const requestPath = path.join(outPath, "request.json");
  fs.writeFileSync(requestPath, JSON.stringify(requestEnvelope, null, 2), "utf8");

  const driverResult = await driverFn({
    offer,
    channel_config: channelConfig,
    dry_run: dryRun,
    outDir: outPath,
  });

  const ok = driverResult?.ok === true;
  const resultEnvelope = {
    ok,
    published_to: ok ? [driverName] : [],
    stats: {
      sent: driverResult?.sent ?? 0,
      failed: driverResult?.failed ?? (ok ? 0 : 1),
    },
    evidence_refs: driverResult?.evidence_paths ?? [],
    errors: ok ? [] : [driverResult?.error ?? "driver reported failure"],
    meta: {
      driver: driverName,
      dry_run: dryRun,
      idempotency_key: idempotencyKey,
    },
    ext: {
      driver_result: driverResult,
    },
  };
  const resultPath = path.join(outPath, "result.json");
  fs.writeFileSync(resultPath, JSON.stringify(resultEnvelope, null, 2), "utf8");
  if (!ok) {
    throw new Error("FlashSlot publish failed");
  }
}

try {
  await main();
} catch (err) {
  console.error("[flashslot_publish] FAIL:", err.message);
  process.exit(1);
}
