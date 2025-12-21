#!/usr/bin/env node
/**
 * OpenCode Engine Smoke Test (CI-safe)
 * 
 * Verifies engine availability and runs minimal real scenario:
 * 1. Health check via SSE
 * 2. Create session
 * 3. Execute 1-2 shell steps
 * 4. Execute 1 file.list step
 * 
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 */

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const baseUrl = process.env.MOVA_OPENCODE_BASE_URL || 'http://127.0.0.1:4096';
const artifactsDir = join(__dirname, '../.tmp/opencode_engine_smoke');

console.log('[smoke] OpenCode Engine Smoke Test');
console.log(`[smoke] Base URL: ${baseUrl}`);
console.log(`[smoke] Artifacts: ${artifactsDir}`);

// Clean and recreate artifacts directory
if (existsSync(artifactsDir)) {
  rmSync(artifactsDir, { recursive: true, force: true });
}
mkdirSync(artifactsDir, { recursive: true });

let failureCount = 0;

/**
 * Run a command and return exit code
 */
function runCommand(command, args, label) {
  return new Promise((resolve) => {
    console.log(`[smoke] ${label}...`);
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[smoke] ${label}: PASS`);
      } else {
        console.error(`[smoke] ${label}: FAIL (exit code ${code})`);
        failureCount++;
      }
      resolve(code);
    });
    
    proc.on('error', (err) => {
      console.error(`[smoke] ${label}: ERROR - ${err.message}`);
      failureCount++;
      resolve(1);
    });
  });
}

/**
 * Run step via executor router
 */
async function runDriverStep(stepConfig, outputDir) {
  // Use executor router
  const routerModule = await import('../executors/executor_router_v1.mjs');
  const { executeStep } = routerModule;
  
  try {
    const result = await executeStep({
      executor_ref: 'opencode_server_v1',
      step: stepConfig,
      ctx: {
        logsDir: outputDir,
        baseUrl: baseUrl
      }
    });
    
    // Save HTTP trace if available (for backward compatibility)
    if (result.http_trace_count > 0) {
      // Router already handles evidence_refs, but we can add explicit trace file
      const traceFile = join(outputDir, 'http_trace.jsonl');
      if (!result.evidence_refs.includes(traceFile)) {
        result.evidence_refs.push(traceFile);
      }
    }
    
    return {
      tool_id: stepConfig.tool_id,
      result: result.tool_result,
      session_id: result.session_ref,
      evidence_refs: result.evidence_refs,
      engine_ref: result.engine_ref
    };
  } catch (error) {
    throw error;
  }
}

async function main() {
  try {
    // Step 0: Engine Identity (provenance)
    console.log('[smoke] Step 0: Capture engine identity...');
    const identityFile = join(__dirname, '../.tmp/opencode_engine_identity/identity.json');
    
    await runCommand(
      'node',
      ['tools/opencode_engine_identity_v1.mjs'],
      'Step 0: Engine Identity'
    );
    
    if (existsSync(identityFile)) {
      console.log(`[smoke] Identity captured: ${identityFile}`);
    } else {
      console.warn('[smoke] WARNING: Identity file not found, continuing anyway');
    }
    
    // Step 1: Health check
    await runCommand(
      'node',
      [
        'executors/opencode_server_v1/scripts/healthcheck_sse.mjs',
        '--baseUrl',
        baseUrl,
        '--timeout',
        '10000'
      ],
      'Step 1: Health check (SSE /event)'
    );
    
    if (failureCount > 0) {
      console.error('[smoke] Health check failed, aborting remaining tests');
      process.exit(1);
    }
    
    // Step 2: Shell step 1 (echo test)
    console.log('[smoke] Step 2: Execute shell step 1 (echo test)...');
    const step2Dir = join(artifactsDir, 'step2_shell_echo');
    mkdirSync(step2Dir, { recursive: true });
    
    try {
      const result2 = await runDriverStep(
        {
          tool_id: 'shell',
          args: { command: 'echo "MOVA_SMOKE_TEST_STEP_1"' }
        },
        step2Dir
      );
      
      if (result2.result.exit_code === 0) {
        console.log('[smoke] Step 2: PASS');
      } else {
        console.error('[smoke] Step 2: FAIL (exit_code !== 0)');
        failureCount++;
      }
    } catch (error) {
      console.error(`[smoke] Step 2: ERROR - ${error.message}`);
      failureCount++;
    }
    
    // Step 3: Shell step 2 (pwd)
    console.log('[smoke] Step 3: Execute shell step 2 (pwd)...');
    const step3Dir = join(artifactsDir, 'step3_shell_pwd');
    mkdirSync(step3Dir, { recursive: true });
    
    try {
      const result3 = await runDriverStep(
        {
          tool_id: 'shell',
          args: { command: 'pwd' }
        },
        step3Dir
      );
      
      if (result3.result.exit_code === 0) {
        console.log('[smoke] Step 3: PASS');
      } else {
        console.error('[smoke] Step 3: FAIL (exit_code !== 0)');
        failureCount++;
      }
    } catch (error) {
      console.error(`[smoke] Step 3: ERROR - ${error.message}`);
      failureCount++;
    }
    
    // Step 4: file.list
    console.log('[smoke] Step 4: Execute file.list...');
    const step4Dir = join(artifactsDir, 'step4_file_list');
    mkdirSync(step4Dir, { recursive: true });
    
    try {
      const result4 = await runDriverStep(
        {
          tool_id: 'file.list',
          args: { path: '.' }
        },
        step4Dir
      );
      
      if (result4.result.exit_code === 0) {
        console.log('[smoke] Step 4: PASS');
      } else {
        console.error('[smoke] Step 4: FAIL (exit_code !== 0)');
        failureCount++;
      }
    } catch (error) {
      console.error(`[smoke] Step 4: ERROR - ${error.message}`);
      failureCount++;
    }
    
    // Summary
    console.log('\n[smoke] ================================');
    console.log(`[smoke] OpenCode Engine Smoke Test Complete`);
    console.log(`[smoke] Failures: ${failureCount}`);
    console.log(`[smoke] Artifacts: ${artifactsDir}`);
    
    // Evidence references
    if (existsSync(identityFile)) {
      console.log(`[smoke] Evidence - Engine Identity: ${identityFile}`);
    }
    
    if (failureCount === 0) {
      console.log('[smoke] Result: PASS');
      // Clean up artifacts on success (but preserve identity for traceability)
      rmSync(artifactsDir, { recursive: true, force: true });
      process.exit(0);
    } else {
      console.error('[smoke] Result: FAIL');
      console.error(`[smoke] Artifacts preserved at: ${artifactsDir}`);
      console.error(`[smoke] Evidence - Engine Identity: ${identityFile}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`[smoke] FATAL ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

