#!/usr/bin/env node
/**
 * Validator: Planner Plan No-Exec Guarantee
 * 
 * Validates that a planner plan contains NO execution results:
 * - No stdout, stderr, exit_code, output, artifacts, tool_result, session_id
 * - Only allowed tools: file.read, file.list
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

const inFile = getArg('in');

if (!inFile) {
  console.error('Usage: node validate_planner_plan_no_exec_v0.mjs --in=plan.json');
  process.exit(1);
}

// Forbidden keys that indicate execution results
const FORBIDDEN_KEYS = [
  'stdout',
  'stderr',
  'exit_code',
  'output',
  'artifacts',
  'tool_result',
  'session_id'
];

// Allowed tools for planner
const ALLOWED_TOOLS = ['file.read', 'file.list'];

// Recursively check for forbidden keys
function checkForbiddenKeys(obj, path = '') {
  const errors = [];
  
  if (typeof obj !== 'object' || obj === null) {
    return errors;
  }
  
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      errors.push(...checkForbiddenKeys(obj[i], `${path}[${i}]`));
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      // Check if key is forbidden
      if (FORBIDDEN_KEYS.includes(key)) {
        errors.push(`FORBIDDEN key found: ${currentPath} (indicates execution result)`);
      }
      
      // Recursively check nested objects
      if (typeof value === 'object' && value !== null) {
        errors.push(...checkForbiddenKeys(value, currentPath));
      }
    }
  }
  
  return errors;
}

// Check tool_id constraints
function checkToolIds(plan) {
  const errors = [];
  
  if (!plan.plan || !Array.isArray(plan.plan)) {
    return errors;
  }
  
  for (const step of plan.plan) {
    if (step.args && step.args.tool_id) {
      const toolId = step.args.tool_id;
      if (!ALLOWED_TOOLS.includes(toolId)) {
        errors.push(`FORBIDDEN tool_id: ${toolId} (only ${ALLOWED_TOOLS.join(', ')} allowed)`);
      }
    }
  }
  
  return errors;
}

try {
  const plan = JSON.parse(readFileSync(inFile, 'utf8'));
  
  console.log(`[validator] Validating plan: ${plan.envelope_id || 'unknown'}`);
  
  const errors = [];
  
  // Check for forbidden keys
  const forbiddenErrors = checkForbiddenKeys(plan);
  errors.push(...forbiddenErrors);
  
  // Check tool_id constraints
  const toolErrors = checkToolIds(plan);
  errors.push(...toolErrors);
  
  if (errors.length > 0) {
    console.error('[validator] FAIL');
    console.error(`[validator] Found ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`  ❌ ${error}`);
    }
    process.exit(1);
  }
  
  console.log('[validator] PASS');
  console.log('[validator] No execution results found');
  console.log('[validator] All tool_ids are allowed');
  process.exit(0);
  
} catch (e) {
  console.error('[validator] Error:', e.message);
  process.exit(1);
}

