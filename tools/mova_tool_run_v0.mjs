#!/usr/bin/env node
/**
 * MOVA Tool Run v0
 * 
 * Generic tool execution script that routes to executors via executor_router_v0.
 * 
 * Usage:
 *   node tools/mova_tool_run_v0.mjs --executor_ref=opencode_server_v1 --tool_id=shell --args='{"command":"echo hello"}'
 *   node tools/mova_tool_run_v0.mjs --executor_ref=cloudflare_worker_gateway_v0 --tool_id=kv.get --args='{"key":"test"}'
 */

import { runTool, getAvailableExecutors } from '../executors/executor_router_v0.mjs';
import { join, dirname } from 'path';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = {};
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const [key, ...valueParts] = arg.substring(2).split('=');
      const value = valueParts.join('=');
      
      // If value is provided in same arg (--key=value)
      if (value) {
        if (key === 'args' || key === 'args_file') {
          try {
            args[key] = key === 'args' ? JSON.parse(value) : value;
          } catch (e) {
            args[key] = value;
          }
        } else {
          args[key] = value;
        }
      } else {
        // Check if next arg is a value (not starting with --)
        if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
          args[key] = process.argv[i + 1];
          i++; // Skip next arg as it's the value
        } else {
          // Boolean flag
          args[key] = true;
        }
      }
    }
  }
  return args;
}

/**
 * Main execution
 */
async function main() {
  const args = parseArgs();
  
  // Show help if requested
  if (args.help || args.h || (!args.executor_ref && !args.tool_id)) {
    console.log('Usage: node tools/mova_tool_run_v0.mjs [options]');
    console.log('');
    console.log('Required:');
    console.log('  --executor_ref <ref>     Executor identifier (e.g., opencode_server_v1, cloudflare_worker_gateway_v0)');
    console.log('  --tool_id <tool>         Tool identifier (e.g., shell, kv.get, http.fetch)');
    console.log('');
    console.log('Optional:');
    console.log('  --base_url <url>         Executor base URL (default: from env or localhost)');
    console.log('  --request_id <id>        Request identifier (default: auto-generated)');
    console.log('  --args <json>            Tool arguments as JSON string');
    console.log('  --args_file <path>       Tool arguments from JSON file');
    console.log('  --run_id <id>            Run identifier');
    console.log('  --step_id <id>           Step identifier');
    console.log('  --policy_ref <ref>       Policy reference (default: policy.default)');
    console.log('  --logs_dir <path>        Directory for evidence logs');
    console.log('  --auth_token <token>     Auth token (or use CF_GATEWAY_AUTH_TOKEN/GATEWAY_AUTH_TOKEN env)');
    console.log('  --explain                Enable explain mode (fetch episode + artifacts)');
    console.log('  --explain_limit N        Max episodes to search (default: 5, max: 20)');
    console.log('  --explain_fetch_refs <list>  Comma-separated artifact refs to fetch (optional)');
    console.log('  --output <format>        Output format: json|text (default: text)');
    console.log('');
    console.log('Environment variables:');
    console.log('  CF_GATEWAY_AUTH_TOKEN    Auth token for Cloudflare Gateway (preferred)');
    console.log('  GATEWAY_AUTH_TOKEN       Auth token (fallback)');
    console.log('  GATEWAY_URL              Gateway base URL');
    console.log('  MOVA_OPENCODE_BASE_URL   OpenCode base URL');
    console.log('');
    console.log(`Available executors: ${getAvailableExecutors().join(', ')}`);
    process.exit(0);
  }
  
  // Validate required arguments
  if (!args.executor_ref) {
    console.error('[error] --executor_ref required');
    console.error(`[error] Available executors: ${getAvailableExecutors().join(', ')}`);
    console.error('[error] Run with --help for usage information');
    process.exit(1);
  }
  
  if (!args.tool_id) {
    console.error('[error] --tool_id required');
    console.error('[error] Run with --help for usage information');
    process.exit(1);
  }
  
  // Parse args (support JSON string or file)
  let toolArgs = {};
  if (args.args) {
    if (typeof args.args === 'string') {
      try {
        toolArgs = JSON.parse(args.args);
      } catch (e) {
        console.error('[tool_run] ERROR: --args must be valid JSON');
        process.exit(1);
      }
    } else {
      toolArgs = args.args;
    }
  } else if (args.args_file) {
    const { readFileSync } = await import('fs');
    try {
      toolArgs = JSON.parse(readFileSync(args.args_file, 'utf8'));
    } catch (e) {
      console.error(`[tool_run] ERROR: Failed to read --args_file: ${e.message}`);
      process.exit(1);
    }
  }
  
  // Build request
  const request = {
    request_id: args.request_id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    tool_id: args.tool_id,
    args: toolArgs,
    ctx: {
      run_id: args.run_id,
      step_id: args.step_id,
      policy_ref: args.policy_ref || 'policy.default'
    }
  };
  
  // Prepare options
  const options = {
    logsDir: args.logs_dir || join(process.cwd(), '.tmp', 'mova_tool_run', args.executor_ref),
    baseUrl: args.base_url || process.env.MOVA_OPENCODE_BASE_URL || process.env.GATEWAY_URL,
    authToken: args.auth_token || process.env.CF_GATEWAY_AUTH_TOKEN || process.env.GATEWAY_AUTH_TOKEN
  };
  
  // Parse explain options
  const explainMode = args.explain === true;
  const explainLimit = Math.min(Math.max(parseInt(args.explain_limit || '5', 10), 1), 20);
  const explainFetchRefs = args.explain_fetch_refs ? args.explain_fetch_refs.split(',').map(r => r.trim()) : null;
  const outputFormat = args.output || 'text';
  
  // Execute
  try {
    if (outputFormat === 'text') {
      console.log(`[tool_run] Executing ${args.tool_id} via ${args.executor_ref}...`);
    }
    const result = await runTool({
      executor_ref: args.executor_ref,
      request,
      options
    });
    
    // Output result
    if (outputFormat === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Text output
      if (result.ok) {
        console.log(`[tool_run] ✅ Tool execution succeeded`);
        if (result.tool_result) {
          console.log(`[tool_run]   Exit code: ${result.tool_result.exit_code}`);
          if (result.tool_result.stdout) {
            console.log(`[tool_run]   Stdout: ${result.tool_result.stdout.substring(0, 200)}${result.tool_result.stdout.length > 200 ? '...' : ''}`);
          }
        }
      } else {
        console.log(`[tool_run] ❌ Tool execution failed or denied`);
      }
      if (result.policy_check) {
        console.log(`[tool_run]   Decision: ${result.policy_check.decision}`);
        console.log(`[tool_run]   Reason: ${result.policy_check.reason}`);
        if (result.policy_check.rule_id) {
          console.log(`[tool_run]   Rule ID: ${result.policy_check.rule_id}`);
        }
      }
      if (result.engine_ref) {
        console.log(`[tool_run]   Engine: ${result.engine_ref}`);
      }
      if (result.evidence_refs && result.evidence_refs.length > 0) {
        console.log(`[tool_run]   Evidence refs (remote): ${result.evidence_refs.length}`);
      }
      if (result.local_evidence_paths && result.local_evidence_paths.length > 0) {
        console.log(`[tool_run]   Local evidence paths: ${result.local_evidence_paths.length}`);
        for (const path of result.local_evidence_paths) {
          console.log(`[tool_run]     ${path}`);
        }
      }
    }
    
    // Explain mode (only for Cloudflare gateway)
    if (explainMode && args.executor_ref === 'cloudflare_worker_gateway_v0' && options.baseUrl) {
      await explainResult(result, request.request_id, options.baseUrl, options.authToken, explainLimit, explainFetchRefs, outputFormat);
    }
    
    // Exit code based on result
    if (result.ok) {
      process.exit(0);
    } else {
      if (outputFormat === 'text') {
        console.error(`[tool_run] Tool execution failed or denied: ${result.policy_check?.reason || 'Unknown error'}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(`[tool_run] ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Explain mode: fetch episode and artifacts from Cloudflare gateway
 */
async function explainResult(result, requestId, baseUrl, authToken, limit, explicitFetchRefs, outputFormat) {
  if (!authToken) {
    console.log('[explain] ⚠️  Auth token required for explain mode');
    return;
  }
  
  try {
    // Search for episode
    const searchBody = {
      limit,
      order: 'desc'
    };
    
    // Try exact ID match first
    if (requestId) {
      searchBody.id = requestId;
    } else {
      // Fallback to prefix search
      const prefix = requestId ? requestId.split('_')[0] : 'req';
      searchBody.id_prefix = prefix;
    }
    
    const searchResponse = await fetch(`${baseUrl}/episode/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(searchBody)
    });
    
    if (!searchResponse.ok) {
      console.log(`[explain] ⚠️  Episode search failed: ${searchResponse.status}`);
      return;
    }
    
    const searchData = await searchResponse.json();
    if (!searchData.ok || !Array.isArray(searchData.results) || searchData.results.length === 0) {
      console.log(`[explain] ⚠️  No episodes found`);
      return;
    }
    
    // Find matching episode (exact ID match or first result)
    let episode = searchData.results.find(ep => ep.id === requestId);
    if (!episode) {
      episode = searchData.results[0];
    }
    
    if (outputFormat === 'text') {
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📋 EXPLAIN MODE');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      console.log('Decision Summary:');
      console.log(`  Decision: ${result.policy_check?.decision || 'unknown'}`);
      console.log(`  Reason: ${result.policy_check?.reason || 'N/A'}`);
      if (result.policy_check?.rule_id) {
        console.log(`  Rule ID: ${result.policy_check.rule_id}`);
      }
      console.log('');
      
      // Tool Execution Status
      if (result.policy_check?.decision === 'deny') {
        console.log('Tool Execution Status: SKIPPED_BY_POLICY');
      } else if (result.policy_check?.decision === 'allow' && result.tool_result) {
        if (result.tool_result.exit_code !== 0) {
          console.log('Tool Execution Status: TOOL_FAILURE (policy allowed, tool returned non-zero exit_code)');
        } else {
          console.log('Tool Execution Status: SUCCESS');
        }
      }
      console.log('');
      console.log('Episode Summary:');
      console.log(`  ID: ${episode.id}`);
      console.log(`  Timestamp: ${new Date(episode.ts).toISOString()}`);
      console.log(`  Type: ${episode.type}`);
      console.log(`  Engine: ${episode.engine_ref}`);
      if (episode.run_id) {
        console.log(`  Run ID: ${episode.run_id}`);
      }
      if (episode.step_id) {
        console.log(`  Step ID: ${episode.step_id}`);
      }
      console.log(`  Policy: ${episode.policy_ref} (${episode.policy_version})`);
      console.log('');
    }
    
    // Determine which artifacts to fetch
    let artifactRefs = [];
    if (explicitFetchRefs && explicitFetchRefs.length > 0) {
      artifactRefs = explicitFetchRefs;
    } else {
      // Default artifacts based on decision
      if (episode.evidence_refs && Array.isArray(episode.evidence_refs)) {
        // Always fetch engine_identity.json
        const identityRef = episode.evidence_refs.find(ref => ref.includes('engine_identity.json'));
        if (identityRef) artifactRefs.push(identityRef);
        
        if (result.policy_check?.decision === 'deny') {
          const decisionRef = episode.evidence_refs.find(ref => ref.includes('policy_decision.json'));
          const requestRef = episode.evidence_refs.find(ref => ref.includes('request.json'));
          if (decisionRef) artifactRefs.push(decisionRef);
          if (requestRef) artifactRefs.push(requestRef);
        } else if (result.policy_check?.decision === 'allow') {
          const toolResultRef = episode.evidence_refs.find(ref => ref.includes('tool_result.json'));
          const requestRef = episode.evidence_refs.find(ref => ref.includes('request.json'));
          if (toolResultRef) artifactRefs.push(toolResultRef);
          if (requestRef) artifactRefs.push(requestRef);
        }
      }
    }
    
    // Fetch artifacts
    const explainDir = join(process.cwd(), '.tmp', 'mova_tool_run_explain', requestId);
    mkdirSync(explainDir, { recursive: true });
    
    const fetchedFiles = [];
    
    for (const ref of artifactRefs) {
      try {
        const artifactUrl = new URL(`${baseUrl}/artifact/get`);
        artifactUrl.searchParams.set('ref', ref);
        
        const artifactResponse = await fetch(artifactUrl.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        if (artifactResponse.ok) {
          const artifactBody = await artifactResponse.arrayBuffer();
          const artifactData = Buffer.from(artifactBody);
          
          // Sanitize filename
          const filename = ref.split('/').pop() || 'artifact.json';
          const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          const filePath = join(explainDir, safeFilename);
          
          writeFileSync(filePath, artifactData);
          fetchedFiles.push({ ref, path: filePath });
          
          // Print summary for JSON artifacts
          if (outputFormat === 'text' && (filename.endsWith('.json') || filename.endsWith('.jsonl'))) {
            try {
              const jsonContent = JSON.parse(artifactData.toString('utf8'));
              if (filename.includes('engine_identity')) {
                console.log(`  Engine Identity: ${jsonContent.gateway_version || 'N/A'}`);
                if (jsonContent.cf_metadata) {
                  console.log(`    CF Colo: ${jsonContent.cf_metadata.colo || 'unknown'}`);
                  console.log(`    CF Country: ${jsonContent.cf_metadata.country || 'unknown'}`);
                }
              } else if (filename.includes('policy_decision')) {
                console.log(`  Policy Decision: ${jsonContent.decision || 'N/A'}`);
                console.log(`    Reason: ${jsonContent.reason || 'N/A'}`);
              } else if (filename.includes('tool_result')) {
                console.log(`  Tool Result: exit_code=${jsonContent.exit_code || 'N/A'}`);
                if (jsonContent.data) {
                  console.log(`    Data: ${JSON.stringify(jsonContent.data).substring(0, 100)}...`);
                }
              }
            } catch (e) {
              // Not JSON or parse error, skip
            }
          }
        } else if (artifactResponse.status === 404) {
          // Artifact not found, skip silently
        } else {
          console.log(`[explain] ⚠️  Failed to fetch artifact ${ref}: ${artifactResponse.status}`);
        }
      } catch (error) {
        console.log(`[explain] ⚠️  Error fetching artifact ${ref}: ${error.message}`);
      }
    }
    
    if (outputFormat === 'text') {
      console.log('');
      console.log('Evidence Summary:');
      console.log(`  Total evidence refs: ${episode.evidence_refs?.length || 0}`);
      console.log(`  Fetched artifacts: ${fetchedFiles.length}`);
      for (const file of fetchedFiles) {
        console.log(`    ${file.ref} → ${file.path}`);
      }
      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
    }
  } catch (error) {
    console.log(`[explain] ⚠️  Explain mode error: ${error.message}`);
  }
}

main().catch((error) => {
  console.error('[tool_run] FATAL ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
});

