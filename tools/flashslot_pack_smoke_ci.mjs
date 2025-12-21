#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relPath) {
  const absPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function formatErrors(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

function main() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const offerSchema = readJson("packs/flashslot_v0/ds/ds.flashslot_offer_v1.json");
  const publishRequestSchema = readJson("packs/flashslot_v0/env/env.flashslot_offer_publish_request_v1.json");
  const publishResultSchema = readJson("packs/flashslot_v0/env/env.flashslot_offer_publish_result_v1.json");

  ajv.addSchema(offerSchema, offerSchema.$id);

  const example = readJson("packs/flashslot_v0/examples/hypothesis_001_dentist.json");
  const offerValid = ajv.validate(offerSchema.$id, example.offer);
  if (!offerValid) {
    throw new Error(`offer example failed validation: ${formatErrors(ajv.errors)}`);
  }

  const publishRequest = {
    offer: example.offer,
    dry_run: true,
    idempotency_key: `flashslot-smoke-${Date.now()}`,
    meta: { source: "smoke" }
  };
  const validateRequest = ajv.compile(publishRequestSchema);
  if (!validateRequest(publishRequest)) {
    throw new Error(`publish request failed validation: ${formatErrors(validateRequest.errors)}`);
  }

  const publishResult = {
    ok: true,
    published_to: ["sms:segment:existing_patients"],
    stats: { sent: 5, failed: 0 },
    evidence_refs: ["s3://flashslot/smoke/offer_publish.json"],
    errors: [],
    meta: { duration_ms: 12 }
  };
  const validateResult = ajv.compile(publishResultSchema);
  if (!validateResult(publishResult)) {
    throw new Error(`publish result failed validation: ${formatErrors(validateResult.errors)}`);
  }

  console.log("[flashslot_smoke_ci] PASS: offer example, publish request, publish result");
}

try {
  main();
} catch (error) {
  console.error("[flashslot_smoke_ci] FAIL:", error.message);
  process.exit(1);
}
