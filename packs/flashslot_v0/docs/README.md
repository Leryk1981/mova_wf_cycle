# FlashSlot Pack v0

FlashSlot покрывает сценарий, когда клиент отменяет приём/столик, и освободившийся слот нужно быстро распродать через готовые каналы без хаоса и ручных таблиц.

- Dental / orthodontics practices with limited chairs
- Barber / beauty shops trying to keep stylists busy
- Restaurants handling late cancellations of tasting menus
- Boutique fitness studios selling last-minute passes
- Field service / repair crews filling micro-windows between jobs

Runtime — полностью детерминированный (никакого SaaS/AI в проде). Контракты лежат в `ds.flashslot_offer_v1` для данных и `env.flashslot_offer_publish_request_v1` / `env.flashslot_offer_publish_result_v1` для обвязки.
