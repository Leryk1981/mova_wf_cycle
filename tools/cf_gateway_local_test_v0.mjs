#!/usr/bin/env node
/**
 * Cloudflare Worker Gateway Local Test v0
 * 
 * Optional manual test script for the gateway.
 * NOT part of npm test - run manually with: npm run cf:test:gateway:local
 * 
 * Requires:
 * - Gateway running locally (npm run cf:dev:gateway)
 * - GATEWAY_AUTH_TOKEN environment variable
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8787';
const AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error('[test] ERROR: GATEWAY_AUTH_TOKEN environment variable required');
  console.error('[test] Set it via: $env:GATEWAY_AUTH_TOKEN="your-token"');
  process.exit(1);
}

/**
 * Send request to gateway
 */
async function sendRequest(path, body) {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  
  return {
    status: response.status,
    data: await response.json()
  };
}

/**
 * Test health endpoint
 */
async function testHealth() {
  console.log('[test] Testing GET /health...');
  const response = await fetch(`${GATEWAY_URL}/health`);
  const data = await response.json();
  
  if (data.ok && data.engine_ref) {
    console.log(`[test] ✅ Health check PASS: ${data.engine_ref}`);
    return true;
  } else {
    console.error('[test] ❌ Health check FAIL');
    return false;
  }
}

/**
 * Test DENY request
 */
async function testDeny() {
  console.log('[test] Testing DENY request (tool not in allowlist)...');
  
  const request = {
    request_id: `test_deny_${Date.now()}`,
    tool_id: 'http.fetch',
    args: {
      url: 'https://example.com'
    },
    ctx: {
      run_id: 'test_run_deny',
      step_id: 'test_step_deny',
      policy_ref: 'policy.default'
    }
  };
  
  const { status, data } = await sendRequest('/tool/run', request);
  
  if (status === 403 && !data.ok && data.policy_check?.decision === 'deny') {
    console.log(`[test] ✅ DENY request PASS`);
    console.log(`[test]   Decision: ${data.policy_check.decision}`);
    console.log(`[test]   Reason: ${data.policy_check.reason}`);
    console.log(`[test]   Evidence refs: ${data.evidence_refs?.length || 0}`);
    return true;
  } else {
    console.error(`[test] ❌ DENY request FAIL: status=${status}`);
    console.error(`[test]   Response:`, JSON.stringify(data, null, 2));
    return false;
  }
}

/**
 * Test ALLOW request (kv.get)
 */
async function testAllow() {
  console.log('[test] Testing ALLOW request (kv.get)...');
  
  const request = {
    request_id: `test_allow_${Date.now()}`,
    tool_id: 'kv.get',
    args: {
      key: 'test-key'
    },
    ctx: {
      run_id: 'test_run_allow',
      step_id: 'test_step_allow',
      policy_ref: 'policy.default'
    }
  };
  
  const { status, data } = await sendRequest('/tool/run', request);
  
  if (status === 200 && data.ok && data.tool_result) {
    console.log(`[test] ✅ ALLOW request PASS`);
    console.log(`[test]   Tool result exit_code: ${data.tool_result.exit_code}`);
    console.log(`[test]   Policy decision: ${data.policy_check?.decision}`);
    console.log(`[test]   Evidence refs: ${data.evidence_refs?.length || 0}`);
    return true;
  } else {
    console.error(`[test] ❌ ALLOW request FAIL: status=${status}`);
    console.error(`[test]   Response:`, JSON.stringify(data, null, 2));
    return false;
  }
}

/**
 * Main test execution
 */
async function main() {
  console.log('[test] Cloudflare Worker Gateway Local Test v0');
  console.log(`[test] Gateway URL: ${GATEWAY_URL}`);
  console.log('');
  
  let allPassed = true;
  
  // Test health
  const healthPass = await testHealth();
  allPassed = allPassed && healthPass;
  console.log('');
  
  // Test DENY
  const denyPass = await testDeny();
  allPassed = allPassed && denyPass;
  console.log('');
  
  // Test ALLOW
  const allowPass = await testAllow();
  allPassed = allPassed && allowPass;
  console.log('');
  
  // Summary
  console.log('[test] ================================');
  if (allPassed) {
    console.log('[test] ✅ All tests PASS');
    process.exit(0);
  } else {
    console.log('[test] ❌ Some tests FAILED');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[test] FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});

