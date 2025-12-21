#!/usr/bin/env node
/**
 * OpenCode Engine Identity v1
 * 
 * Extracts and prints Docker image identity for provenance tracking.
 * Reads OPENCODE_IMAGE from .env and performs docker image inspect.
 * 
 * Usage:
 *   node tools/opencode_engine_identity_v1.mjs [--env-file PATH]
 * 
 * Output:
 *   .tmp/opencode_engine_identity/identity.json
 * 
 * Exit codes:
 *   0: Success
 *   1: Error (image not found, docker not available, etc.)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
let envFilePath = join(projectRoot, 'executors/opencode_server_v1/docker/.env');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--env-file' && args[i + 1]) {
    envFilePath = args[i + 1];
    i++;
  }
}

/**
 * Parse .env file into key-value pairs
 */
function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    console.error(`[identity] ERROR: .env file not found: ${filePath}`);
    return null;
  }

  const env = {};
  const content = readFileSync(filePath, 'utf8');
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    env[key] = value;
  }
  
  return env;
}

/**
 * Execute docker command and return stdout
 */
function dockerExec(args) {
  try {
    const result = execSync(`docker ${args}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (error) {
    console.error(`[identity] Docker command failed: docker ${args}`);
    console.error(`[identity] Error: ${error.message}`);
    return null;
  }
}

/**
 * Get image identity via docker inspect
 */
function getImageIdentity(imageRef) {
  console.log(`[identity] Inspecting image: ${imageRef}`);
  
  const inspectJson = dockerExec(`image inspect ${imageRef}`);
  if (!inspectJson) {
    console.error('[identity] Failed to inspect image');
    return null;
  }
  
  let inspectData;
  try {
    inspectData = JSON.parse(inspectJson);
    if (!Array.isArray(inspectData) || inspectData.length === 0) {
      console.error('[identity] Unexpected inspect output format');
      return null;
    }
  } catch (error) {
    console.error(`[identity] Failed to parse inspect JSON: ${error.message}`);
    return null;
  }
  
  const img = inspectData[0];
  
  return {
    image_ref: imageRef,
    repo_tags: img.RepoTags || [],
    repo_digests: img.RepoDigests || [],
    id: img.Id || null,
    created: img.Created || null,
    size: img.Size || 0,
    architecture: img.Architecture || null,
    os: img.Os || null,
    config: {
      entrypoint: img.Config?.Entrypoint || [],
      cmd: img.Config?.Cmd || [],
      exposed_ports: img.Config?.ExposedPorts ? Object.keys(img.Config.ExposedPorts) : [],
      env: img.Config?.Env || [],
      working_dir: img.Config?.WorkingDir || null,
      labels: img.Config?.Labels || {},
    },
    metadata: {
      author: img.Author || null,
      comment: img.Comment || null,
    },
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('[identity] OpenCode Engine Identity v1');
  console.log(`[identity] Env file: ${envFilePath}`);
  
  // Parse .env
  const env = parseEnvFile(envFilePath);
  if (!env) {
    process.exit(1);
  }
  
  const imageRef = env.OPENCODE_IMAGE;
  if (!imageRef) {
    console.error('[identity] ERROR: OPENCODE_IMAGE not found in .env');
    process.exit(1);
  }
  
  // Get identity
  const identity = getImageIdentity(imageRef);
  if (!identity) {
    process.exit(1);
  }
  
  // Prepare output
  const outputDir = join(projectRoot, '.tmp/opencode_engine_identity');
  mkdirSync(outputDir, { recursive: true });
  
  const outputFile = join(outputDir, 'identity.json');
  const output = {
    timestamp: new Date().toISOString(),
    identity,
  };
  
  writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
  
  // Print summary
  console.log('[identity] ================================');
  console.log(`[identity] Image: ${identity.image_ref}`);
  console.log(`[identity] ID: ${identity.id?.substring(0, 19)}...`);
  console.log(`[identity] Tags: ${identity.repo_tags.join(', ') || 'none'}`);
  console.log(`[identity] Digests: ${identity.repo_digests.join(', ') || 'none'}`);
  console.log(`[identity] Created: ${identity.created}`);
  console.log(`[identity] Size: ${(identity.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[identity] Arch/OS: ${identity.architecture}/${identity.os}`);
  console.log(`[identity] Entrypoint: ${JSON.stringify(identity.config.entrypoint)}`);
  console.log(`[identity] Cmd: ${JSON.stringify(identity.config.cmd)}`);
  console.log(`[identity] Ports: ${identity.config.exposed_ports.join(', ') || 'none'}`);
  console.log('[identity] ================================');
  console.log(`[identity] Identity saved: ${outputFile}`);
  console.log('[identity] Result: PASS');
  
  process.exit(0);
}

main().catch((error) => {
  console.error(`[identity] FATAL ERROR: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});

