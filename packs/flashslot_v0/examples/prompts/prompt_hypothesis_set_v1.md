System: Generate a FlashSlot hypothesis set with three variants (A/B/C) for one business scenario. Output only JSON code fences (no prose).

Input (fill before sending to the model):
- Tenant/business: <name>
- Vertical: <dentist|barber|restaurant|...>
- Slot details: starts_at <ISO8601>, duration_min <int>, location_id <chair/station/table>
- Pricing: price <number> + currency <ISO-4217>, optional discount/upsell note
- Channel: <sms|email|app_push>
- Audience rules: <segment ids or filters>
- Success metric: <e.g., booking confirmed before expiry>
- File targets:
  - Set path: packs/flashslot_v0/examples/hypothesis_set_001_dentist_abc.json (or custom)
  - Offer paths: packs/flashslot_v0/examples/hypotheses/hyp_A_<vertical>.json, ..._B_..., ..._C_...

Rules for every hypothesis JSON:
- Fields: hypothesis_id, tenant, scenario (1–2 sentences), offer (valid against ds.flashslot_offer_v1), audience_hint, success_metric.
- offer.offer_id must be unique per hypothesis and derive from tenant + variant.
- Keep notes concise; avoid null/empty properties; prefer noop-friendly channels.

Respond with four JSON blocks:
1) Hypothesis set descriptor (for set_path):
```json
{
  "id": "flashslot_<vertical>_set_<nnn>",
  "hypotheses": [
    { "id": "A", "offer_path": "<offer_path_A>" },
    { "id": "B", "offer_path": "<offer_path_B>" },
    { "id": "C", "offer_path": "<offer_path_C>" }
  ]
}
```
2) Hypothesis A JSON (save to <offer_path_A>):
```json
{
  "hypothesis_id": "flashslot_<tenant>_A",
  "tenant": "<tenant>",
  "scenario": "<what this variant tests>",
  "offer": { /* valid offer object */ },
  "audience_hint": "<segment/logic>",
  "success_metric": "<booking goal>"
}
```
3) Hypothesis B JSON (save to <offer_path_B>): same shape, new offer_id + scenario tweak.
4) Hypothesis C JSON (save to <offer_path_C>): same shape, new offer_id + scenario tweak.
