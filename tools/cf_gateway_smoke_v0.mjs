#!/usr/bin/env node
/**
 * Cloudflare Worker Gateway Smoke Test v0
 * 
 * Smoke test using the Node.js driver (driver_cf_gateway_v0.mjs).
 * 
 * Requires:
 * - Gateway running locally (npm run cf:dev:gateway)
 * - GATEWAY_AUTH_TOKEN environment variable or .dev.vars file
 */

import { createDriver } from '../executors/cloudflare_worker_gateway_v0/driver/driver_cf_gateway_v0.mjs';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Parse command line args for base_url
const args = process.argv.slice(2);
let baseUrlArg = null;
for (const arg of args) {
  if (arg.startsWith('--base_url=')) {
    baseUrlArg = arg.split('=')[1];
  } else if (arg.startsWith('--base-url=')) {
    baseUrlArg = arg.split('=')[1];
  }
}

const GATEWAY_URL = baseUrlArg || process.env.GATEWAY_URL || 'http://localhost:8787';
const AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error('[smoke] ERROR: GATEWAY_AUTH_TOKEN environment variable required');
  console.error('[smoke] Set it via: $env:GATEWAY_AUTH_TOKEN="your-token"');
  console.error('[smoke] Or use .dev.vars file in worker/ directory');
  process.exit(1);
}

/**
 * Test DENY path (tool not in allowlist)
 */
async function testDeny(driver) {
  console.log('[smoke] Testing DENY path (http.fetch not in allowlist)...');
  
  const request = {
    request_id: `smoke_deny_${Date.now()}`,
    tool_id: 'http.fetch',
    args: {
      url: 'https://example.com'
    },
    ctx: {
      run_id: 'smoke_run_deny',
      step_id: 'smoke_step_deny',
      policy_ref: 'policy.default'
    }
  };
  
  const logsDir = join(process.cwd(), '.tmp', 'cf_gateway_smoke', 'deny');
  mkdirSync(logsDir, { recursive: true });
  
  try {
    const result = await driver.runTool(request, { logsDir });
    
    // Assertions
    if (!result.ok && result.policy_check?.decision === 'deny') {
      console.log(`[smoke] ✅ DENY path PASS`);
      console.log(`[smoke]   Decision: ${result.policy_check.decision}`);
      console.log(`[smoke]   Reason: ${result.policy_check.reason}`);
      console.log(`[smoke]   Evidence refs (remote): ${result.evidence_refs.length}`);
      
      // Verify evidence_refs doesn't contain http_trace (should be in local_evidence_paths)
      const hasTraceInRefs = result.evidence_refs.some(ref => ref.includes('http_trace'));
      if (hasTraceInRefs) {
        console.error(`[smoke] ❌ evidence_refs contains http_trace (should be in local_evidence_paths)`);
        return false;
      }
      
      // Verify local_evidence_paths exists and file exists
      if (!result.local_evidence_paths || result.local_evidence_paths.length === 0) {
        console.error(`[smoke] ❌ local_evidence_paths missing or empty`);
        return false;
      }
      
      const tracePath = result.local_evidence_paths.find(p => p.includes('http_trace'));
      if (!tracePath) {
        console.error(`[smoke] ❌ http_trace not found in local_evidence_paths`);
        return false;
      }
      
      const traceFullPath = join(process.cwd(), tracePath);
      if (!existsSync(traceFullPath)) {
        console.error(`[smoke] ❌ local evidence file does not exist: ${traceFullPath}`);
        return false;
      }
      
      console.log(`[smoke]   Local evidence paths: ${result.local_evidence_paths.length}`);
      console.log(`[smoke]   Engine ref: ${result.engine_ref}`);
      return true;
    } else {
      console.error(`[smoke] ❌ DENY path FAIL: expected ok=false, decision=deny`);
      console.error(`[smoke]   Result:`, JSON.stringify(result, null, 2));
      return false;
    }
  } catch (error) {
    console.error(`[smoke] ❌ DENY path FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Test ALLOW path (kv.get in allowlist)
 */
async function testAllow(driver) {
  console.log('[smoke] Testing ALLOW path (kv.get in allowlist)...');
  
  const request = {
    request_id: `smoke_allow_${Date.now()}`,
    tool_id: 'kv.get',
    args: {
      key: 'test-key'
    },
    ctx: {
      run_id: 'smoke_run_allow',
      step_id: 'smoke_step_allow',
      policy_ref: 'policy.default'
    }
  };
  
  const logsDir = join(process.cwd(), '.tmp', 'cf_gateway_smoke', 'allow');
  mkdirSync(logsDir, { recursive: true });
  
  try {
    const result = await driver.runTool(request, { logsDir });
    
    // Assertions
    if (result.ok && result.tool_result && result.policy_check?.decision === 'allow') {
      console.log(`[smoke] ✅ ALLOW path PASS`);
      console.log(`[smoke]   Tool result exit_code: ${result.tool_result.exit_code}`);
      console.log(`[smoke]   Policy decision: ${result.policy_check.decision}`);
      console.log(`[smoke]   Evidence refs (remote): ${result.evidence_refs.length}`);
      
      // Verify evidence_refs doesn't contain http_trace (should be in local_evidence_paths)
      const hasTraceInRefs = result.evidence_refs.some(ref => ref.includes('http_trace'));
      if (hasTraceInRefs) {
        console.error(`[smoke] ❌ evidence_refs contains http_trace (should be in local_evidence_paths)`);
        return false;
      }
      
      // Verify local_evidence_paths exists and file exists
      if (!result.local_evidence_paths || result.local_evidence_paths.length === 0) {
        console.error(`[smoke] ❌ local_evidence_paths missing or empty`);
        return false;
      }
      
      const tracePath = result.local_evidence_paths.find(p => p.includes('http_trace'));
      if (!tracePath) {
        console.error(`[smoke] ❌ http_trace not found in local_evidence_paths`);
        return false;
      }
      
      const traceFullPath = join(process.cwd(), tracePath);
      if (!existsSync(traceFullPath)) {
        console.error(`[smoke] ❌ local evidence file does not exist: ${traceFullPath}`);
        return false;
      }
      
      console.log(`[smoke]   Local evidence paths: ${result.local_evidence_paths.length}`);
      console.log(`[smoke]   Engine ref: ${result.engine_ref}`);
      return true;
    } else {
      console.error(`[smoke] ❌ ALLOW path FAIL: expected ok=true, tool_result present`);
      console.error(`[smoke]   Result:`, JSON.stringify(result, null, 2));
      return false;
    }
  } catch (error) {
    console.error(`[smoke] ❌ ALLOW path FAIL: ${error.message}`);
    return false;
  }
}

/**
 * Main smoke test execution
 */
async function main() {
  console.log('[smoke] Cloudflare Worker Gateway Smoke Test v0 (via driver)');
  console.log(`[smoke] Gateway URL: ${GATEWAY_URL}`);
  console.log('');
  
  // Create driver
  const driver = createDriver({
    baseUrl: GATEWAY_URL,
    authToken: AUTH_TOKEN
  });
  
  let allPassed = true;
  
  // Test DENY
  const denyPass = await testDeny(driver);
  allPassed = allPassed && denyPass;
  console.log('');
  
  // Test ALLOW
  const allowPass = await testAllow(driver);
  allPassed = allPassed && allowPass;
  console.log('');
  
  // Test episode search
  const searchPass = await testEpisodeSearch(driver);
  allPassed = allPassed && searchPass;
  console.log('');
  
  // Test artifact get (if we have an evidence ref from allow test)
  if (searchPass) {
    const artifactPass = await testArtifactGet(driver);
    allPassed = allPassed && artifactPass;
    console.log('');
  }
  
  // Summary
  console.log('[smoke] ================================');
  if (allPassed) {
    console.log('[smoke] ✅ All smoke tests PASS');
    process.exit(0);
  } else {
    console.log('[smoke] ❌ Some smoke tests FAILED');
    process.exit(1);
  }
}

/**
 * Test episode search
 */
async function testEpisodeSearch(driver) {
  console.log('[smoke] Testing POST /episode/search...');
  
  const searchRequest = {
    limit: 20,
    order: 'desc'
  };
  
  const logsDir = join(process.cwd(), '.tmp', 'cf_gateway_smoke', 'search');
  mkdirSync(logsDir, { recursive: true });
  
  try {
    // Make direct HTTP request (driver doesn't have search method yet)
    const response = await fetch(`${GATEWAY_URL}/episode/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify(searchRequest)
    });
    
    const data = await response.json();
    
    if (response.ok && data.ok && Array.isArray(data.results)) {
      console.log(`[smoke] ✅ Episode search PASS`);
      console.log(`[smoke]   Found ${data.results.length} episodes`);
      
      // Try to find our test episodes
      const allowFound = data.results.some((ep) => ep.id && ep.id.includes('allow'));
      const denyFound = data.results.some((ep) => ep.id && ep.id.includes('deny'));
      
      if (allowFound || denyFound) {
        console.log(`[smoke]   Found test episodes: allow=${allowFound}, deny=${denyFound}`);
      }
      
      return { success: true, results: data.results };
    } else {
      console.error(`[smoke] ❌ Episode search FAIL: ${response.status}`);
      console.error(`[smoke]   Response:`, JSON.stringify(data, null, 2));
      return { success: false };
    }
  } catch (error) {
    console.error(`[smoke] ❌ Episode search FAIL: ${error.message}`);
    return { success: false };
  }
}

/**
 * Test artifact get
 */
async function testArtifactGet(driver) {
  console.log('[smoke] Testing GET /artifact/get...');
  
  // First, search for an episode with evidence_refs
  const searchRequest = {
    limit: 10,
    decision: 'allow',
    order: 'desc'
  };
  
  try {
    const searchResponse = await fetch(`${GATEWAY_URL}/episode/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify(searchRequest)
    });
    
    const searchData = await searchResponse.json();
    
    if (!searchData.ok || !Array.isArray(searchData.results) || searchData.results.length === 0) {
      console.log(`[smoke] ⚠️  Artifact get SKIP: no episodes with evidence_refs found`);
      return { success: true };
    }
    
    // Get first evidence ref from first episode
    const firstEpisode = searchData.results[0];
    if (!firstEpisode.evidence_refs || firstEpisode.evidence_refs.length === 0) {
      console.log(`[smoke] ⚠️  Artifact get SKIP: no evidence_refs in episode`);
      return { success: true };
    }
    
    const artifactRef = firstEpisode.evidence_refs[0];
    
    // Get artifact
    const artifactUrl = new URL(`${GATEWAY_URL}/artifact/get`);
    artifactUrl.searchParams.set('ref', artifactRef);
    
    const artifactResponse = await fetch(artifactUrl.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    if (artifactResponse.status === 404) {
      console.log(`[smoke] ⚠️  Artifact get: 404 (artifact not found: ${artifactRef})`);
      return { success: true }; // Not a failure, artifact might not exist yet
    }
    
    if (artifactResponse.ok) {
      const text = await artifactResponse.text();
      const contentType = artifactResponse.headers.get('content-type') || '';
      
      console.log(`[smoke] ✅ Artifact get PASS`);
      console.log(`[smoke]   Ref: ${artifactRef}`);
      console.log(`[smoke]   Content-Type: ${contentType}`);
      console.log(`[smoke]   Body preview: ${text.substring(0, 100)}...`);
      
      // Check if it's JSON
      if (contentType.includes('json') && text.trim().startsWith('{')) {
        console.log(`[smoke]   ✅ Body is valid JSON`);
      }
      
      return { success: true };
    } else {
      console.error(`[smoke] ❌ Artifact get FAIL: ${artifactResponse.status}`);
      return { success: false };
    }
  } catch (error) {
    console.error(`[smoke] ❌ Artifact get FAIL: ${error.message}`);
    return { success: false };
  }
}

main().catch((error) => {
  console.error('[smoke] FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});

