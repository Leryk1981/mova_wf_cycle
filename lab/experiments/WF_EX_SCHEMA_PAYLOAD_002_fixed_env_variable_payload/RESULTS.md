# Results — WF_EX_SCHEMA_PAYLOAD_002

Status: ✅ PASS

- V1 confirms flexible payloads via registry without code changes; payload@v2 validates successfully.
- V2 inline schema is denied by default and records policy decisions in episodes.
- Cache hit rate reaches 100% after warmup; compile_ms and validate_ms drop to ~0ms.
- Episodes in D1 include payload refs/hashes, compile/validate timings, cache_hit, and policy_check data.

Conclusion: registry-based validation with `@cfworker/json-schema` meets flexibility, safety, and reproducibility goals.
