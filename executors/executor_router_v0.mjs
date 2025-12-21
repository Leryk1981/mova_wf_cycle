#!/usr/bin/env node
/**
 * Executor Router v0
 * 
 * Routes tool execution requests to appropriate executor drivers.
 * Implements EXECUTOR_DRIVER_CONTRACT_v0 interface.
 * 
 * @module executor_router_v0
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Router configuration: maps executor_ref to driver module path
 * Paths are relative to executors/ directory
 */
const EXECUTOR_DRIVERS = {
  'opencode_server_v1': './opencode_server_v1/driver/driver_opencode_v1.mjs',
  'cloudflare_worker_gateway_v0': './cloudflare_worker_gateway_v0/driver/driver_cf_gateway_v0.mjs',
  'local_shell_v0': './local_shell_v0/driver/driver_local_shell_v0.mjs',
};

/**
 * Execute a tool via the specified executor (EXECUTOR_DRIVER_CONTRACT_v0)
 * 
 * @param {Object} params
 * @param {string} params.executor_ref - Executor identifier (e.g., 'opencode_server_v1', 'cloudflare_worker_gateway_v0')
 * @param {Object} params.request - Tool request per contract
 * @param {string} params.request.request_id - Request identifier
 * @param {string} params.request.tool_id - Tool identifier
 * @param {Object} params.request.args - Tool arguments
 * @param {Object} [params.request.ctx] - Execution context
 * @param {Object} [params.options] - Router options
 * @param {string} [params.options.logsDir] - Directory for evidence logs
 * @param {string} [params.options.baseUrl] - Executor base URL (if applicable)
 * @param {string} [params.options.authToken] - Auth token (if applicable)
 * @returns {Promise<Object>} Normalized response per EXECUTOR_DRIVER_CONTRACT_v0
 */
export async function runTool({ executor_ref, request, options = {} }) {
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
  
  // Prepare driver options
  const driverOptions = {};
  if (options.baseUrl) {
    driverOptions.baseUrl = options.baseUrl;
  }
  if (options.authToken) {
    driverOptions.authToken = options.authToken;
  }
  
  const driver = driverModule.createDriver(driverOptions);
  
  // Prepare execution options
  const executionOptions = {
    logsDir: options.logsDir || join(process.cwd(), '.tmp', 'executor', executor_ref)
  };
  
  // Execute tool via driver
  let result;
  try {
    result = await driver.runTool(request, executionOptions);
  } catch (error) {
    throw new Error(`Executor ${executor_ref} execution failed: ${error.message}`);
  }
  
  // Validate result conforms to contract
  if (!result.hasOwnProperty('ok') || !result.policy_check || !Array.isArray(result.evidence_refs)) {
    throw new Error(`Executor ${executor_ref} returned invalid result format (must conform to EXECUTOR_DRIVER_CONTRACT_v0)`);
  }
  
  // Validate local_evidence_paths if present
  if (result.local_evidence_paths !== undefined) {
    if (!Array.isArray(result.local_evidence_paths)) {
      throw new Error(`Executor ${executor_ref} returned invalid local_evidence_paths (must be array)`);
    }
    // Ensure paths are relative (no absolute paths, no parent directory references)
    for (const path of result.local_evidence_paths) {
      if (typeof path !== 'string' || path.startsWith('/') || path.includes('..')) {
        throw new Error(`Executor ${executor_ref} returned invalid local_evidence_path: ${path}`);
      }
    }
  }
  
  return result;
}

/**
 * Get list of available executor references
 * 
 * @returns {string[]} Array of executor_ref identifiers
 */
export function getAvailableExecutors() {
  return Object.keys(EXECUTOR_DRIVERS);
}
