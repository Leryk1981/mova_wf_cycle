# FlashSlot: operator checklist v0

## Input (collect from business)
- Service type + slot metadata: service name, start time, duration, chair/station/location, base price.
- Cancellation policy + constraints: how long before start clients can cancel, blackout windows, discount limits, upsell rules.
- Audience + channel: target segments/waitlist tags, preferred channels (sms/email/push), consent requirements.
- Operational limits: time zone, daily send caps, manual approval needs, dry-run vs live, evidence retention path.

## Hypotheses (produce A/B/C)
- Use external model or manual editing with `packs/flashslot_v0/examples/prompts/prompt_hypothesis_set_v1.md`.
- Emit three offers (A/B/C) and a descriptor JSON; keep schema `ds.flashslot_offer_v1`.
- Store offers in `packs/flashslot_v0/examples/hypotheses/` and the set file in `packs/flashslot_v0/examples/` (e.g., `hypothesis_set_00X_<domain>_abc.json`).

## Run (one command)
- `npm run flashslot:experiment -- --set <path-to-set> --driver noop --dry-run --out <lab/flashslot_runs/...>`
  - Proves the set is readable, offers validate, attempts run, and artifacts land in `lab/flashslot_runs/`.
- Quick CI parity: `npm run smoke:flashslot:experiment` (uses committed dentist + barbershop sets).

## Evidence (proof pack)
- `<out>/experiment_summary.json` — summary with `ok:true` and attempt results.
- `<out>/winner_pack/` — copied offer/request/result/stdout/stderr for the winning hypothesis.
- `<out>/attempts/<id>/` — per-hypothesis offer, request, result, and logs.

## Acceptance (client ready)
- Inputs captured and versioned; hypotheses A/B/C committed with deterministic IDs.
- Experiment run completes with `ok:true`, summary + winner_pack present, and logs retained.
- Repeatable command documented; artifacts stored in repo or client-owned path for audit.
