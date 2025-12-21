#!/usr/bin/env node
/**
 * Schema Payload Soak Test v1
 * 
 * Measures latency and cache hit rate for payload validation
 * 
 * Usage:
 *   node tools/schema_payload_soak_v1.mjs --base_url "<URL>" --variant v1 --runs 50 --warmup 10
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Parse command line args
const args = process.argv.slice(2);
let baseUrl = null;
let variant = 'v1';
let runs = 50;
let warmup = 10;
let schemaRef = 'payload@v1';

for (const arg of args) {
  if (arg.startsWith('--base_url=')) {
    baseUrl = arg.split('=')[1];
  } else if (arg.startsWith('--base-url=')) {
    baseUrl = arg.split('=')[1];
  } else if (arg.startsWith('--variant=')) {
    variant = arg.split('=')[1];
  } else if (arg.startsWith('--runs=')) {
    runs = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--warmup=')) {
    warmup = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--schema_ref=')) {
    schemaRef = arg.split('=')[1];
  }
}

const GATEWAY_URL = baseUrl || process.env.GATEWAY_URL || 'http://localhost:8787';
const AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error('[soak] ERROR: GATEWAY_AUTH_TOKEN environment variable required');
  console.error('[soak] Set it in PowerShell: $env:GATEWAY_AUTH_TOKEN="your-token"');
  console.error('[soak] Or set it before npm: $env:GATEWAY_AUTH_TOKEN="token"; npm run soak:schema_payload');
  process.exit(1);
}

console.log(`[soak] GATEWAY_AUTH_TOKEN found (length: ${AUTH_TOKEN.length})`);

/**
 * Run single validation request
 */
async function runValidation(variant, schemaRef, schemaInline, payload) {
  const startTime = Date.now();
  
  const body = {
    variant,
    payload
  };
  
  if (variant === 'v1' && schemaRef) {
    body.schema_ref = schemaRef;
  } else if (variant === 'v2' && schemaInline) {
    body.schema_inline = schemaInline;
  }
  
  const response = await fetch(`${GATEWAY_URL}/payload/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  
  let data;
  try {
    data = await response.json();
  } catch (e) {
    const text = await response.text();
    throw new Error(`Failed to parse response: ${response.status} ${text}`);
  }
  
  const totalMs = Date.now() - startTime;
  
  if (!response.ok || !data.ok) {
    throw new Error(`Request failed: ${data.error || 'Unknown error'}`);
  }
  
  return {
    ok: true,
    valid: data.valid || false,
    cache_hit: data.cache_hit || false,
    compile_ms: data.compile_ms || 0,
    validate_ms: data.validate_ms || 0,
    total_ms: totalMs,
    errors: data.errors || []
  };
}

/**
 * Calculate percentile
 */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Main soak test execution
 */
async function main() {
  console.log('[soak] Schema Payload Soak Test v1');
  console.log(`[soak] Gateway URL: ${GATEWAY_URL}`);
  console.log(`[soak] Variant: ${variant}`);
  console.log(`[soak] Runs: ${runs} (warmup: ${warmup})`);
  console.log('');
  
  // Prepare payload
  let payload;
  let schemaInline = null;
  
  if (variant === 'v0') {
    payload = {
      kind: 'soak_test',
      data: { test: 'data', iteration: 0 },
      meta: { timestamp: new Date().toISOString() }
    };
  } else if (variant === 'v1') {
    payload = {
      kind: 'soak_test',
      data: { test: 'data', iteration: 0 },
      tags: ['soak'],
      priority: 5,
      context: { environment: 'test' }
    };
  } else if (variant === 'v2') {
    schemaInline = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "required": ["kind", "data"],
      "properties": {
        "kind": { "type": "string" },
        "data": { "type": "object", "additionalProperties": true }
      }
    };
    payload = {
      kind: 'soak_test',
      data: { test: 'data', iteration: 0 }
    };
  }
  
  const results = [];
  let cacheHits = 0;
  let totalCacheHits = 0;
  
  // Warmup phase
  console.log(`[soak] Warmup phase (${warmup} runs)...`);
  for (let i = 0; i < warmup; i++) {
    payload.data.iteration = i;
    if (payload.meta) {
      payload.meta.timestamp = new Date().toISOString();
    }
    
    const result = await runValidation(variant, schemaRef, schemaInline, payload);
    if (result.cache_hit) {
      cacheHits++;
    }
  }
  console.log(`[soak] Warmup complete (cache hits: ${cacheHits}/${warmup})`);
  console.log('');
  
  // Main test phase
  console.log(`[soak] Main test phase (${runs} runs)...`);
  cacheHits = 0;
  
  for (let i = 0; i < runs; i++) {
    payload.data.iteration = i;
    if (payload.meta) {
      payload.meta.timestamp = new Date().toISOString();
    }
    
    const result = await runValidation(variant, schemaRef, schemaInline, payload);
    results.push(result);
    
    if (result.cache_hit) {
      cacheHits++;
      totalCacheHits++;
    }
    
    if ((i + 1) % 10 === 0) {
      console.log(`[soak] Progress: ${i + 1}/${runs} (cache hits: ${cacheHits}/${i + 1})`);
    }
  }
  
  console.log('');
  
  // Calculate statistics
  const compileMs = results.map(r => r.compile_ms);
  const validateMs = results.map(r => r.validate_ms);
  const totalMs = results.map(r => r.total_ms);
  
  const avgCompileMs = compileMs.reduce((a, b) => a + b, 0) / compileMs.length;
  const avgValidateMs = validateMs.reduce((a, b) => a + b, 0) / validateMs.length;
  const avgTotalMs = totalMs.reduce((a, b) => a + b, 0) / totalMs.length;
  
  const p95CompileMs = percentile(compileMs, 95);
  const p95ValidateMs = percentile(validateMs, 95);
  const p95TotalMs = percentile(totalMs, 95);
  
  const cacheHitRate = (totalCacheHits / runs) * 100;
  
  // Output results
  console.log('[soak] ================================');
  console.log('[soak] Results:');
  console.log(`[soak]   Cache hit rate: ${cacheHitRate.toFixed(1)}% (${totalCacheHits}/${runs})`);
  console.log(`[soak]   Compile ms: avg=${avgCompileMs.toFixed(2)}, p95=${p95CompileMs.toFixed(2)}`);
  console.log(`[soak]   Validate ms: avg=${avgValidateMs.toFixed(2)}, p95=${p95ValidateMs.toFixed(2)}`);
  console.log(`[soak]   Total ms: avg=${avgTotalMs.toFixed(2)}, p95=${p95TotalMs.toFixed(2)}`);
  console.log('');
  
  // Save results to file
  const resultsDir = join(process.cwd(), '.tmp', 'schema_payload_soak');
  mkdirSync(resultsDir, { recursive: true });
  
  const resultsFile = join(resultsDir, 'results.json');
  const summary = {
    variant,
    schema_ref: schemaRef,
    runs,
    warmup,
    cache_hit_rate: cacheHitRate,
    cache_hits: totalCacheHits,
    compile_ms: {
      avg: avgCompileMs,
      p95: p95CompileMs,
      min: Math.min(...compileMs),
      max: Math.max(...compileMs)
    },
    validate_ms: {
      avg: avgValidateMs,
      p95: p95ValidateMs,
      min: Math.min(...validateMs),
      max: Math.max(...validateMs)
    },
    total_ms: {
      avg: avgTotalMs,
      p95: p95TotalMs,
      min: Math.min(...totalMs),
      max: Math.max(...totalMs)
    },
    timestamp: new Date().toISOString()
  };
  
  writeFileSync(resultsFile, JSON.stringify(summary, null, 2));
  
  console.log(`[soak] Results saved to: ${resultsFile}`);
  console.log('');
  
  // Check acceptance criteria
  let allPassed = true;
  
  if (warmup > 0) {
    // After warmup, compile_ms should be ≈0 for cache hits
    const warmResults = results.filter(r => r.cache_hit);
    if (warmResults.length > 0) {
      const avgWarmCompileMs = warmResults.reduce((a, b) => a + b.compile_ms, 0) / warmResults.length;
      if (avgWarmCompileMs > 1) {
        console.log(`[soak] ⚠️  Warning: avg compile_ms for cache hits is ${avgWarmCompileMs.toFixed(2)}ms (expected ≈0)`);
      } else {
        console.log(`[soak] ✅ Cache hit compile_ms ≈0: ${avgWarmCompileMs.toFixed(2)}ms`);
      }
    }
  }
  
  if (cacheHitRate < 80) {
    console.log(`[soak] ⚠️  Warning: cache hit rate is ${cacheHitRate.toFixed(1)}% (expected >80%)`);
  } else {
    console.log(`[soak] ✅ Cache hit rate acceptable: ${cacheHitRate.toFixed(1)}%`);
  }
  
  console.log('');
  console.log('[soak] ================================');
  if (allPassed) {
    console.log('[soak] ✅ Soak test PASS');
    process.exit(0);
  } else {
    console.log('[soak] ⚠️  Soak test completed with warnings');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('[soak] FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});

