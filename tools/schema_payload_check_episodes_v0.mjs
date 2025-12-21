#!/usr/bin/env node
/**
 * Check payload_validate episodes in D1
 * 
 * Verifies that episodes contain required fields:
 * - ds_payload_ref
 * - ds_payload_hash
 * - cache_hit
 * - compile_ms
 * - validate_ms
 */

// Parse command line args
const args = process.argv.slice(2);
let baseUrl = null;
let sinceMinutes = 5;

for (const arg of args) {
  if (arg.startsWith('--base_url=')) {
    baseUrl = arg.split('=')[1];
  } else if (arg.startsWith('--base-url=')) {
    baseUrl = arg.split('=')[1];
  } else if (arg.startsWith('--since_minutes=')) {
    sinceMinutes = parseInt(arg.split('=')[1], 10);
  }
}

const GATEWAY_URL = baseUrl || process.env.GATEWAY_URL || 'http://localhost:8787';
const AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error('[check] ERROR: GATEWAY_AUTH_TOKEN environment variable required');
  console.error('[check] Set it in PowerShell: $env:GATEWAY_AUTH_TOKEN="your-token"');
  process.exit(1);
}

console.log(`[check] GATEWAY_AUTH_TOKEN found (length: ${AUTH_TOKEN.length})`);

/**
 * Check episodes
 */
async function checkEpisodes() {
  console.log('[check] Checking payload_validate episodes...');
  console.log(`[check] Gateway URL: ${GATEWAY_URL}`);
  console.log(`[check] Since: ${sinceMinutes} minutes ago`);
  console.log('');
  
  const sinceTs = Date.now() - (sinceMinutes * 60 * 1000);
  
  const response = await fetch(`${GATEWAY_URL}/episode/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      type: 'payload_validate',
      since_ts: sinceTs,
      limit: 100,
      order: 'desc'
    })
  });
  
  const data = await response.json();
  
  if (!response.ok || !data.ok) {
    console.error(`[check] ❌ Episode search FAIL: ${response.status}`);
    console.error(`[check]   Response:`, JSON.stringify(data, null, 2));
    process.exit(1);
  }
  
  const episodes = data.results || [];
  console.log(`[check] Found ${episodes.length} episodes`);
  console.log('');
  
  if (episodes.length === 0) {
    console.log('[check] ⚠️  No episodes found in the last ${sinceMinutes} minutes');
    console.log('[check]   Make sure smoke/soak tests have been run');
    return;
  }
  
  // Check each episode
  let allValid = true;
  const requiredFields = ['ds_payload_ref', 'ds_payload_hash', 'cache_hit', 'compile_ms', 'validate_ms'];
  
  for (const ep of episodes) {
    // Parse payload_json to check fields
    let payload = null;
    try {
      payload = JSON.parse(ep.payload_json || '{}');
    } catch (e) {
      console.error(`[check] ❌ Episode ${ep.id}: Failed to parse payload_json`);
      allValid = false;
      continue;
    }
    
    const missingFields = [];
    for (const field of requiredFields) {
      if (payload[field] === undefined) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      console.error(`[check] ❌ Episode ${ep.id}: Missing fields: ${missingFields.join(', ')}`);
      allValid = false;
    } else {
      console.log(`[check] ✅ Episode ${ep.id}: All required fields present`);
      console.log(`[check]   ds_payload_ref: ${payload.ds_payload_ref || 'N/A'}`);
      console.log(`[check]   ds_payload_hash: ${payload.ds_payload_hash ? payload.ds_payload_hash.substring(0, 16) + '...' : 'N/A'}`);
      console.log(`[check]   cache_hit: ${payload.cache_hit}`);
      console.log(`[check]   compile_ms: ${payload.compile_ms}ms`);
      console.log(`[check]   validate_ms: ${payload.validate_ms}ms`);
    }
  }
  
  console.log('');
  console.log('[check] ================================');
  if (allValid) {
    console.log('[check] ✅ All episodes have required fields');
    process.exit(0);
  } else {
    console.log('[check] ❌ Some episodes are missing required fields');
    process.exit(1);
  }
}

checkEpisodes().catch((error) => {
  console.error('[check] FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});

