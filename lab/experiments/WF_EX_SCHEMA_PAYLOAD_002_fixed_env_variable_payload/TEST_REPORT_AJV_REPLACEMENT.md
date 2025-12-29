# AJV replacement test report (summary)

Problem: Cloudflare Worker CSP blocks code generation used by AJV (`new Function`), causing validation failures.

Solution: replace AJV with `@cfworker/json-schema` which requires no codegen.

Changes:
- Removed `ajv`/`ajv-formats`; added `@cfworker/json-schema`.
- Swapped `compileSchema()` for `prepareSchemaValidator()` and cached validator instances.
- Adjusted episode payload queries to include `payload_json`; improved undefined handling.

Results:
- All V0/V1/V2 smoke tests pass; inline schema is denied correctly.
- Soak tests show ~0ms compile/validate after warmup with 100% cache hit rate.
- Episodes include `ds_payload_ref`, `ds_payload_hash`, `cache_hit`, `compile_ms`, `validate_ms`.

Conclusion: `@cfworker/json-schema` resolves CSP issues without regressing performance or functionality.
