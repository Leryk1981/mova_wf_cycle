#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// Generate demo pack if needed
const demoPackPath = 'artifacts/domain_pack_scaffold/demo_pack_v0';
if (!existsSync(demoPackPath)) {
  console.log('Generating demo scaffold pack...');
  execSync('node packs/domain_pack_scaffold_v0/tools/demo_domain_pack_scaffold_v0.mjs', { stdio: 'inherit' });
}

// Run quality check on demo pack
const envPath = 'packs/domain_pack_quality_v0/ds/env.domain_pack_quality_request_v0.json';
execSync(`node packs/domain_pack_quality_v0/tools/domain_pack_quality_v0.mjs ${envPath}`, { stdio: 'inherit' });

console.log('Demo completed successfully');