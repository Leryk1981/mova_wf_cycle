# Decision: WF_EX_SCHEMA_PAYLOAD_002

## Summary

**We keep the V1 architecture idea, but replace AJV compile strategy for Workers.**

## Architecture Decision

### ✅ Keep: V1 (Schema in Registry)

**Rationale:**
- Provides flexibility without code release
- Maintains security through registry (only trusted schemas)
- Ensures reproducibility via `ds_payload_ref` + `ds_payload_hash`
- Acceptable latency (schema compilation cache)

**Implementation:**
- Schema stored in KV: `schema:<schema_id>:<version>`
- Worker loads schema by `schema_ref` from request
- Validator cache in Worker memory (LRU, limit 100)

### ✅ Keep: V2 Deny-by-Default Policy

**Rationale:**
- Demonstrates risks of inline schema (Schema-DoS, hidden behavior extension)
- All attempts are recorded in episodes for audit
- Policy check returns `decision=deny` with `rule_id=v2_inline_schema_deny`

### ❌ Replace: AJV → @cfworker/json-schema

**Rationale:**
- AJV uses code generation by default (optimization)
- Cloudflare Workers CSP disallows dynamic code generation
- `@cfworker/json-schema` is worker-safe (no code generation)
- Performance maintained after replacement

## Risks

### 1. Schema-DoS (Denial of Service)

**Risk:** Malicious or overly complex schemas could consume excessive resources.

**Mitigation:**
- Schema size limit: 64KB
- Cache size limit: 100 entries (LRU eviction)
- V2 inline schema deny-by-default
- Registry governance (only trusted schemas in V1)

**Monitoring:**
- Track schema compilation time
- Monitor cache hit rate
- Alert on excessive validation latency

### 2. Cache Size Management

**Risk:** Cache could grow unbounded or evict too aggressively.

**Current implementation:**
- Simple LRU: clear 50% oldest entries when limit reached
- Limit: 100 entries

**Future improvement:**
- More precise LRU eviction (remove only oldest entry)
- Consider cache size based on memory usage, not entry count

### 3. Registry Governance

**Risk:** Uncontrolled schema changes could break compatibility.

**Mitigation:**
- Schema versioning (e.g., `payload@v1`, `payload@v2`)
- Admin-only schema upload (`/schema/put` requires admin token)
- Schema metadata tracking (hash, size, timestamp)

**Future:**
- Schema review process
- Schema deprecation policy
- Schema compatibility checks

## Gate for Completion

**Experiment is considered successfully closed when:**

1. ✅ **Baseline gates pass:**
   - `npm run validate` - PASS
   - `npm test` - PASS
   - `node tools/wf_cycle_smoke_ci.mjs` - PASS

2. ✅ **Remote validation works:**
   - `/health` endpoint accessible
   - V0, V1, V2 validation variants work
   - No "code generation" errors

3. ✅ **Performance acceptable:**
   - Cache hit rate >80% after warmup
   - `compile_ms` ≈ 0 after warmup
   - `validate_ms` < 5ms

4. ✅ **Episodes complete:**
   - All episodes contain required fields:
     - `ds_payload_ref`
     - `ds_payload_hash`
     - `cache_hit`
     - `compile_ms`
     - `validate_ms`

5. ✅ **Documentation complete:**
   - RESULTS.md created
   - EVIDENCE_INDEX.md created
   - DECISION.md created
   - TEST_REPORT_AJV_REPLACEMENT.md created
   - metrics.json created

6. ✅ **Next steps defined:**
   - Production deployment plan
   - Schema registry governance process
   - Performance monitoring strategy

## Status

**Current status:** ✅ **EXPERIMENT CLOSED SUCCESSFULLY**

All gates passed. V1 architecture validated. AJV blocker resolved. Ready for production deployment.

