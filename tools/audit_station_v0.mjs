import { promises as fs } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import { loadStationRegistry, getExecutorPolicy } from './station_registry_helpers_v0.mjs';

// Helper to write JSON files with pretty print
async function writeJson(filePath, data) {
  await fs.mkdir(join(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Helper to write markdown report
async function writeReport(filePath, content) {
  await fs.mkdir(join(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, content);
}

// Generate a simple run_id
function generateRunId() {
  return crypto.randomBytes(8).toString('hex');
}

async function main() {
  const runId = generateRunId();
  const baseDir = join('artifacts', 'audit_station', runId);
  await fs.mkdir(baseDir, { recursive: true });
  const stationRegistry = loadStationRegistry(process.cwd());
  const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));

  // ==== PACK INVENTORY ====
  const packDirExcludes = new Set(['artifacts', '.tmp', 'node_modules', 'dist']);
  const allowedPackIds = new Set(stationRegistry.station_core.allowed_pack_ids || []);
  const packInventory = [];
  const seenPackKeys = new Set();

  async function buildPackInventory(packPath, packId, zone) {
    const readmePath = join(packPath, 'README.md');
    let hasReadme = false;
    try {
      await fs.access(readmePath);
      hasReadme = true;
    } catch (_) { }
    const files = await fs.readdir(packPath);
    const inventoryItem = {
      pack_id: packId,
      location: packPath.replace(/\\/g, '/'),
      zone,
      has_readme: hasReadme,
      has_quality_pos: files.some(f => f.startsWith('quality') && !f.includes('neg')),
      has_quality_neg: files.some(f => f.includes('neg')),
      has_proof_kit: files.some(f => f.startsWith('PROOF_KIT')),
      // simplistic heuristic for status
      recommended_status: allowedPackIds.has(packId) ? 'golden' : 'prototype'
    };
    return inventoryItem;
  }

  async function scanPackDir(rootDir, zone) {
    let entries = [];
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const name = dirent.name;
      if (name.startsWith('.')) continue;
      if (packDirExcludes.has(name)) continue;
      if (zone === 'golden' && name === '_quarantine') continue;
      const packPath = join(rootDir, name);
      const key = `${zone}:${packPath}`;
      if (seenPackKeys.has(key)) continue;
      seenPackKeys.add(key);
      packInventory.push(await buildPackInventory(packPath, name, zone));
    }
  }

  const goldenDir = stationRegistry.station_core.golden_dir || 'packs';
  const quarantineDir = stationRegistry.station_core.quarantine_dir || 'packs/_quarantine';
  await scanPackDir(goldenDir, 'golden');
  await scanPackDir(quarantineDir, 'quarantine');
  await writeJson(join(baseDir, 'pack_inventory.json'), packInventory);

  // ==== SKILL INVENTORY ====
  async function collectSkills(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const skills = [];
    for (const e of entries) {
      const curPath = join(root, e.name);
      if (e.isDirectory()) {
        skills.push(...await collectSkills(curPath));
      } else if (e.isFile() && e.name.endsWith('.js') && curPath.includes('skills')) {
        const rel = curPath.replace(/\\\\/g, '/');
        const skillId = rel.replace(/^.*skills[\\\\/]/, '').replace(/\.js$/, '');
        // Very naive heuristics
        const content = await fs.readFile(curPath, 'utf8');
        const requiresNetwork = /fetch|axios|undici|wrangler/.test(content);
        const requiresSecrets = /process\\.env\\.[A-Z0-9_]+/.test(content);
        const nondeterministic = /Math\\.random|Date\\.now/.test(content);
        const affectsCi = /npm run/.test(content);
        skills.push({
          skill_id: skillId,
          requires_network: requiresNetwork,
          requires_secrets: requiresSecrets,
          nondeterministic: nondeterministic,
          affects_ci_default: affectsCi
        });
      }
    }
    return skills;
  }
  const skillInventory = await collectSkills('.');
  await writeJson(join(baseDir, 'skill_inventory.json'), skillInventory);

  // ==== EXECUTOR INVENTORY ====
  const executorInventory = [];
  const scriptValues = Object.values(packageJson.scripts || {});
  const cfPolicy = getExecutorPolicy(stationRegistry, 'cloudflare') || { opt_in_env: 'CF_ENABLE', default_enabled: false };
  const opencodePolicy = getExecutorPolicy(stationRegistry, 'opencode_local_container') || { opt_in_env: 'OPENCODE_ENABLE', default_enabled: false };
  const cfGuarded = scriptValues.some((cmd) => cmd.includes('cf_guard_v0.mjs'));
  const opencodeGuarded = scriptValues.some((cmd) => cmd.includes('opencode_guard_v0.mjs'));

  const cfWorkerPaths = ['executors/cloudflare_worker_v1/worker', 'executors/cloudflare_worker_gateway_v0/worker'];
  for (const p of cfWorkerPaths) {
    try {
      await fs.access(p);
      executorInventory.push({
        executor_id: 'cloudflare_worker',
        location: p,
        invoked_by_default: cfPolicy.default_enabled || !cfGuarded,
        safety_default: cfGuarded && !cfPolicy.default_enabled,
        opt_in_env: cfPolicy.opt_in_env,
        guarded: cfGuarded
      });
    } catch (_) {}
  }
  const opencodePath = 'executors/opencode_server_v1';
  try {
    await fs.access(opencodePath);
    executorInventory.push({
      executor_id: 'opencode_local_container',
      location: opencodePath,
      invoked_by_default: opencodePolicy.default_enabled || !opencodeGuarded,
      safety_default: opencodeGuarded && !opencodePolicy.default_enabled,
      opt_in_env: opencodePolicy.opt_in_env,
      guarded: opencodeGuarded
    });
  } catch (_) {}

  await writeJson(join(baseDir, 'executor_inventory.json'), executorInventory);

  // ==== CI IMPACT MAP ====
  const ciImpact = {
    scripts: Object.keys(packageJson.scripts || {}),
    network_scripts: Object.entries(packageJson.scripts || {})
      .filter(([_, cmd]) => /fetch|curl|wrangler/.test(cmd))
      .map(([name]) => name),
    secret_scripts: Object.entries(packageJson.scripts || {})
      .filter(([_, cmd]) => /process\\.env/.test(cmd))
      .map(([name]) => name)
  };
  await writeJson(join(baseDir, 'ci_impact.json'), ciImpact);

  // ==== MARKDOWN REPORT ====
  const reportLines = [];
  reportLines.push('# Station Audit Report');
  reportLines.push(`Run ID: ${runId}`);
  reportLines.push('');
  reportLines.push('## Station Registry');
  reportLines.push('- File: station_registry_v0.json');
  reportLines.push(`- Golden dir: ${goldenDir}`);
  reportLines.push(`- Quarantine dir: ${quarantineDir}`);
  reportLines.push(`- Allowed packs: ${allowedPackIds.size ? Array.from(allowedPackIds).join(', ') : 'none'}`);
  reportLines.push(
    `- Executors opt-in: cloudflare (${cfPolicy.opt_in_env}, default_enabled=${cfPolicy.default_enabled}), ` +
    `opencode (${opencodePolicy.opt_in_env}, default_enabled=${opencodePolicy.default_enabled})`
  );
  reportLines.push('');
  reportLines.push('## Pack Inventory');
  reportLines.push('| pack_id | zone | location | has_readme | has_quality_pos | has_quality_neg | has_proof_kit | recommended_status |');
  reportLines.push('|---------|------|----------|------------|----------------|----------------|----------------|--------------------|');
  for (const p of packInventory) {
    reportLines.push(
      `| ${p.pack_id} | ${p.zone} | ${p.location} | ${p.has_readme} | ${p.has_quality_pos} | ${p.has_quality_neg} | ${p.has_proof_kit} | ${p.recommended_status} |`
    );
  }
  reportLines.push('');
  reportLines.push('## Skill Inventory (summary)');
  const totalSkills = skillInventory.length;
  const networkSkills = skillInventory.filter(s => s.requires_network).length;
  const secretSkills = skillInventory.filter(s => s.requires_secrets).length;
  reportLines.push(`- Total skills: ${totalSkills}`);
  reportLines.push(`- Requires network: ${networkSkills}`);
  reportLines.push(`- Requires secrets: ${secretSkills}`);
  reportLines.push('');
  reportLines.push('## Executor Inventory');
  reportLines.push('| executor_id | location | invoked_by_default | safety_default | opt_in_env | guarded |');
  reportLines.push('|-------------|----------|---------------------|----------------|------------|---------|');
  for (const e of executorInventory) {
    reportLines.push(
      `| ${e.executor_id} | ${e.location} | ${e.invoked_by_default} | ${e.safety_default} | ${e.opt_in_env || ''} | ${e.guarded} |`
    );
  }
  reportLines.push('');
  reportLines.push('## CI Impact');
  reportLines.push('- Scripts: ' + ciImpact.scripts.join(', '));
  reportLines.push('- Network‑related scripts: ' + (ciImpact.network_scripts.length ? ciImpact.network_scripts.join(', ') : 'none'));
  reportLines.push('- Secret‑related scripts: ' + (ciImpact.secret_scripts.length ? ciImpact.secret_scripts.join(', ') : 'none'));
  reportLines.push('');
  await writeReport(join(baseDir, 'audit_report.md'), reportLines.join('\n'));

  console.log(`Audit completed. Run ID: ${runId}`);
  console.log(`Artifacts at: ${baseDir}`);
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
