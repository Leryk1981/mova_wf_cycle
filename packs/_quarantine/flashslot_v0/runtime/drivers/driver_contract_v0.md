# FlashSlot driver contract v0

Input payload (per attempt):
```
{
  "offer": <ds.flashslot_offer_v1>,
  "channel_config": { ... driver-specific ... },
  "dry_run": true|false,
  "outDir": "<absolute path provided by runner>"
}
```

Driver must:
- Write all artifacts into `<outDir>/evidence/...` (create directories itself).
- Never touch network/state outside channel_config and env vars declared in docs.
- Return JSON serializable result `{ ok, sent, failed, evidence_paths: [] }`.
- Respect `dry_run` by avoiding real delivery but still creating evidence.
