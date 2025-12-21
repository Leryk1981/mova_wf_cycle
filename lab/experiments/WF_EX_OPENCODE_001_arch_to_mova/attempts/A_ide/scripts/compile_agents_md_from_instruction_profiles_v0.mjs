#!/usr/bin/env node
/**
 * Compiler: Instruction Profiles → AGENTS.md facade
 * 
 * Takes instruction_profile_*.json files and generates a human-readable
 * AGENTS.md document that preserves the same rules but in structured format.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

const baseDir = getArg('base') || join(__dirname, '..');
const profilesDir = join(baseDir, 'inputs');
const outputDir = join(baseDir, 'outputs', 'compiled');
const outputFile = join(outputDir, 'AGENTS.md');

// Ensure output directory exists
mkdirSync(outputDir, { recursive: true });

// Find all instruction profile files
const allFiles = readdirSync(profilesDir);
const profileFiles = allFiles.filter(f => f.startsWith('instruction_profile_') && f.endsWith('.json'));

if (profileFiles.length === 0) {
  console.error(`No instruction profile files found in ${profilesDir}`);
  process.exit(1);
}

console.log(`[compiler] Found ${profileFiles.length} instruction profile(s)`);

// Load and parse profiles
const profiles = [];
for (const file of profileFiles) {
  const filePath = join(profilesDir, file);
  try {
    const content = JSON.parse(readFileSync(filePath, 'utf8'));
    profiles.push(content);
    console.log(`[compiler] Loaded ${content.profile_id}`);
  } catch (e) {
    console.error(`[compiler] Failed to load ${file}:`, e.message);
  }
}

// Generate AGENTS.md
let md = `# MOVA Agents (Compiled from Instruction Profiles)

> **Source of Truth:** This document is generated from \`instruction_profile_*.json\` files.
> To modify agent behavior, edit the instruction profiles and re-run the compiler.

**Generated:** ${new Date().toISOString()}
**Profiles:** ${profiles.map(p => p.profile_id).join(', ')}

---

`;

// Generate section for each profile
for (const profile of profiles) {
  md += `## ${profile.role.toUpperCase()}: ${profile.profile_id}\n\n`;
  md += `${profile.description}\n\n`;
  
  // Inputs
  if (profile.inputs) {
    md += `### Inputs\n\n`;
    md += `- **Format:** \`${profile.inputs.format}\`\n`;
    if (profile.inputs.description) {
      md += `- **Description:** ${profile.inputs.description}\n`;
    }
    md += `\n`;
  }
  
  // Outputs
  if (profile.outputs) {
    md += `### Outputs\n\n`;
    md += `- **Format:** \`${profile.outputs.format}\`\n`;
    if (profile.outputs.description) {
      md += `- **Description:** ${profile.outputs.description}\n`;
    }
    if (profile.outputs.required_fields) {
      md += `- **Required Fields:**\n`;
      for (const field of profile.outputs.required_fields) {
        md += `  - \`${field}\`\n`;
      }
    }
    md += `\n`;
  }
  
  // Forbidden
  if (profile.forbidden && profile.forbidden.length > 0) {
    md += `### Forbidden\n\n`;
    for (const item of profile.forbidden) {
      md += `- ❌ ${item}\n`;
    }
    md += `\n`;
  }
  
  // Rules
  if (profile.rules && profile.rules.length > 0) {
    md += `### Rules\n\n`;
    for (const rule of profile.rules) {
      md += `- ✅ ${rule}\n`;
    }
    md += `\n`;
  }
  
  // Evidence Requirements
  if (profile.evidence_requirements && profile.evidence_requirements.length > 0) {
    md += `### Evidence Requirements\n\n`;
    for (const req of profile.evidence_requirements) {
      md += `- 📋 ${req}\n`;
    }
    md += `\n`;
  }
  
  // Execution Flow (if present)
  if (profile.execution_flow && profile.execution_flow.length > 0) {
    md += `### Execution Flow\n\n`;
    for (const step of profile.execution_flow) {
      md += `${step}\n`;
    }
    md += `\n`;
  }
  
  md += `---\n\n`;
}

// Write output
writeFileSync(outputFile, md, 'utf8');
console.log(`[compiler] Generated: ${outputFile}`);
console.log(`[compiler] Complete!`);

