# Phase 4 runbook (summary)

1. Set secrets with the same flags as deploy (`--env dev --config wrangler.dev.jsonc`), ensuring `ADMIN_AUTH_TOKEN` is present.

2. Smoke:
- Load schemas via `/schema/put` (admin token).
- Validate V0/V1; expect V2 inline schema to be denied with `policy_check.decision=deny`.

3. Soak:
- Run both V0 and V1 to compare cache hit rate and latency after warmup.

4. Episode checks:
- Verify episodes include ds_payload_ref/hash, cache_hit, compile_ms, validate_ms, and policy_check.

5. Deliverables:
- Short smoke output, soak summary (p95 + cache_hit), and episode validation report.
