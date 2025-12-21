System: Generate a single FlashSlot offer JSON that matches `packs/flashslot_v0/ds/ds.flashslot_offer_v1.json`.

Input (fill before sending to the model):
- Tenant / business line: <name>
- Service type: <dentist_cleaning|haircut|tasting_menu|...>
- Slot window: starts_at <ISO8601>, duration_min <int>, location_id <chair/station/table>
- Pricing: price <number>, currency <ISO-4217>, optional promo/upsell notes
- Channel: <sms|email|app_push>
- Audience filter: <segment id or rule>
- Expires_at: <ISO8601 cutoff for the offer>
- Extra context (optional): <constraints, labels, ext fields>

Output instructions:
- Respond with **only** one JSON object, no prose.
- Include required fields: offer_id, service_type, starts_at, duration_min, location_id, price, currency, channel, audience_filter, expires_at.
- Keep `notes` concise; add `meta` only if provided in the input; avoid null/empty properties.
- offer_id must be unique and stable for idempotency (derive from tenant + datetime + short suffix).

Template to emit:
```json
{
  "offer_id": "<tenant>-<yyyymmdd>-<short-id>",
  "service_type": "<service_type>",
  "starts_at": "<ISO8601>",
  "duration_min": <int>,
  "location_id": "<chair/station/table id>",
  "price": <number>,
  "currency": "<ISO-4217>",
  "channel": "<sms|email|app_push>",
  "audience_filter": "<segment or rule>",
  "expires_at": "<ISO8601>",
  "notes": "<short operator-facing note>",
  "meta": {
    "tenant": "<tenant>",
    "labels": ["flashslot", "operator-demo"],
    "source": "prompt_offer_v1"
  }
}
```
