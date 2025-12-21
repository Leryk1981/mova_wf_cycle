#!/usr/bin/env node
/**
 * MOVA Tool Run Explain Smoke Test v0
 * 
 * Tests the explain mode of mova_tool_run_v0.mjs against Cloudflare Gateway.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const execAsync = promisify(exec);

const GATEWAY_URL = process.env.GATEWAY_URL || process.argv.find(arg => arg.startsWith('--base_url='))?.split('=')[1] || 'https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev';
const AUTH_TOKEN = process.env.CF_GATEWAY_AUTH_TOKEN || process.env.GATEWAY_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error('[smoke] ERROR: CF_GATEWAY_AUTH_TOKEN or GATEWAY_AUTH_TOKEN required');
  process.exit(1);
}

/**
 * Run mova_tool_run_v0 with explain mode
 */
async function runExplainTest(toolId, args, expectedDecision) {
  const requestId = `explain_smoke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[smoke] Testing explain mode: ${toolId} (expect ${expectedDecision})...`);
  
  // Write args to temp file to avoid shell escaping issues
  const tmpDir = join(process.cwd(), '.tmp', 'mova_tool_run_explain_smoke');
  mkdirSync(tmpDir, { recursive: true });
  const argsFile = join(tmpDir, `${requestId}_args.json`);
  writeFileSync(argsFile, JSON.stringify(args, null, 2));
  
  const cmd = `node tools/mova_tool_run_v0.mjs ` +
    `--executor_ref cloudflare_worker_gateway_v0 ` +
    `--base_url "${GATEWAY_URL}" ` +
    `--request_id "${requestId}" ` +
    `--tool_id "${toolId}" ` +
    `--args_file "${argsFile}" ` +
    `--explain ` +
    `--output json`;
  
  try {
    // Execute command - don't fail on non-zero exit code (deny is expected)
    let stdout = '';
    let stderr = '';
    try {
      const result = await execAsync(cmd, {
        env: { ...process.env, CF_GATEWAY_AUTH_TOKEN: AUTH_TOKEN },
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      // Command may exit with code 1 for deny, but that's expected
      stdout = error.stdout || '';
      stderr = error.stderr || '';
      
      // Only fail if it's not a deny decision
      if (expectedDecision === 'allow' && error.code !== 0) {
        console.error(`[smoke] ❌ Command failed with exit code ${error.code}`);
        console.error(`[smoke]   stdout: ${stdout.substring(0, 500)}`);
        console.error(`[smoke]   stderr: ${stderr.substring(0, 500)}`);
        return false;
      }
    }
    
    // Parse JSON output
    let result;
    try {
      // Find JSON in stdout (may have some text before/after)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[smoke] ❌ No JSON found in output`);
        console.error(`[smoke]   stdout: ${stdout.substring(0, 500)}`);
        return false;
      }
      result = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error(`[smoke] ❌ Failed to parse JSON output: ${e.message}`);
      console.error(`[smoke]   stdout: ${stdout.substring(0, 500)}`);
      return false;
    }
    
    // Check policy decision
    if (!result.policy_check || result.policy_check.decision !== expectedDecision) {
      console.error(`[smoke] ❌ Expected decision ${expectedDecision}, got ${result.policy_check?.decision || 'missing'}`);
      return false;
    }
    
    // Check for artifact files
    const explainDir = join(process.cwd(), '.tmp', 'mova_tool_run_explain', requestId);
    
    if (!existsSync(explainDir)) {
      console.error(`[smoke] ❌ Explain directory not created: ${explainDir}`);
      return false;
    }
    
    // Check for expected artifacts based on decision
    if (expectedDecision === 'allow') {
      // Assert tool_result exists and exit_code === 0
      if (!result.tool_result) {
        console.error(`[smoke] ❌ tool_result missing for ALLOW`);
        return false;
      }
      if (result.tool_result.exit_code !== 0) {
        console.error(`[smoke] ❌ tool_result.exit_code must be 0 for ALLOW, got ${result.tool_result.exit_code}`);
        return false;
      }
      
      const engineIdentityPath = join(explainDir, 'engine_identity.json');
      if (!existsSync(engineIdentityPath)) {
        console.error(`[smoke] ❌ engine_identity.json not found`);
        return false;
      }
      
      const toolResultPath = join(explainDir, 'tool_result.json');
      if (!existsSync(toolResultPath)) {
        console.error(`[smoke] ❌ tool_result.json not found`);
        return false;
      }
      
      // Verify engine_identity.json is valid JSON
      try {
        const identity = JSON.parse(readFileSync(engineIdentityPath, 'utf8'));
        if (!identity.gateway_version) {
          console.error(`[smoke] ❌ engine_identity.json missing gateway_version`);
          return false;
        }
      } catch (e) {
        console.error(`[smoke] ❌ engine_identity.json is not valid JSON: ${e.message}`);
        return false;
      }
      
      // Check local_evidence_paths
      if (!result.local_evidence_paths || result.local_evidence_paths.length === 0) {
        console.error(`[smoke] ❌ local_evidence_paths missing for ALLOW`);
        return false;
      }
      
      // Verify at least one local evidence file exists
      const localFileExists = result.local_evidence_paths.some(path => {
        const fullPath = join(process.cwd(), path);
        return existsSync(fullPath);
      });
      if (!localFileExists) {
        console.error(`[smoke] ❌ No local evidence files found`);
        return false;
      }
      
      console.log(`[smoke] ✅ ALLOW explain test PASS`);
      console.log(`[smoke]   Decision: ${result.policy_check.decision}`);
      console.log(`[smoke]   Exit code: ${result.tool_result.exit_code}`);
      console.log(`[smoke]   Found engine_identity.json and tool_result.json`);
      console.log(`[smoke]   Local evidence paths: ${result.local_evidence_paths.length}`);
    } else if (expectedDecision === 'deny') {
      // Assert no tool_result for DENY
      if (result.tool_result) {
        console.error(`[smoke] ❌ tool_result should not exist for DENY`);
        return false;
      }
      
      const policyDecisionPath = join(explainDir, 'policy_decision.json');
      if (!existsSync(policyDecisionPath)) {
        console.error(`[smoke] ❌ policy_decision.json not found`);
        return false;
      }
      
      // Verify it's valid JSON
      try {
        const decision = JSON.parse(readFileSync(policyDecisionPath, 'utf8'));
        if (decision.decision !== 'deny') {
          console.error(`[smoke] ❌ policy_decision.json has wrong decision: ${decision.decision}`);
          return false;
        }
      } catch (e) {
        console.error(`[smoke] ❌ policy_decision.json is not valid JSON: ${e.message}`);
        return false;
      }
      
      // Check local_evidence_paths (trace may be written even for DENY)
      if (result.local_evidence_paths && result.local_evidence_paths.length > 0) {
        const localFileExists = result.local_evidence_paths.some(path => {
          const fullPath = join(process.cwd(), path);
          return existsSync(fullPath);
        });
        if (localFileExists) {
          console.log(`[smoke]   Local evidence paths: ${result.local_evidence_paths.length}`);
        }
      }
      
      console.log(`[smoke] ✅ DENY explain test PASS`);
      console.log(`[smoke]   Decision: ${result.policy_check.decision}`);
      console.log(`[smoke]   Found policy_decision.json`);
    }
    
    return true;
  } catch (error) {
    console.error(`[smoke] ❌ Explain test FAILED: ${error.message}`);
    if (error.stdout) {
      console.error(`[smoke]   stdout: ${error.stdout.substring(0, 500)}`);
    }
    if (error.stderr) {
      console.error(`[smoke]   stderr: ${error.stderr.substring(0, 500)}`);
    }
    return false;
  }
}

/**
 * Main smoke test execution
 */
async function main() {
  console.log('[smoke] MOVA Tool Run Explain Smoke Test v0');
  console.log(`[smoke] Gateway URL: ${GATEWAY_URL}`);
  console.log('');
  
  let allPassed = true;
  
  // Test ALLOW with explain
  const allowPass = await runExplainTest('kv.get', { key: 'test-key' }, 'allow');
  allPassed = allPassed && allowPass;
  console.log('');
  
  // Test DENY with explain
  const denyPass = await runExplainTest('http.fetch', { url: 'https://example.com' }, 'deny');
  allPassed = allPassed && denyPass;
  console.log('');
  
  // Summary
  console.log('[smoke] ================================');
  if (allPassed) {
    console.log('[smoke] ✅ All explain smoke tests PASS');
    process.exit(0);
  } else {
    console.log('[smoke] ❌ Some explain smoke tests FAILED');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[smoke] FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});

