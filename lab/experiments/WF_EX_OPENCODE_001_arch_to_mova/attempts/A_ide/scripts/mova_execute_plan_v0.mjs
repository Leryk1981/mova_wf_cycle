#!/usr/bin/env node
/**
 * Orchestrator: Execute Planner Plan via Adapter
 * 
 * Takes a planner plan (env.planner_plan_v0) and executes each step
 * deterministically through the adapter (mova_tool_run_via_opencode_v0.mjs).
 * Collects results, artifacts, and generates a run report.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { promisify } from 'util';

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
const policyFile = getArg('policy');
const planFile = getArg('plan');
const outDir = getArg('outDir');

if (!policyFile || !planFile || !outDir) {
  console.error('Usage: node mova_execute_plan_v0.mjs --baseUrl=http://127.0.0.1:4096 --policy=policy.json --plan=plan.json --outDir=output_dir');
  process.exit(1);
}

// Ensure output directories exist
mkdirSync(outDir, { recursive: true });
const stepsDir = join(outDir, 'steps');
mkdirSync(stepsDir, { recursive: true });

// Step 1: Validate plan (no-exec guarantee)
console.log('[orchestrator] Step 1: Validating plan (no-exec guarantee)...');
const validatorScript = join(__dirname, 'validate_planner_plan_no_exec_v0.mjs');

const validatePlan = () => {
  return new Promise((resolve, reject) => {
    const validator = spawn('node', [validatorScript, '--in', planFile], {
      stdio: 'inherit'
    });
    
    validator.on('close', (code) => {
      if (code === 0) {
        console.log('[orchestrator] Plan validation: PASS');
        resolve();
      } else {
        console.error('[orchestrator] Plan validation: FAIL');
        reject(new Error(`Plan validation failed with code ${code}`));
      }
    });
    
    validator.on('error', (err) => {
      reject(err);
    });
  });
};

// Step 2: Load plan and policy
console.log('[orchestrator] Step 2: Loading plan and policy...');
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const policy = JSON.parse(readFileSync(policyFile, 'utf8'));

if (!plan.plan || !Array.isArray(plan.plan)) {
  console.error('[orchestrator] Invalid plan: missing plan array');
  process.exit(1);
}

console.log(`[orchestrator] Plan contains ${plan.plan.length} step(s)`);
console.log(`[orchestrator] Policy: ${policy.policy_id} v${policy.policy_version || 'unversioned'}`);

// Step 3: Execute each step via adapter
console.log('[orchestrator] Step 3: Executing plan steps...');

const stepResults = [];

async function executeStep(step, stepIndex) {
  console.log(`[orchestrator] Executing step ${step.step_id} (${stepIndex + 1}/${plan.plan.length})...`);
  
  // Create isolated directory for this step
  const stepDir = join(stepsDir, `${stepIndex}_${step.step_id}`);
  const stepInputsDir = join(stepDir, 'inputs');
  const stepOutputsDir = join(stepDir, 'outputs');
  const stepLogsDir = join(stepDir, 'logs');
  const stepArtifactsDir = join(stepDir, 'artifacts');
  
  mkdirSync(stepInputsDir, { recursive: true });
  mkdirSync(stepOutputsDir, { recursive: true });
  mkdirSync(stepLogsDir, { recursive: true });
  mkdirSync(stepArtifactsDir, { recursive: true });
  
  // Generate tool_run_request file in step inputs
  const requestFile = join(stepInputsDir, 'request.json');
  
  // Build tool_run_request from plan step
  const toolRequest = {
    envelope_id: 'env.tool_run_request_v1.example',
    tool_id: step.args.tool_id,
    args: { ...step.args }
  };
  // Remove tool_id from args if present
  if (toolRequest.args.tool_id) {
    delete toolRequest.args.tool_id;
  }
  
  writeFileSync(requestFile, JSON.stringify(toolRequest, null, 2));
  
  // Execute via adapter with stepDir as outDir
  const adapterScript = join(__dirname, 'mova_tool_run_via_opencode_v0.mjs');
  
  return new Promise((resolve, reject) => {
    // Pass stepDir as outDir to adapter - all files will be created inside stepDir
    const adapter = spawn('node', [
      adapterScript,
      '--baseUrl', baseUrl,
      '--policy', policyFile,
      '--in', requestFile,
      '--outDir', stepDir  // Pass stepDir to adapter for complete isolation
    ], {
      stdio: 'inherit'
    });
    
    adapter.on('close', (code) => {
      if (code === 0) {
        // Adapter creates files with fixed names in stepOutputsDir
        const responseFile = join(stepOutputsDir, 'mova_env_tool_run_response.json');
        
        if (!existsSync(responseFile)) {
          console.error(`[orchestrator] Could not find response file for step ${step.step_id}`);
          stepResults.push({
            step_id: step.step_id,
            op: step.op,
            status: 'FAIL',
            error: 'Response file not found'
          });
          resolve();
          return;
        }
        
        const fullResponseFile = responseFile;
        
        // Read response to extract artifact refs
        let response = null;
        let artifacts = [];
        
        try {
          response = JSON.parse(readFileSync(fullResponseFile, 'utf8'));
          
          // Extract artifact references
          if (response.result?.stdout_ref) {
            artifacts.push({
              type: 'stdout',
              ref: response.result.stdout_ref
            });
          }
          if (response.result?.stderr_ref) {
            artifacts.push({
              type: 'stderr',
              ref: response.result.stderr_ref
            });
          }
          
          // Check for denied status
          const status = response.result?.denied ? 'DENY' : 'PASS';
          
          // Policy check and security episode files are in stepOutputsDir with fixed names
          const policyCheckFile = join(stepOutputsDir, 'mova_env_policy_check_response.json');
          const episodeFile = join(stepOutputsDir, 'mova_security_episode.json');
          
          // Calculate relative paths from exec_v0 root
          const stepRelPath = `steps/${stepIndex}_${step.step_id}`;
          
          stepResults.push({
            step_id: step.step_id,
            op: step.op,
            status: status,
            exit_code: response.result?.exit_code,
            denied: response.result?.denied || false,
            artifacts: artifacts,
            response_ref: `${stepRelPath}/outputs/mova_env_tool_run_response.json`,
            policy_check_ref: existsSync(policyCheckFile) ? `${stepRelPath}/outputs/mova_env_policy_check_response.json` : null,
            security_episode_ref: existsSync(episodeFile) ? `${stepRelPath}/outputs/mova_security_episode.json` : null
          });
          
          console.log(`[orchestrator] Step ${step.step_id}: ${status}`);
          resolve();
        } catch (e) {
          console.error(`[orchestrator] Failed to parse response for step ${step.step_id}:`, e.message);
          stepResults.push({
            step_id: step.step_id,
            op: step.op,
            status: 'FAIL',
            error: e.message
          });
          resolve(); // Continue with next step
        }
      } else {
        console.error(`[orchestrator] Step ${step.step_id} failed with code ${code}`);
        stepResults.push({
          step_id: step.step_id,
          op: step.op,
          status: 'FAIL',
          exit_code: code
        });
        resolve(); // Continue with next step even on failure
      }
    });
    
    adapter.on('error', (err) => {
      console.error(`[orchestrator] Error executing step ${step.step_id}:`, err.message);
      stepResults.push({
        step_id: step.step_id,
        op: step.op,
        status: 'FAIL',
        error: err.message
      });
      resolve(); // Continue with next step
    });
  });
}

// Execute all steps sequentially
async function executeAllSteps() {
  for (let i = 0; i < plan.plan.length; i++) {
    console.log(`[orchestrator] Starting step ${i + 1}/${plan.plan.length}: ${plan.plan[i].step_id}`);
    await executeStep(plan.plan[i], i);
    console.log(`[orchestrator] Completed step ${i + 1}/${plan.plan.length}: ${plan.plan[i].step_id}`);
  }
  console.log(`[orchestrator] All ${plan.plan.length} steps completed`);
}

// Main execution
try {
  // Validate plan first
  await validatePlan();
  
  // Execute all steps
  await executeAllSteps();
  
  // Step 4: Generate run report with governance fields
  console.log('[orchestrator] Step 4: Generating run report with governance fields...');
  
  // Generate deterministic run_id from plan and timestamp
  const runId = `run_${plan.plan_id || 'default'}_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  
  const report = {
    envelope_id: 'env.orchestrator_run_report_v0',
    run_id: runId,
    plan_ref: planFile.replace(/\\/g, '/').replace(/^.*\/(outputs|inputs)\//, '$1/'),
    policy_ref: policy.policy_id,
    policy_version: policy.policy_version || 'unversioned',
    instruction_profile_ref: plan.instruction_profile_ref || 'executor_default_v0',
    engine_ref: `opencode@local`, // TODO: extract from engine image digest
    steps: stepResults,
    summary: {
      total_steps: stepResults.length,
      passed: stepResults.filter(s => s.status === 'PASS').length,
      denied: stepResults.filter(s => s.status === 'DENY').length,
      failed: stepResults.filter(s => s.status === 'FAIL').length
    },
    artifacts: stepResults.flatMap(s => s.artifacts || []),
    meta: {
      ts: new Date().toISOString(),
      baseUrl: baseUrl,
      policy_file: policyFile.replace(/\\/g, '/').replace(/^.*\/(inputs|outputs)\//, '$1/')
    }
  };
  
  const reportFile = join(outDir, 'env.orchestrator_run_report_v0.json');
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  
  console.log('[orchestrator] Complete!');
  console.log(`[orchestrator] Report: ${reportFile}`);
  console.log(`[orchestrator] Summary: ${report.summary.passed} passed, ${report.summary.denied} denied, ${report.summary.failed} failed`);
  
  // Exit with code 1 if any step failed
  if (report.summary.failed > 0) {
    process.exit(1);
  }
  
} catch (error) {
  console.error('[orchestrator] Error:', error.message);
  process.exit(1);
}

