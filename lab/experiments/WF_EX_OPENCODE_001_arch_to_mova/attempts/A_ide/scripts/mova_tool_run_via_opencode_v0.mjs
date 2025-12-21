#!/usr/bin/env node
/**
 * MOVA Tool Run Bridge via OpenCode
 * 
 * This script:
 * 1. Loads policy and performs policy check
 * 2. Delegates execution to driver_opencode_v1
 * 3. Saves artifacts and generates MOVA-compliant evidence
 * 4. Produces MOVA-compliant response envelope
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { executeStep } from '../../../../../../executors/executor_router_v1.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const eqArg = args.find(a => a.startsWith(`--${name}=`));
  if (eqArg) return eqArg.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx < args.length - 1) return args[idx + 1];
  return null;
}
const baseUrl = getArg('baseUrl') || 'http://127.0.0.1:4096';
const inFile = getArg('in');
const baseDir = dirname(inFile);
const policyFile = getArg('policy') || join(baseDir, 'mova_policy_profile_shell_allowlist_v0.json');
const outDirArg = getArg('outDir'); // New: explicit output directory for logs

if (!inFile) {
  console.error('Usage: node mova_tool_run_via_opencode_v0.mjs --baseUrl=http://127.0.0.1:4096 --in=request.json [--out=response.json] [--policy=policy.json] [--outDir=output_dir]');
  process.exit(1);
}

// Generate outFile if not provided
let outFile = getArg('out');
if (!outFile) {
  const inBase = inFile.replace(/\.json$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
  outFile = join(baseDir, '../outputs', `${inBase}_response.json`);
}

const request = JSON.parse(readFileSync(inFile, 'utf8'));

// Load policy profile
let policy = null;
try {
  policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  console.log(`[bridge] Loaded policy: ${policy.policy_id}`);
} catch (e) {
  console.error(`[bridge] Failed to load policy from ${policyFile}:`, e.message);
  process.exit(1);
}

console.log(`[bridge] Connecting to OpenCode at ${baseUrl}`);

// Use outDirArg if provided, otherwise derive from outFile
const workDir = outDirArg || dirname(outFile);
// All outputs go into workDir subdirectories
const outputsDir = join(workDir, 'outputs');
const logsDir = join(workDir, 'logs');
const artifactsDir = join(workDir, 'artifacts');

mkdirSync(outputsDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

// Helper: Get relative path for evidence refs
const getRelativePath = (fullPath) => {
  const normalized = fullPath.replace(/\\/g, '/');
  const match = normalized.match(/(inputs|outputs|logs)\/[^/]+$/);
  return match ? match[0] : normalized;
};

// Step 0: Policy check BEFORE any HTTP calls
console.log('[bridge] Step 0: Checking policy (before any HTTP calls)...');
const tool_id = request.tool_id || 'shell';

// Tool dispatcher: build command based on tool_id
let command = null;
let filePath = null;
let maxBytes = 4096;

if (tool_id === 'shell') {
  // Extract command from request.args.command or request.args, or use default
  command = 'echo MOVA_SMOKE'; // default
  if (request.args) {
    if (request.args.command) {
      command = request.args.command;
    } else if (typeof request.args === 'string') {
      command = request.args;
    }
  }
} else if (tool_id === 'file.read') {
  // file.read: build command with path and max_bytes
  if (!request.args || !request.args.path) {
    throw new Error('file.read requires args.path');
  }
  filePath = request.args.path;
  maxBytes = request.args.max_bytes || 4096;
  
  // Don't normalize path here - policy check will validate it
  // Command will be built after policy check if ALLOW
} else if (tool_id === 'file.list') {
  // file.list: build command with path
  if (!request.args || !request.args.path) {
    throw new Error('file.list requires args.path');
  }
  filePath = request.args.path;
  
  // Don't normalize path here - policy check will validate it
  // Command will be built after policy check if ALLOW
} else {
  throw new Error(`Unsupported tool_id: ${tool_id}`);
}

// Policy check (pass path for file tools)
const policyResult = policyCheck({ tool_id, command, path: filePath, policy });

console.log(`[bridge] Policy decision: ${policyResult.decision} (${policyResult.reason})`);

// Executor reference (using router)
const executorRef = 'opencode_server_v1';

// Policy check function (supports command_regex for shell, path_prefixes for file tools)
function policyCheck({ tool_id, command, path, policy }) {
  // Default decision
  let decision = policy.default_decision || 'deny';
  let rule_id = null;
  let reason = 'default_deny';
  
  // For file tools: check for forbidden paths first
  if ((tool_id === 'file.read' || tool_id === 'file.list') && path) {
    // Deny absolute paths
    if (path.startsWith('/')) {
      return { decision: 'deny', rule_id: null, reason: 'absolute_path_denied' };
    }
    // Deny parent directory references
    if (path.includes('..')) {
      return { decision: 'deny', rule_id: null, reason: 'parent_directory_denied' };
    }
    // Deny null bytes
    if (path.includes('\0')) {
      return { decision: 'deny', rule_id: null, reason: 'null_byte_denied' };
    }
  }
  
  // Check rules in order
  for (const rule of policy.rules || []) {
    // Check tool_id match
    if (rule.tool_id && rule.tool_id !== tool_id) {
      continue;
    }
    
    // For shell tools: check command_regex
    if (tool_id === 'shell' && rule.command_regex) {
      const regex = new RegExp(rule.command_regex);
      if (regex.test(command)) {
        decision = rule.decision;
        rule_id = rule.rule_id;
        reason = `matched_rule:${rule.rule_id}`;
        break;
      }
    }
    
    // For file tools: check path_prefixes
    if ((tool_id === 'file.read' || tool_id === 'file.list') && rule.path_prefixes) {
      if (path) {
        for (const prefix of rule.path_prefixes) {
          // Normalize both path and prefix for comparison
          const normalizedPath = path.replace(/^\.\//, '').replace(/\/+/g, '/');
          const normalizedPrefix = prefix.replace(/^\.\//, '').replace(/\/+/g, '/');
          if (normalizedPath.startsWith(normalizedPrefix)) {
            decision = rule.decision;
            rule_id = rule.rule_id;
            reason = `matched_rule:${rule.rule_id}`;
            break;
          }
        }
        if (rule_id) break;
      }
    }
  }
  
  return { decision, rule_id, reason };
}

try {
  // Write policy check response
  const policyCheckResponse = {
    envelope_id: 'env.policy_check_response_v0',
    decision: policyResult.decision,
    rule_id: policyResult.rule_id,
    reason: policyResult.reason,
    meta: { ts: new Date().toISOString() }
  };
    writeFileSync(
      join(outputsDir, 'mova_env_policy_check_response.json'),
      JSON.stringify(policyCheckResponse, null, 2)
    );
  
  // Prepare evidence refs for security episode (for DENY: only existing files)
  const evidenceRefs = [getRelativePath(policyFile), getRelativePath(inFile)];
  
  if (policyResult.decision === 'deny') {
    console.log('[bridge] Policy DENY: No HTTP calls will be made');
    
    // For DENY: no SSE, no SSE log - only add outputs that will be created
    evidenceRefs.push(
      `outputs/mova_env_policy_check_response.json`,
      `outputs/mova_security_episode.json`,
      `outputs/mova_env_tool_run_response.json`
    );
    
    // Write security episode for DENY
    const targets = { tool_id };
    if (command) targets.command = command;
    if (filePath) targets.path = filePath;
    
    const securityEpisode = {
      episode_id: 'episode.security_policy_gate.v0',
      ts: new Date().toISOString(),
      action: 'env.tool_run_request',
      decision: 'deny',
      policy_ref: policy.policy_id,
      policy_version: policy.policy_version || 'unversioned',
      targets: targets,
      evidence_refs: evidenceRefs
    };
    writeFileSync(
      join(outputsDir, 'mova_security_episode.json'),
      JSON.stringify(securityEpisode, null, 2)
    );
    
    // Write tool run response with denied status and governance fields
    const movaResponse = {
      envelope_id: 'env.tool_run_response_v1.example',
      tool_id: tool_id,
      result: {
        exit_code: null,
        stdout_ref: null,
        stderr_ref: null,
        denied: true,
        reason: policyResult.reason
      },
      evidence_refs: evidenceRefs,
      meta: {
        ts: new Date().toISOString(),
        denied: true,
        policy_decision: 'deny',
        policy_ref: policy.policy_id,
        policy_version: policy.policy_version || 'unversioned',
        policy_rule_id: policyResult.rule_id,
        engine_ref: 'opencode@local'  // Legacy path - engine_ref not available in DENY case
      }
    };
    if (command) movaResponse.meta.command = command;
    if (filePath) movaResponse.meta.path = filePath;
    
    writeFileSync(
      join(outputsDir, 'mova_env_tool_run_response.json'),
      JSON.stringify(movaResponse, null, 2)
    );
    
    // HTTP trace should be empty for DENY (no HTTP calls made)
    // Don't create SSE log for DENY
    writeFileSync(
      join(logsDir, 'opencode_http_trace.jsonl'),
      '' // Empty file
    );
    
    console.log('[bridge] Policy DENY: Execution aborted (no HTTP calls made)');
    console.log(`[bridge] Policy response: ${join(outputsDir, 'mova_env_policy_check_response.json')}`);
    console.log(`[bridge] Security episode: ${join(outputsDir, 'mova_security_episode.json')}`);
    console.log(`[bridge] Tool run response: ${join(outputsDir, 'mova_env_tool_run_response.json')}`);
    
    // Exit with code 0 (normal policy denial, not runtime error)
    process.exit(0);
  }
  
  // For ALLOW: add SSE and HTTP trace to evidence refs
  evidenceRefs.push(
    `logs/opencode_sse_events.log`,
    `logs/opencode_http_trace.jsonl`
  );
  
  // Policy ALLOW: continue with execution (make HTTP calls)
  console.log('[bridge] Policy ALLOW: Proceeding with execution via driver');
  
  // Prepare step for driver
  const step = {
    tool_id,
    args: tool_id === 'shell' ? { command } : request.args
  };
  
  // Execute via executor router v0
  console.log(`[bridge] Executing via executor router v0 (${executorRef})...`);
  const routerRequest = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    tool_id: step.tool_id,
    args: step.args,
    ctx: {
      run_id: `run_${Date.now()}`,
      step_id: `step_${Date.now()}`,
      policy_ref: policy.policy_id
    }
  };
  const routerResult = await runTool({
    executor_ref: executorRef,
    request: routerRequest,
    options: { logsDir, baseUrl }
  });
  
  // Extract normalized result
  const { exit_code: exitCode, stdout, stderr } = routerResult.tool_result || {};
  const engineRef = routerResult.engine_ref;
  const toolIds = null; // Not available in contract v0
  
  console.log('[bridge] Driver execution complete');
  console.log(`[bridge] Exit code: ${exitCode}`);
  
  // Save tool list if available
  if (toolIds) {
    writeFileSync(
      join(outputsDir, 'opencode_tool_list.json'),
      JSON.stringify(toolIds, null, 2)
    );
  }
  
  // Evidence is collected by router and available in routerResult.evidence_refs
  // No need to call driver methods directly
  
  // Step 5: Save stdout/stderr to artifacts
  // artifactsDir already created at the top
  
  let stdoutRef = null;
  let stderrRef = null;
  
  // Generate artifact filenames based on tool_id
  const artifactBase = tool_id.replace(/\./g, '_');
  const timestamp = Date.now();
  
  if (stdout) {
    const stdoutFile = `${artifactBase}_stdout_${timestamp}.txt`;
    const stdoutPath = join(artifactsDir, stdoutFile);
    writeFileSync(stdoutPath, stdout);
    stdoutRef = `artifacts/${stdoutFile}`;
  }
  
  if (stderr) {
    const stderrFile = `${artifactBase}_stderr_${timestamp}.txt`;
    const stderrPath = join(artifactsDir, stderrFile);
    writeFileSync(stderrPath, stderr);
    stderrRef = `artifacts/${stderrFile}`;
  }
  
  // Step 6: Write security episode for ALLOW case
  const allowEvidenceRefs = [...evidenceRefs];
  if (toolIds) {
    allowEvidenceRefs.push(getRelativePath(join(outputsDir, 'opencode_tool_list.json')));
  }
  allowEvidenceRefs.push(getRelativePath(join(outputsDir, 'mova_env_tool_run_response.json')));
  if (stdoutRef) allowEvidenceRefs.push(stdoutRef);
  
  const targets = { tool_id };
  if (command) targets.command = command;
  if (filePath) targets.path = filePath;
  
  const securityEpisode = {
    episode_id: 'episode.security_policy_gate.v0',
    ts: new Date().toISOString(),
    action: 'env.tool_run_request',
    decision: 'allow',
    policy_ref: policy.policy_id,
    policy_version: policy.policy_version || 'unversioned',
    targets: targets,
    evidence_refs: allowEvidenceRefs
  };
  writeFileSync(
    join(outputsDir, 'mova_security_episode.json'),
    JSON.stringify(securityEpisode, null, 2)
  );
  
  // Step 7: Build MOVA response with governance fields
  const movaResponse = {
    envelope_id: 'env.tool_run_response_v1.example',
    tool_id: tool_id,
    result: {
      exit_code: exitCode,
      stdout_ref: stdoutRef,
      stderr_ref: stderrRef,
    },
    evidence_refs: [
      'tmp/external/opencode/packages/opencode/src/server/server.ts',
      'tmp/external/opencode/packages/opencode/src/tool/registry.ts',
      ...evidenceRefs
    ],
    meta: {
      ts: new Date().toISOString(),
      policy_decision: 'allow',
      policy_ref: policy.policy_id,
      policy_version: policy.policy_version || 'unversioned',
      policy_rule_id: policyResult.rule_id,
      engine_ref: engineRef || 'opencode@local'
    }
  };
  if (command) movaResponse.meta.command = command;
  if (filePath) movaResponse.meta.path = filePath;
  
  // Save outputs with fixed names
  writeFileSync(
    join(outputsDir, 'mova_env_tool_run_response.json'),
    JSON.stringify(movaResponse, null, 2)
  );
  // HTTP trace is already saved by router via evidence_refs
  // No need to write it again here
  
  console.log('[bridge] Complete!');
  console.log(`[bridge] Response: ${join(outputsDir, 'mova_env_tool_run_response.json')}`);
  if (stdoutRef) console.log(`[bridge] Stdout: ${stdoutRef}`);
  if (stderrRef) console.log(`[bridge] Stderr: ${stderrRef}`);
  console.log(`[bridge] Evidence refs: ${routerResult.evidence_refs?.length || 0} files`);
  console.log(`[bridge] Engine ref: ${engineRef || 'unknown'}`);
  console.log(`[bridge] Exit code: ${exitCode}`);
  
  // Exit with success (orchestrator checks response file for actual status)
  process.exit(0);
  
} catch (error) {
  console.error('[bridge] Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
