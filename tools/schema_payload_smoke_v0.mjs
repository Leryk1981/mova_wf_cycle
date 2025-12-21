#!/usr/bin/env node
/**
 * Schema Payload Smoke Test v0
 * 
 * Tests payload validation with V0, V1, V2 variants for WF_EX_SCHEMA_PAYLOAD_002
 * 
 * Usage:
 *   node tools/schema_payload_smoke_v0.mjs --base_url "<URL>" [--action <action>] [options]
 * 
 * Actions:
 *   - put_schema: Upload schema to registry
 *   - validate: Run validation tests (default)
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Parse command line args
const args = process.argv.slice(2);
let baseUrl = null;
let action = 'validate';
let schemaId = null;
let version = null;
let schemaFile = null;

for (const arg of args) {
  if (arg.startsWith('--base_url=')) {
    baseUrl = arg.split('=')[1];
  } else if (arg.startsWith('--base-url=')) {
    baseUrl = arg.split('=')[1];
  } else if (arg.startsWith('--action=')) {
    action = arg.split('=')[1];
  } else if (arg.startsWith('--schema_id=')) {
    schemaId = arg.split('=')[1];
  } else if (arg.startsWith('--version=')) {
    version = arg.split('=')[1];
  } else if (arg.startsWith('--schema_file=')) {
    schemaFile = arg.split('=')[1];
  }
}

const GATEWAY_URL = baseUrl || process.env.GATEWAY_URL || 'http://localhost:8787';

// Try multiple ways to get tokens (PowerShell env vars, process.env, etc.)
let AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN;
let ADMIN_AUTH_TOKEN = process.env.ADMIN_AUTH_TOKEN || AUTH_TOKEN;

// Debug: log if tokens are found (without exposing values)
if (AUTH_TOKEN) {
  console.log(`[smoke] GATEWAY_AUTH_TOKEN found (length: ${AUTH_TOKEN.length})`);
} else {
  console.error('[smoke] ERROR: GATEWAY_AUTH_TOKEN environment variable required');
  console.error('[smoke] Set it in PowerShell: $env:GATEWAY_AUTH_TOKEN="your-token"');
  console.error('[smoke] Or set it before npm: $env:GATEWAY_AUTH_TOKEN="token"; npm run smoke:schema_payload');
  process.exit(1);
}

if (ADMIN_AUTH_TOKEN && ADMIN_AUTH_TOKEN !== AUTH_TOKEN) {
  console.log(`[smoke] ADMIN_AUTH_TOKEN found (length: ${ADMIN_AUTH_TOKEN.length})`);
} else if (!process.env.ADMIN_AUTH_TOKEN) {
  console.log('[smoke] ADMIN_AUTH_TOKEN not set, using GATEWAY_AUTH_TOKEN as fallback');
}

/**
 * Put schema to registry
 */
async function putSchema(schemaId, version, schemaFile) {
  console.log(`[smoke] Putting schema ${schemaId}@${version} from ${schemaFile}...`);
  
  const schemaJson = JSON.parse(readFileSync(schemaFile, 'utf8'));
  
  const response = await fetch(`${GATEWAY_URL}/schema/put`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_AUTH_TOKEN}`
    },
    body: JSON.stringify({
      schema_id: schemaId,
      version: version,
      schema_json: schemaJson
    })
  });
  
  const data = await response.json();
  
  if (response.ok && data.ok) {
    console.log(`[smoke] ✅ Schema put PASS`);
    console.log(`[smoke]   Schema ref: ${data.schema_ref}`);
    console.log(`[smoke]   Schema hash: ${data.schema_hash}`);
    return true;
  } else {
    console.error(`[smoke] ❌ Schema put FAIL: ${response.status}`);
    console.error(`[smoke]   Response:`, JSON.stringify(data, null, 2));
    return false;
  }
}

/**
 * Test V0: Hardcoded schema
 */
async function testV0() {
  console.log('[smoke] Testing V0 (hardcoded schema)...');
  
  const payload = {
    kind: 'test',
    data: { foo: 'bar' },
    meta: { timestamp: new Date().toISOString() }
  };
  
  const response = await fetch(`${GATEWAY_URL}/payload/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      variant: 'v0',
      payload: payload
    })
  });
  
  const data = await response.json();
  
  if (response.ok && data.ok && data.valid) {
    console.log(`[smoke] ✅ V0 validation PASS`);
    console.log(`[smoke]   ds_payload_ref: ${data.ds_payload_ref}`);
    console.log(`[smoke]   cache_hit: ${data.cache_hit}`);
    console.log(`[smoke]   compile_ms: ${data.compile_ms}`);
    console.log(`[smoke]   validate_ms: ${data.validate_ms}`);
    return true;
  } else {
    console.error(`[smoke] ❌ V0 validation FAIL`);
    console.error(`[smoke]   Response:`, JSON.stringify(data, null, 2));
    return false;
  }
}

/**
 * Test V1: Schema from registry
 */
async function testV1() {
  console.log('[smoke] Testing V1 (schema from registry)...');
  
  // First, ensure schema is in registry
  const schemaFile = join(process.cwd(), 'lab/experiments/WF_EX_SCHEMA_PAYLOAD_002_fixed_env_variable_payload/schemas/ds.payload_v1.json');
  const schemaJson = JSON.parse(readFileSync(schemaFile, 'utf8'));
  
  // Put schema
  const putResponse = await fetch(`${GATEWAY_URL}/schema/put`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_AUTH_TOKEN}`
    },
    body: JSON.stringify({
      schema_id: 'payload',
      version: 'v1',
      schema_json: schemaJson
    })
  });
  
  if (!putResponse.ok) {
    console.log(`[smoke] ⚠️  Schema put failed (may already exist): ${putResponse.status}`);
  }
  
  // Test with v1 payload
  const payload = {
    kind: 'test',
    data: { foo: 'bar' }
  };
  
  const response = await fetch(`${GATEWAY_URL}/payload/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      variant: 'v1',
      schema_ref: 'payload@v1',
      payload: payload
    })
  });
  
  const data = await response.json();
  
  if (response.ok && data.ok && data.valid) {
    console.log(`[smoke] ✅ V1 validation PASS`);
    console.log(`[smoke]   ds_payload_ref: ${data.ds_payload_ref}`);
    console.log(`[smoke]   cache_hit: ${data.cache_hit}`);
    return true;
  } else {
    console.error(`[smoke] ❌ V1 validation FAIL`);
    console.error(`[smoke]   Response:`, JSON.stringify(data, null, 2));
    return false;
  }
}

/**
 * Test V1 with extended schema (v2)
 */
async function testV1Extended() {
  console.log('[smoke] Testing V1 with extended schema (v2)...');
  
  // Put v2 schema
  const schemaFile = join(process.cwd(), 'lab/experiments/WF_EX_SCHEMA_PAYLOAD_002_fixed_env_variable_payload/schemas/ds.payload_v2_extended.json');
  const schemaJson = JSON.parse(readFileSync(schemaFile, 'utf8'));
  
  const putResponse = await fetch(`${GATEWAY_URL}/schema/put`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_AUTH_TOKEN}`
    },
    body: JSON.stringify({
      schema_id: 'payload',
      version: 'v2',
      schema_json: schemaJson
    })
  });
  
  if (!putResponse.ok) {
    console.log(`[smoke] ⚠️  Schema put failed (may already exist): ${putResponse.status}`);
  }
  
  // Test with v2 payload (with new fields)
  const payload = {
    kind: 'test',
    data: { foo: 'bar' },
    tags: ['tag1', 'tag2'],
    priority: 5,
    context: {
      environment: 'test',
      region: 'us-east'
    }
  };
  
  const response = await fetch(`${GATEWAY_URL}/payload/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      variant: 'v1',
      schema_ref: 'payload@v2',
      payload: payload
    })
  });
  
  const data = await response.json();
  
  if (response.ok && data.ok && data.valid) {
    console.log(`[smoke] ✅ V1 extended validation PASS`);
    console.log(`[smoke]   ds_payload_ref: ${data.ds_payload_ref}`);
    console.log(`[smoke]   New fields validated without code change!`);
    return true;
  } else {
    console.error(`[smoke] ❌ V1 extended validation FAIL`);
    console.error(`[smoke]   Response:`, JSON.stringify(data, null, 2));
    return false;
  }
}

/**
 * Test V2: Inline schema (should be denied)
 */
async function testV2Deny() {
  console.log('[smoke] Testing V2 (inline schema - should be denied)...');
  
  const schemaJson = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["kind"],
    "properties": {
      "kind": { "type": "string" }
    }
  };
  
  const payload = {
    kind: 'test'
  };
  
  const response = await fetch(`${GATEWAY_URL}/payload/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify({
      variant: 'v2',
      schema_inline: schemaJson,
      payload: payload
    })
  });
  
  const data = await response.json();
  
  if (response.status === 403 && data.ok && !data.valid && data.policy_check && data.policy_check.decision === 'deny') {
    console.log(`[smoke] ✅ V2 deny PASS`);
    console.log(`[smoke]   Denied as expected: ${data.policy_check.reason}`);
    console.log(`[smoke]   Rule ID: ${data.policy_check.rule_id}`);
    return true;
  } else {
    console.error(`[smoke] ❌ V2 deny FAIL: expected 403 with policy_check.decision=deny`);
    console.error(`[smoke]   Response:`, JSON.stringify(data, null, 2));
    return false;
  }
}

/**
 * Main smoke test execution
 */
async function main() {
  console.log('[smoke] Schema Payload Smoke Test v0');
  console.log(`[smoke] Gateway URL: ${GATEWAY_URL}`);
  console.log('');
  
  if (action === 'put_schema') {
    if (!schemaId || !version || !schemaFile) {
      console.error('[smoke] ERROR: --schema_id, --version, and --schema_file required for put_schema action');
      process.exit(1);
    }
    const success = await putSchema(schemaId, version, schemaFile);
    process.exit(success ? 0 : 1);
  }
  
  // Run validation tests
  let allPassed = true;
  
  // Test V0
  const v0Pass = await testV0();
  allPassed = allPassed && v0Pass;
  console.log('');
  
  // Test V1
  const v1Pass = await testV1();
  allPassed = allPassed && v1Pass;
  console.log('');
  
  // Test V1 extended
  const v1ExtendedPass = await testV1Extended();
  allPassed = allPassed && v1ExtendedPass;
  console.log('');
  
  // Test V2 deny
  const v2DenyPass = await testV2Deny();
  allPassed = allPassed && v2DenyPass;
  console.log('');
  
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

main().catch((error) => {
  console.error('[smoke] FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});

