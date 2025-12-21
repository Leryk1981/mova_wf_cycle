import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function ensureEvidenceDir(outDir) {
  const evidenceDir = join(outDir, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  return evidenceDir;
}

export default async function runNoopDriver({ offer, outDir, dry_run: dryRun = false }) {
  if (!outDir) {
    throw new Error("noop driver requires outDir");
  }
  const evidenceDir = ensureEvidenceDir(outDir);
  const payload = {
    driver: "noop",
    dry_run: Boolean(dryRun),
    offer_id: offer?.offer_id ?? null,
    timestamp: new Date().toISOString()
  };
  const evidencePath = join(evidenceDir, "noop.json");
  writeFileSync(evidencePath, JSON.stringify(payload, null, 2), "utf8");
  return {
    ok: true,
    sent: 0,
    failed: 0,
    evidence_paths: [evidencePath],
    driver: "noop",
    dry_run: Boolean(dryRun)
  };
}
