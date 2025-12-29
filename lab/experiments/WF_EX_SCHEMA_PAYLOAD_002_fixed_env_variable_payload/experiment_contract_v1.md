# Experiment contract — WF_EX_SCHEMA_PAYLOAD_002

Scope:
- Fixed engine identity and policy (deny-by-default for inline schemas).
- Variable pieces: payload schema version/hash and payload data.
- Payload/schema must not introduce new operations, domains, or tools; schemas validate structure only.

Required episode fields:
- `ds_payload_ref`, `ds_payload_hash`, `cache_hit`, `compile_ms`, `validate_ms`.

Episode types:
- `payload_validate` covering registry and inline validation attempts.

Schemas:
- `ds.payload_v1.json`, `ds.payload_v2_extended.json`, `ds.payload_attack_v1.json` as reference cases.
