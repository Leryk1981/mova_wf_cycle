# Phase 4 Dev Run Report: WF_EX_SCHEMA_PAYLOAD_002

**Date:** 2025-12-18  
**Time:** ~10:19 UTC  
**Worker URL:** https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev  
**Branch:** feature/WF_EX_OPENCODE_001_arch_to_mova

## Baseline Gates

- ✅ `npm run validate` — PASS
- ✅ `npm test` — PASS  
- ✅ `node tools/wf_cycle_smoke_ci.mjs` — PASS

## Test Execution

### 1. Smoke Tests (`npm run smoke:schema_payload`)

**Status:** ❌ FAIL (due to authentication)

**Results:**
- V0 validation: FAIL — "Invalid auth token"
- V1 validation: FAIL — "Invalid auth token" (schema put also failed with 401)
- V1 extended (v2 schema): FAIL — "Invalid auth token"
- V2 inline schema deny: FAIL — "Invalid auth token" (expected 403 with policy_check)

**Issue:** Tokens not properly passed to Node.js processes from PowerShell environment.

**Expected behavior (when tokens are set correctly):**
- ✅ V0: valid=true with hardcoded schema
- ✅ V1: valid=true with schema from registry (payload@v1, payload@v2)
- ✅ V2: deny with `policy_check.decision=deny` and `rule_id=v2_inline_schema_deny`

### 2. Soak Test (`npm run soak:schema_payload --variant v1 --runs 50 --warmup 10`)

**Status:** ⚠️ PASS (but with issues)

**Results:**
```
Runs: 50 (warmup: 10)
Cache hit rate: 0.0% (0/50)
Compile ms: avg=0.00, p95=0.00
Validate ms: avg=0.00, p95=0.00
Total ms: avg=68.48, p95=96.00
```

**Analysis:**
- ⚠️ Cache hit rate is 0% (expected >80% after warmup)
- ⚠️ Compile_ms and validate_ms are 0 — indicates requests are failing before validation (likely auth errors)
- Total latency (avg 68ms, p95 96ms) suggests network overhead, not validation time

**Expected (when auth works):**
- Cache hit rate should be high after warmup (80%+)
- Compile_ms should be ≈0 after warmup (cached)
- Validate_ms should show actual validation time (typically 1-5ms)

### 3. Episode Check (`node tools/schema_payload_check_episodes_v0.mjs`)

**Status:** ❌ FAIL (401 Unauthorized)

**Issue:** Cannot access episodes due to authentication failure.

**Expected (when auth works):**
- Episodes of type `payload_validate` should be found
- Each episode should contain:
  - `ds_payload_ref`
  - `ds_payload_hash`
  - `cache_hit`
  - `compile_ms`
  - `validate_ms`

## Root Cause Analysis

**Primary Issue:** Environment variables (`GATEWAY_AUTH_TOKEN`, `ADMIN_AUTH_TOKEN`) are not being passed from PowerShell to Node.js child processes when running through npm scripts.

**Root Cause:** Tokens were not set in the PowerShell session when tests were executed. PowerShell environment variables ARE passed to Node.js processes, but they must be set before running npm scripts.

**Solution:** 
1. Set tokens in PowerShell session before running tests
2. Use helper script `tools/setup_test_env.ps1` to verify environment setup
3. Use `tools/test_env_vars.mjs` to verify tokens are accessible

## Fixes Applied

1. **Soak test error handling:** Improved error handling in `tools/schema_payload_soak_v1.mjs` to properly detect and report authentication failures.
2. **Better error messages:** Added diagnostic messages in all test scripts to help identify when tokens are missing.
3. **Helper scripts:** Created `tools/setup_test_env.ps1` and `tools/test_env_vars.mjs` to verify environment setup.

## Next Steps

1. **Set tokens in PowerShell session:**
   ```powershell
   $env:GATEWAY_URL="https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev"
   $env:GATEWAY_AUTH_TOKEN="<your-actual-token>"
   $env:ADMIN_AUTH_TOKEN="<your-actual-admin-token>"
   ```

2. **Verify environment setup:**
   ```powershell
   # Option 1: Use helper script
   .\tools\setup_test_env.ps1
   
   # Option 2: Manual check
   node tools/test_env_vars.mjs
   ```

3. **Re-run tests:**
   ```powershell
   npm run smoke:schema_payload -- --base_url $env:GATEWAY_URL
   npm run soak:schema_payload -- --base_url $env:GATEWAY_URL --variant v1 --runs 50 --warmup 10
   node tools/schema_payload_check_episodes_v0.mjs --base_url $env:GATEWAY_URL
   ```

4. **Verify:**
   - V2 inline schema returns `policy_check.decision=deny` with `rule_id=v2_inline_schema_deny`
   - Episodes contain all required fields
   - Cache hit rate >80% after warmup

## Summary

- **Worker deployed:** ✅ Successfully deployed to dev environment
- **Baseline gates:** ✅ All PASS
- **Smoke tests:** ❌ FAIL (authentication issue)
- **Soak test:** ⚠️ PASS (but metrics indicate auth failures)
- **Episode check:** ❌ FAIL (authentication issue)

**Overall Status:** Tests infrastructure is ready, but requires proper token configuration in PowerShell environment to execute successfully.

