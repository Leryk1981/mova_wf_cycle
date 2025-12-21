#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const publishScript = path.join(repoRoot, "packs", "flashslot_v0", "runtime", "impl", "publish_offer_v0.mjs");
const hypothesisPath = path.join(repoRoot, "packs", "flashslot_v0", "examples", "hypothesis_001_dentist.json");
const runsRoot = path.join(repoRoot, "lab", "flashslot_runs");

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`command exited with code ${code}`));
      }
    });
  });
}

function expectFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing expected file: ${filePath}`);
  }
}

async function main() {
  fs.mkdirSync(runsRoot, { recursive: true });
  const runId = `${Date.now()}_smoke`;
  const outDir = path.join(runsRoot, runId);
  fs.mkdirSync(outDir, { recursive: true });
  await runNode([publishScript, "--in", hypothesisPath, "--out", outDir, "--driver", "noop", "--dry-run"]);
  const requestPath = path.join(outDir, "request.json");
  const resultPath = path.join(outDir, "result.json");
  const evidencePath = path.join(outDir, "evidence", "noop.json");
  expectFile(requestPath);
  expectFile(resultPath);
  expectFile(evidencePath);
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (!result?.ok) {
    throw new Error("FlashSlot smoke failed: result.ok !== true");
  }
  console.log(`[flashslot_smoke_ci] PASS: ${outDir}`);
}

try {
  await main();
} catch (err) {
  console.error("[flashslot_smoke_ci] FAIL:", err.message);

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
