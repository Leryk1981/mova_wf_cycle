#!/usr/bin/env node
/**
 * OpenCode Driver v1
 * 
 * Single vendor boundary for OpenCode executor integration.
 * Handles all OpenCode-specific protocol details:
 * - SSE /event connection and event stream processing
 * - Session creation and management
 * - Tool execution via /session/:id/shell
 * - Response normalization to MOVA tool_result + evidence_refs
 * 
 * External dependencies: fetch API (Node 18+)
 * 
 * @module driver_opencode_v1
 */

import { createWriteStream, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * OpenCode Driver - Single interface to OpenCode executor
 */
export class OpencodeDriver {
  constructor({ baseUrl = 'http://127.0.0.1:4096' } = {}) {
    this.baseUrl = baseUrl;
    this.httpTrace = [];
    this.sseEvents = [];
  }

  /**
   * Execute a tool through OpenCode (EXECUTOR_DRIVER_CONTRACT_v0)
   * @param {Object} request - Tool request per contract
   * @param {string} request.request_id - Request identifier
   * @param {string} request.tool_id - Tool identifier
   * @param {Object} request.args - Tool arguments
   * @param {Object} [request.ctx] - Execution context
   * @param {Object} [options] - Driver options
   * @param {string} [options.logsDir] - Directory for evidence logs
   * @returns {Promise<Object>} Normalized response per contract
   */
  async runTool(request, options = {}) {
    const { request_id, tool_id, args, ctx = {} } = request;
    const logsDir = options.logsDir || join(process.cwd(), '.tmp', 'opencode_driver');
    
    // Convert contract format to internal step format
    const step = { tool_id, args };
    
    // Execute using existing runStep logic
    const stepResult = await this.runStep(step, { logsDir });
    
    // Normalize to contract format
    const normalized = {
      ok: stepResult.result.exit_code === 0,
      tool_result: stepResult.result,
      policy_check: {
        decision: 'allow', // OpenCode doesn't have policy checks, always allow
        reason: 'OpenCode executor (no policy enforcement)',
        rule_id: 'opencode_always_allow'
      },
      evidence_refs: [], // OpenCode has no remote storage, so empty
      local_evidence_paths: [],
      engine_ref: `opencode_server_v1@${this.baseUrl}`,
      run_id: ctx.run_id,
      step_id: ctx.step_id
    };
    
    // Collect local evidence paths (not remote refs)
    if (logsDir) {
      const repoRoot = process.cwd();
      
      const sseLogFile = join(logsDir, 'opencode_sse_events.log');
      if (this.sseEvents.length > 0) {
        const sseRelative = sseLogFile.startsWith(repoRoot)
          ? sseLogFile.substring(repoRoot.length + 1).replace(/\\/g, '/')
          : sseLogFile.replace(/\\/g, '/');
        normalized.local_evidence_paths.push(sseRelative);
      }
      
      if (this.httpTrace.length > 0) {
        const httpTraceFile = join(logsDir, 'http_trace.jsonl');
        mkdirSync(dirname(httpTraceFile), { recursive: true });
        writeFileSync(httpTraceFile, this.httpTrace.map(t => JSON.stringify(t)).join('\n'));
        const httpTraceRelative = httpTraceFile.startsWith(repoRoot)
          ? httpTraceFile.substring(repoRoot.length + 1).replace(/\\/g, '/')
          : httpTraceFile.replace(/\\/g, '/');
        normalized.local_evidence_paths.push(httpTraceRelative);
      }
    }
    
    // Ensure evidence_refs is never empty (use placeholder if no remote storage)
    if (normalized.evidence_refs.length === 0) {
      normalized.evidence_refs.push('opencode_local_execution'); // Placeholder for contract compliance
    }
    
    return normalized;
  }

  /**
   * Execute a single step through OpenCode (legacy method, kept for compatibility)
   * @param {Object} step - Step to execute
   * @param {string} step.tool_id - Tool identifier (shell, file.read, file.list)
   * @param {Object} step.args - Tool arguments
   * @param {Object} options - Execution options
   * @param {string} options.logsDir - Directory for logs
   * @returns {Promise<Object>} Normalized tool result
   */
  async runStep(step, { logsDir }) {
    const { tool_id, args } = step;
    
    // Build command based on tool_id
    const command = this._buildCommand(tool_id, args);
    
    // Reset traces for this execution
    this.httpTrace = [];
    this.sseEvents = [];
    
    // Step 1: Connect to SSE and wait for server.connected
    const sseLog = createWriteStream(`${logsDir}/opencode_sse_events.log`);
    const serverConnectedEvent = await this._connectSSE(sseLog);
    
    if (!serverConnectedEvent) {
      throw new Error('SSE connection failed: server.connected event not received');
    }
    
    // Step 2: Get tool list (optional - for evidence only)
    let toolIds = null;
    try {
      const { body } = await this._httpRequest('GET', '/experimental/tool/ids');
      toolIds = body;
    } catch (e) {
      console.warn('[driver] tool_list_unavailable:', e.message);
    }
    
    // Step 3: Create session
    const sessionId = await this._createSession();
    
    // Step 4: Execute command
    const shellResponse = await this._executeShell(sessionId, command);
    
    // Step 5: Extract and normalize result
    const result = this._normalizeResult(shellResponse);
    
    // Close SSE connection
    sseLog.end();
    
    return {
      tool_id,
      result,
      session_id: sessionId,
      server_connected_event: serverConnectedEvent,
      sse_events_count: this.sseEvents.length,
      http_trace_count: this.httpTrace.length,
      tool_ids: toolIds
    };
  }

  /**
   * Get HTTP trace for evidence
   */
  getHttpTrace() {
    return this.httpTrace;
  }

  /**
   * Get SSE events for evidence
   */
  getSseEvents() {
    return this.sseEvents;
  }

  /**
   * Build command from tool_id and args
   * @private
   */
  _buildCommand(tool_id, args) {
    if (tool_id === 'shell') {
      return args.command || args || 'echo MOVA_SMOKE';
    }
    
    if (tool_id === 'file.read') {
      if (!args.path) {
        throw new Error('file.read requires args.path');
      }
      const normalizedPath = this._normalizePath(args.path);
      const maxBytes = args.max_bytes || 4096;
      
      if (maxBytes > 0) {
        return `head -c ${maxBytes} -- '${normalizedPath}'`;
      }
      return `cat -- '${normalizedPath}'`;
    }
    
    if (tool_id === 'file.list') {
      if (!args.path) {
        throw new Error('file.list requires args.path');
      }
      const normalizedPath = this._normalizePath(args.path);
      return `ls -la -- '${normalizedPath}'`;
    }
    
    throw new Error(`Unsupported tool_id: ${tool_id}`);
  }

  /**
   * Normalize file path (security: forbid absolute paths, .., null bytes)
   * @private
   */
  _normalizePath(path) {
    if (!path || typeof path !== 'string') {
      throw new Error('Path must be a non-empty string');
    }
    
    if (path.includes('\0')) {
      throw new Error('Path contains null byte');
    }
    
    if (path.startsWith('/')) {
      throw new Error('Absolute paths are not allowed');
    }
    
    if (path.includes('..')) {
      throw new Error('Parent directory references (..) are not allowed');
    }
    
    let normalized = path.replace(/^\.\//, '').replace(/\/+/g, '/');
    
    if (!normalized.startsWith('/')) {
      normalized = `/work/${normalized}`;
    }
    
    return normalized;
  }

  /**
   * Connect to SSE /event endpoint and wait for server.connected
   * @private
   */
  async _connectSSE(sseLog) {
    const response = await fetch(`${this.baseUrl}/event`);
    
    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let serverConnectedEvent = null;
    
    // Read until server.connected (with timeout)
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('SSE timeout')), 5000)
    );
    
    const readEvents = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          sseLog.write(line + '\n');
          
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.substring(6));
              const eventWithTs = {
                ts: new Date().toISOString(),
                ...event
              };
              this.sseEvents.push(eventWithTs);
              
              if (event.type === 'server.connected') {
                serverConnectedEvent = eventWithTs;
                return serverConnectedEvent;
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }
    })();
    
    return Promise.race([readEvents, timeout]);
  }

  /**
   * Make HTTP request and trace it
   * @private
   */
  async _httpRequest(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const startTime = Date.now();
    const response = await fetch(url, options);
    const endTime = Date.now();
    
    const trace = {
      ts: new Date().toISOString(),
      method,
      path,
      status: response.status,
      duration_ms: endTime - startTime,
      request_body: body,
    };
    
    let responseBody = null;
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      responseBody = await response.json();
      trace.response_body = responseBody;
    } else {
      const text = await response.text();
      trace.response_text = text.substring(0, 500);
    }
    
    this.httpTrace.push(trace);
    return { response, body: responseBody };
  }

  /**
   * Create OpenCode session
   * @private
   */
  async _createSession() {
    const { body: session } = await this._httpRequest('POST', '/session', {
      agent: 'general',
    });
    
    const sessionId = session?.id || session?.sessionID;
    
    if (!sessionId) {
      throw new Error('Failed to create session, no session ID returned');
    }
    
    return sessionId;
  }

  /**
   * Execute shell command via /session/:id/shell
   * @private
   */
  async _executeShell(sessionId, command) {
    const { body: shellResponse } = await this._httpRequest(
      'POST',
      `/session/${sessionId}/shell`,
      {
        command: command,
        agent: 'general',
      }
    );
    
    return shellResponse;
  }

  /**
   * Normalize OpenCode shell response to MOVA tool_result
   * @private
   */
  _normalizeResult(shellResponse) {
    let exitCode = 0;
    let stdout = null;
    let stderr = null;
    
    if (shellResponse?.info) {
      const parts = shellResponse.parts || [];
      const toolParts = parts.filter(p => p.type === 'tool');
      
      for (const toolPart of toolParts) {
        if (toolPart.state?.output) {
          stdout = toolPart.state.output;
        }
        
        if (toolPart.state?.status === 'completed') {
          exitCode = 0;
        } else if (toolPart.state?.status === 'error') {
          exitCode = 1;
          stderr = toolPart.state.error || 'Command failed';
        }
      }
      
      if (!stdout) {
        const textParts = parts.filter(p => p.type === 'text')
          .map(p => p.text || p.content)
          .join('');
        stdout = textParts || JSON.stringify(shellResponse);
      }
    } else if (shellResponse?.output) {
      stdout = shellResponse.output;
    } else {
      stdout = JSON.stringify(shellResponse);
    }
    
    return {
      exit_code: exitCode,
      stdout,
      stderr
    };
  }
}

/**
 * Factory: create driver instance
 */
export function createDriver(options = {}) {
  return new OpencodeDriver(options);
}

