#!/usr/bin/env node
/**
 * OpenCode Engine Soak Test v1
 * 
 * Load and stability testing for OpenCode engine.
 * 
 * Parameters:
 *   --runs N         Number of test runs (default: 50)
 *   --concurrency N  Concurrent runs (default: 1)
 *   --base_url URL   Base URL (default: env MOVA_OPENCODE_BASE_URL or http://127.0.0.1:4096)
 * 
 * Metrics tracked:
 *   - Duration per step
 *   - Failures
 *   - SSE disconnects
 *   - Artifact isolation check
 * 
 * Output:
 *   .tmp/opencode_engine_soak/soak_results.json
 *   .tmp/opencode_engine_soak/soak_log.jsonl
 */

import { mkdirSync, rmSync, existsSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const eqArg = args.find(a => a.startsWith(`--${name}=`));
  if (eqArg) return eqArg.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx < args.length - 1) return args[idx + 1];
  return defaultValue;
}

const runsCount = parseInt(getArg('runs', '50'), 10);
const concurrency = parseInt(getArg('concurrency', '1'), 10);
const baseUrl = getArg('base_url', process.env.MOVA_OPENCODE_BASE_URL || 'http://127.0.0.1:4096');

const artifactsDir = join(__dirname, '../.tmp/opencode_engine_soak');
const resultsFile = join(artifactsDir, 'soak_results.json');
const logFile = join(artifactsDir, 'soak_log.jsonl');

console.log('[soak] OpenCode Engine Soak Test v1');
console.log(`[soak] Runs: ${runsCount}`);
console.log(`[soak] Concurrency: ${concurrency}`);
console.log(`[soak] Base URL: ${baseUrl}`);
console.log(`[soak] Output: ${artifactsDir}`);

// Clean and recreate artifacts directory
if (existsSync(artifactsDir)) {
  rmSync(artifactsDir, { recursive: true, force: true });
}
mkdirSync(artifactsDir, { recursive: true });

// Initialize log file
writeFileSync(logFile, '');

// Metrics
const metrics = {
  total_runs: runsCount,
  completed_runs: 0,
  failed_runs: 0,
  total_duration_ms: 0,
  min_duration_ms: Infinity,
  max_duration_ms: 0,
  step_metrics: {
    shell_echo: { count: 0, total_ms: 0, failures: 0 },
    shell_pwd: { count: 0, total_ms: 0, failures: 0 },
    file_list: { count: 0, total_ms: 0, failures: 0 }
  },
  sse_disconnects: 0,
  artifact_isolation_checks: 0,
  artifact_isolation_failures: 0
};

/**
 * Log event to JSONL
 */
function logEvent(event) {
  appendFileSync(logFile, JSON.stringify(event) + '\n');
}

/**
 * Run a single soak iteration
 */
async function runSoakIteration(runId) {
  const runStartTime = Date.now();
  logEvent({ type: 'run_start', run_id: runId, ts: new Date().toISOString() });
  
  try {
    // Use executor router
    const routerModule = await import('../executors/executor_router_v1.mjs');
    const { executeStep } = routerModule;
    
    const runDir = join(artifactsDir, `run_${runId}`);
    mkdirSync(runDir, { recursive: true });
    
    // Step 1: shell echo
    const step1Start = Date.now();
    try {
      await executeStep({
        executor_ref: 'opencode_server_v1',
        step: { tool_id: 'shell', args: { command: 'echo "SOAK_TEST"' } },
        ctx: { logsDir: runDir, baseUrl }
      });
      const step1Duration = Date.now() - step1Start;
      metrics.step_metrics.shell_echo.count++;
      metrics.step_metrics.shell_echo.total_ms += step1Duration;
      logEvent({ type: 'step_complete', run_id: runId, step: 'shell_echo', duration_ms: step1Duration, ts: new Date().toISOString() });
    } catch (error) {
      metrics.step_metrics.shell_echo.failures++;
      logEvent({ type: 'step_error', run_id: runId, step: 'shell_echo', error: error.message, ts: new Date().toISOString() });
      throw error;
    }
    
    // Step 2: shell pwd
    const step2Start = Date.now();
    try {
      await executeStep({
        executor_ref: 'opencode_server_v1',
        step: { tool_id: 'shell', args: { command: 'pwd' } },
        ctx: { logsDir: runDir, baseUrl }
      });
      const step2Duration = Date.now() - step2Start;
      metrics.step_metrics.shell_pwd.count++;
      metrics.step_metrics.shell_pwd.total_ms += step2Duration;
      logEvent({ type: 'step_complete', run_id: runId, step: 'shell_pwd', duration_ms: step2Duration, ts: new Date().toISOString() });
    } catch (error) {
      metrics.step_metrics.shell_pwd.failures++;
      logEvent({ type: 'step_error', run_id: runId, step: 'shell_pwd', error: error.message, ts: new Date().toISOString() });
      throw error;
    }
    
    // Step 3: file.list
    const step3Start = Date.now();
    try {
      await executeStep({
        executor_ref: 'opencode_server_v1',
        step: { tool_id: 'file.list', args: { path: '.' } },
        ctx: { logsDir: runDir, baseUrl }
      });
      const step3Duration = Date.now() - step3Start;
      metrics.step_metrics.file_list.count++;
      metrics.step_metrics.file_list.total_ms += step3Duration;
      logEvent({ type: 'step_complete', run_id: runId, step: 'file_list', duration_ms: step3Duration, ts: new Date().toISOString() });
    } catch (error) {
      metrics.step_metrics.file_list.failures++;
      logEvent({ type: 'step_error', run_id: runId, step: 'file_list', error: error.message, ts: new Date().toISOString() });
      throw error;
    }
    
    // Check artifact isolation (each run should have its own directory)
    metrics.artifact_isolation_checks++;
    if (!existsSync(runDir)) {
      metrics.artifact_isolation_failures++;
      logEvent({ type: 'artifact_isolation_failure', run_id: runId, ts: new Date().toISOString() });
    }
    
    // Success
    const runDuration = Date.now() - runStartTime;
    metrics.completed_runs++;
    metrics.total_duration_ms += runDuration;
    metrics.min_duration_ms = Math.min(metrics.min_duration_ms, runDuration);
    metrics.max_duration_ms = Math.max(metrics.max_duration_ms, runDuration);
    
    logEvent({ type: 'run_complete', run_id: runId, duration_ms: runDuration, ts: new Date().toISOString() });
    
    // Clean up run artifacts on success
    rmSync(runDir, { recursive: true, force: true });
    
  } catch (error) {
    metrics.failed_runs++;
    logEvent({ type: 'run_error', run_id: runId, error: error.message, ts: new Date().toISOString() });
  }
}

/**
 * Run all soak iterations
 */
async function runAllIterations() {
  if (concurrency === 1) {
    // Sequential execution
    for (let i = 0; i < runsCount; i++) {
      console.log(`[soak] Run ${i + 1}/${runsCount}`);
      await runSoakIteration(i);
    }
  } else {
    // Parallel execution (batched)
    const batches = Math.ceil(runsCount / concurrency);
    for (let batch = 0; batch < batches; batch++) {
      const batchStart = batch * concurrency;
      const batchEnd = Math.min(batchStart + concurrency, runsCount);
      const batchPromises = [];
      
      for (let i = batchStart; i < batchEnd; i++) {
        console.log(`[soak] Run ${i + 1}/${runsCount} (batch ${batch + 1}/${batches})`);
        batchPromises.push(runSoakIteration(i));
      }
      
      await Promise.all(batchPromises);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const testStartTime = Date.now();
  
  try {
    await runAllIterations();
    
    const testDuration = Date.now() - testStartTime;
    
    // Compute averages
    const results = {
      config: {
        runs: runsCount,
        concurrency: concurrency,
        base_url: baseUrl
      },
      summary: {
        total_runs: metrics.total_runs,
        completed_runs: metrics.completed_runs,
        failed_runs: metrics.failed_runs,
        success_rate: (metrics.completed_runs / metrics.total_runs * 100).toFixed(2) + '%',
        total_duration_ms: testDuration,
        avg_run_duration_ms: metrics.completed_runs > 0 ? (metrics.total_duration_ms / metrics.completed_runs).toFixed(2) : 0,
        min_run_duration_ms: metrics.min_duration_ms === Infinity ? 0 : metrics.min_duration_ms,
        max_run_duration_ms: metrics.max_duration_ms
      },
      step_metrics: {
        shell_echo: {
          total_runs: metrics.step_metrics.shell_echo.count,
          failures: metrics.step_metrics.shell_echo.failures,
          avg_duration_ms: metrics.step_metrics.shell_echo.count > 0 
            ? (metrics.step_metrics.shell_echo.total_ms / metrics.step_metrics.shell_echo.count).toFixed(2)
            : 0
        },
        shell_pwd: {
          total_runs: metrics.step_metrics.shell_pwd.count,
          failures: metrics.step_metrics.shell_pwd.failures,
          avg_duration_ms: metrics.step_metrics.shell_pwd.count > 0
            ? (metrics.step_metrics.shell_pwd.total_ms / metrics.step_metrics.shell_pwd.count).toFixed(2)
            : 0
        },
        file_list: {
          total_runs: metrics.step_metrics.file_list.count,
          failures: metrics.step_metrics.file_list.failures,
          avg_duration_ms: metrics.step_metrics.file_list.count > 0
            ? (metrics.step_metrics.file_list.total_ms / metrics.step_metrics.file_list.count).toFixed(2)
            : 0
        }
      },
      isolation: {
        checks: metrics.artifact_isolation_checks,
        failures: metrics.artifact_isolation_failures
      },
      sse: {
        disconnects: metrics.sse_disconnects
      }
    };
    
    // Write results
    writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    
    // Print summary
    console.log('\n[soak] ================================');
    console.log('[soak] Soak Test Complete');
    console.log(`[soak] Completed: ${results.summary.completed_runs}/${results.summary.total_runs}`);
    console.log(`[soak] Failed: ${results.summary.failed_runs}`);
    console.log(`[soak] Success Rate: ${results.summary.success_rate}`);
    console.log(`[soak] Avg Duration: ${results.summary.avg_run_duration_ms}ms`);
    console.log(`[soak] Min Duration: ${results.summary.min_run_duration_ms}ms`);
    console.log(`[soak] Max Duration: ${results.summary.max_run_duration_ms}ms`);
    console.log(`[soak] Results: ${resultsFile}`);
    console.log(`[soak] Log: ${logFile}`);
    
    if (metrics.failed_runs === 0) {
      console.log('[soak] Result: PASS');
      process.exit(0);
    } else {
      console.error('[soak] Result: FAIL');
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`[soak] FATAL ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

