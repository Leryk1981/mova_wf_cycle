#!/usr/bin/env node
/**
 * Executor Router v1
 * 
 * Routes tool execution requests to appropriate executor drivers.
 * Provides unified interface for all executors, hiding executor-specific details.
 * 
 * @module executor_router_v1
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Router configuration: maps executor_ref to driver module path
 * Paths are relative to executors/ directory
 */
const EXECUTOR_DRIVERS = {
  'opencode_server_v1': './opencode_server_v1/driver/driver_opencode_v1.mjs',
  'cloudflare_worker_v1': './cloudflare_worker_v1/driver/driver_cloudflare_worker_v1.mjs',
};

/**
 * Execute a step via the specified executor
 * 
 * @param {Object} params
 * @param {string} params.executor_ref - Executor identifier (e.g., 'opencode_server_v1')
 * @param {Object} params.step - Step to execute
 * @param {string} params.step.tool_id - Tool identifier
 * @param {Object} params.step.args - Tool arguments
 * @param {Object} params.ctx - Execution context
 * @param {string} params.ctx.logsDir - Directory for evidence logs
 * @param {string} [params.ctx.baseUrl] - Executor base URL (if applicable)
 * @returns {Promise<Object>} Normalized result with tool_result, evidence_refs, engine_ref, session_ref
 */
export async function executeStep({ executor_ref, step, ctx = {} }) {
  // Validate executor_ref
  if (!executor_ref || !EXECUTOR_DRIVERS[executor_ref]) {
    throw new Error(`Unknown executor_ref: ${executor_ref}. Available: ${Object.keys(EXECUTOR_DRIVERS).join(', ')}`);
  }
  
  // Load driver module (convert to file:// URL for ESM import)
  const driverPath = join(__dirname, EXECUTOR_DRIVERS[executor_ref]);
  const driverUrl = pathToFileURL(driverPath).href;
  let driverModule;
  try {
    driverModule = await import(driverUrl);
  } catch (error) {
    throw new Error(`Failed to load driver for ${executor_ref}: ${error.message}`);
  }
  
  // Create driver instance
  if (typeof driverModule.createDriver !== 'function') {
    throw new Error(`Driver for ${executor_ref} does not export createDriver function`);
  }
  
  const driverOptions = {
    baseUrl: ctx.baseUrl || process.env.MOVA_OPENCODE_BASE_URL || 'http://127.0.0.1:4096',
    ...ctx
  };
  
  const driver = driverModule.createDriver(driverOptions);
  
  // Execute step
  const logsDir = ctx.logsDir || join(process.cwd(), '.tmp', 'executor', executor_ref);
  
  let stepResult;
  try {
    stepResult = await driver.runStep(step, { logsDir });
  } catch (error) {
    throw new Error(`Executor ${executor_ref} execution failed: ${error.message}`);
  }
  
  // Ensure logs directory exists
  mkdirSync(logsDir, { recursive: true });
  
  // Collect evidence
  const evidenceRefs = [];
  
  // Add evidence_refs from step result
  if (stepResult.evidence_refs && Array.isArray(stepResult.evidence_refs)) {
    evidenceRefs.push(...stepResult.evidence_refs);
  }
  
  // Add HTTP trace if available
  if (typeof driver.getHttpTrace === 'function') {
    const httpTrace = driver.getHttpTrace();
    if (httpTrace && httpTrace.length > 0) {
      const httpTraceFile = join(logsDir, 'http_trace.jsonl');
      writeFileSync(httpTraceFile, httpTrace.map(t => JSON.stringify(t)).join('\n'), 'utf8');
      evidenceRefs.push(httpTraceFile);
    }
  }
  
  // Add SSE events if available
  if (typeof driver.getSseEvents === 'function') {
    const sseEvents = driver.getSseEvents();
    if (sseEvents && sseEvents.length > 0) {
      const sseLogFile = join(logsDir, 'sse_events.log');
      writeFileSync(sseLogFile, sseEvents.map(e => JSON.stringify(e)).join('\n'), 'utf8');
      evidenceRefs.push(sseLogFile);
    }
  }
  
  // Build normalized response
  return {
    tool_result: stepResult.result || {
      exit_code: 1,
      stdout: '',
      stderr: `Executor ${executor_ref} returned invalid result`
    },
    evidence_refs: evidenceRefs,
    engine_ref: stepResult.engine_ref || executor_ref,
    session_ref: stepResult.session_id || null,
    executor_ref: executor_ref,
    // Preserve additional fields from step result
    ...stepResult
  };
}

/**
 * Get list of available executor references
 */
export function getAvailableExecutors() {
  return Object.keys(EXECUTOR_DRIVERS);
}

