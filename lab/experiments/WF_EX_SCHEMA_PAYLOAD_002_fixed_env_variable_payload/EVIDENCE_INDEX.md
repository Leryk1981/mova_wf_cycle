# Evidence Index: WF_EX_SCHEMA_PAYLOAD_002

## Evidence Items

| evidence_item | where | path/ref | what it proves |
|---------------|-------|----------|----------------|
| Baseline validate log | local | `.tmp/WF_EX_SCHEMA_PAYLOAD_002/baseline_validate.log` | All schema/manifest validations pass |
| Baseline test log | local | `.tmp/WF_EX_SCHEMA_PAYLOAD_002/baseline_test.log` | All unit tests pass |
| Baseline smoke log | local | `.tmp/WF_EX_SCHEMA_PAYLOAD_002/baseline_smoke.log` | WF cycle smoke tests pass |
| Live health check | remote | `.tmp/WF_EX_SCHEMA_PAYLOAD_002/live_health.json` | Worker is accessible and healthy |
| Live smoke schema payload log | remote | `.tmp/WF_EX_SCHEMA_PAYLOAD_002/live_smoke_schema_payload.log` | Validation works after AJV replacement |
| Episode search results | remote | `.tmp/WF_EX_SCHEMA_PAYLOAD_002/episode_search.json` | Episodes are recorded with full metadata |
| Test report (AJV replacement) | local | `TEST_REPORT_AJV_REPLACEMENT.md` | Complete test results after fixing AJV blocker |
| Soak test results | local | `.tmp/schema_payload_soak/results.json` | Performance metrics (cache hit rate, latency) |

## Key Evidence

### 1. AJV Blocker (Historical)

**Location:** `TEST_REPORT_AJV_REPLACEMENT.md` (section "Проблема")

**Proves:** 
- AJV fails on Cloudflare Workers due to CSP restrictions
- Error: "Code generation from strings disallowed for this context"
- This was a critical blocker before replacement

### 2. Solution Validation

**Location:** `TEST_REPORT_AJV_REPLACEMENT.md` (section "Результаты тестирования")

**Proves:**
- `@cfworker/json-schema` works on Workers
- All variants (V0, V1, V2) pass after replacement
- Performance maintained (cache hit rate 100%, validate_ms ≈ 0)

### 3. Architecture Validation

**Location:** `TEST_REPORT_AJV_REPLACEMENT.md` (section "Подтверждение гипотезы")

**Proves:**
- V1 architecture is correct (flexibility without code release)
- Security maintained (data doesn't extend behavior)
- Reproducibility ensured (episodes contain ds_payload_ref + ds_payload_hash)

### 4. Performance Metrics

**Location:** `.tmp/schema_payload_soak/results.json`

**Proves:**
- Cache hit rate: 100% after warmup
- Compile ms: 0ms (cached validators)
- Validate ms: 0ms (instant validation)
- Total ms: ~890ms (network + artifact writes, not validation)

### 5. Episode Completeness

**Location:** `.tmp/WF_EX_SCHEMA_PAYLOAD_002/episode_search.json`

**Proves:**
- Episodes contain all required fields:
  - `ds_payload_ref`
  - `ds_payload_hash`
  - `cache_hit`
  - `compile_ms`
  - `validate_ms`
- Enables reproducibility and audit trail

## Evidence Collection Process

1. **Baseline gates:** Run before any changes to ensure system is stable
2. **Live checks:** Verify remote Worker behavior
3. **Episode collection:** Gather evidence of validation runs
4. **Performance testing:** Measure cache effectiveness and latency
5. **Documentation:** Record all findings in test reports

## Evidence Storage

- **Local artifacts:** `.tmp/WF_EX_SCHEMA_PAYLOAD_002/`
- **Remote artifacts:** R2 bucket `mova-gateway-artifacts-dev`
- **Episodes:** D1 database `mova_gateway_episodes_dev`
- **Documentation:** Experiment folder `lab/experiments/WF_EX_SCHEMA_PAYLOAD_002_fixed_env_variable_payload/`

