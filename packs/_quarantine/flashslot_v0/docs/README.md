# FlashSlot Pack v0

FlashSlot covers the scenario where a client cancels an appointment/table and the freed slot must be sold quickly through ready channels without chaos or manual spreadsheets.

- Dental / orthodontics practices with limited chairs
- Barber / beauty shops trying to keep stylists busy
- Restaurants handling late cancellations of tasting menus
- Boutique fitness studios selling last-minute passes
- Field service / repair crews filling micro-windows between jobs

Runtime is fully deterministic (no SaaS/AI in production). Contracts live in `ds.flashslot_offer_v1` for data and `env.flashslot_offer_publish_request_v1` / `env.flashslot_offer_publish_result_v1` for the envelope.
