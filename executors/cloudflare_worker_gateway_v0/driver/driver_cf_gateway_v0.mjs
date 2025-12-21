#!/usr/bin/env node
/**
 * Cloudflare Worker Gateway Driver v0
 * 
 * Node.js client driver for the Cloudflare Worker Tool Gateway executor.
 * Implements EXECUTOR_DRIVER_CONTRACT_v0.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create a Cloudflare Gateway driver instance
 * 
 * @param {object} options - Driver options
 * @param {string} options.baseUrl - Gateway base URL (default: http://localhost:8787)
 * @param {string} options.authToken - Bearer token for authentication (from env or options)
 * @param {string} [options.env] - Environment name (for .dev.vars.<env> loading)
 * @returns {GatewayDriver} Driver instance
 */
export function createDriver(options = {}) {
  const baseUrl = options.baseUrl || process.env.GATEWAY_URL || 'http://localhost:8787';
  const authToken = options.authToken || process.env.GATEWAY_AUTH_TOKEN;
  
  if (!authToken) {
    throw new Error('GATEWAY_AUTH_TOKEN required (set via options.authToken or GATEWAY_AUTH_TOKEN env var)');
  }
  
  return new GatewayDriver({ baseUrl, authToken });
}

/**
 * Gateway Driver implementation
 */
class GatewayDriver {
  constructor({ baseUrl, authToken }) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = authToken;
    this.httpTrace = [];
  }
  
  /**
   * Run a tool through the gateway
   * 
   * @param {object} request - Tool request
   * @param {string} request.request_id - Request identifier
   * @param {string} request.tool_id - Tool identifier
   * @param {object} request.args - Tool arguments
   * @param {object} [request.ctx] - Execution context
   * @param {object} [options] - Driver options
   * @param {string} [options.logsDir] - Directory for evidence logs
   * @returns {Promise<object>} Normalized response per contract
   */
  async runTool(request, options = {}) {
    const { request_id, tool_id, args, ctx = {} } = request;
    const logsDir = options.logsDir || join(process.cwd(), '.tmp', 'cf_gateway_driver');
    
    // Prepare request body
    const requestBody = {
      request_id,
      tool_id,
      args,
      ctx: {
        run_id: ctx.run_id || `run_${Date.now()}`,
        step_id: ctx.step_id || `step_${Date.now()}`,
        policy_ref: ctx.policy_ref || 'policy.default'
      }
    };
    
    // Make HTTP request
    const url = `${this.baseUrl}/tool/run`;
    const timestamp = new Date().toISOString();
    
    let response;
    let responseData;
    
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify(requestBody)
      });
      
      responseData = await response.json();
    } catch (error) {
      // Network/connection error - throw
      this.httpTrace.push({
        method: 'POST',
        url,
        request_body: requestBody,
        error: error.message,
        timestamp
      });
      throw new Error(`Gateway request failed: ${error.message}`);
    }
    
    // Record HTTP trace
    this.httpTrace.push({
      method: 'POST',
      url,
      request_body: requestBody,
      response_status: response.status,
      response_body: responseData,
      timestamp
    });
    
    // Write local evidence (http trace)
    mkdirSync(logsDir, { recursive: true });
    const httpTraceFile = join(logsDir, `http_trace_${request_id}.jsonl`);
    writeFileSync(httpTraceFile, JSON.stringify(this.httpTrace[this.httpTrace.length - 1]) + '\n');
    
    // Get relative path from repo root
    const repoRoot = process.cwd();
    const httpTraceRelative = httpTraceFile.startsWith(repoRoot)
      ? httpTraceFile.substring(repoRoot.length + 1).replace(/\\/g, '/')
      : httpTraceFile.replace(/\\/g, '/');
    
    // Normalize response to contract format
    const normalized = {
      ok: responseData.ok === true,
      tool_result: responseData.tool_result || undefined,
      policy_check: responseData.policy_check || {
        decision: responseData.ok ? 'allow' : 'deny',
        reason: responseData.error || 'Unknown'
      },
      evidence_refs: responseData.evidence_refs || [], // Remote refs only (R2 keys)
      local_evidence_paths: [httpTraceRelative], // Local files only
      engine_ref: responseData.engine_ref || 'cloudflare_worker_gateway_v0@unknown',
      run_id: responseData.run_id || ctx.run_id,
      step_id: responseData.step_id || ctx.step_id
    };
    
    return normalized;
  }
  
  /**
   * Get HTTP trace for evidence
   * 
   * @returns {Array<object>} HTTP request/response trace
   */
  getHttpTrace() {
    return [...this.httpTrace];
  }
  
  /**
   * Clear HTTP trace (for reuse)
   */
  clearHttpTrace() {
    this.httpTrace = [];
  }
}

