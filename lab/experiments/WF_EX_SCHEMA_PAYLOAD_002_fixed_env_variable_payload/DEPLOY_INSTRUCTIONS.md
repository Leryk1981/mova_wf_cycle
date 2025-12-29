# Deploy instructions — WF_EX_SCHEMA_PAYLOAD_002

1) Prepare secrets and env (Cloudflare Worker):
- Use the same target as deploy (`--env dev --config wrangler.dev.jsonc`).
- Set `ADMIN_AUTH_TOKEN`; keep `ALLOW_INLINE_SCHEMA` disabled by default.

2) Deploy worker:
- Run `wrangler deploy` with the chosen env/config.
- Capture the dev worker URL for tests.

3) Smoke tests:
- Upload schemas via `/schema/put` using `ADMIN_AUTH_TOKEN`.
- Validate V0/V1; confirm V2 inline schema is denied with `policy_check.decision=deny`.

4) Soak tests:
- Run both V0 and V1; check cache hits, compile_ms, validate_ms.

5) Episode verification:
- Ensure episodes include `ds_payload_ref`, `ds_payload_hash`, `cache_hit`, `compile_ms`, `validate_ms`, and `policy_check` fields.
