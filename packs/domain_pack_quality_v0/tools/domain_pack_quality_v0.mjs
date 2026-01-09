#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const qualityRoot = path.join(repoRoot, 'artifacts', 'quality', 'domain_pack_quality');
const scaffoldGenerator = path.join(repoRoot, 'packs/domain_pack_scaffold_v0/tools/demo_domain_pack_scaffold_v0.mjs');

function getArg(key) {
  const idx = process.argv.indexOf(key);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectJsonPaths(rootDir) {
  const collected = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const resolved = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectJsonPaths(resolved));
      continue;
    }
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.json' || ext === '.jsonl') {
        collected.push(resolved);
      }
    }
  }
  return collected;
}

function validateJsonFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    if (ext === '.jsonl') {
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        JSON.parse(line);
      }
    } else {
      JSON.parse(content);
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

function writeReportDir(runId, suffix) {
  const dir = path.join(qualityRoot, runId);
  ensureDir(dir);
  return path.join(dir, suffix);
}

function makeMd(report) {
  const lines = [
    `# Domain Pack Quality Report (${report.mode})`,
    '',
    `- Run: ${report.run_id}`,
    `- Status: ${report.status.toUpperCase()}`,
    `- Pack Dir: ${report.pack_dir || '(n/a)'}`,
    '',
    '## Checks'
  ];
  for (const check of report.checks || []) {
    lines.push(`- ${check.name}: ${check.status.toUpperCase()}`);
    if (check.details && check.details.length) {
      for (const detail of check.details) {
        lines.push(`  - ${detail}`);
      }
    }
  }
  if (report.mode === 'negative' && Array.isArray(report.cases)) {
    lines.push('', '## Negative Suite');
    for (const entry of report.cases) {
      lines.push(`- ${entry.id}: ${entry.status.toUpperCase()}`);
      if (entry.errors && entry.errors.length) {
        for (const error of entry.errors) {
          lines.push(`  - ${error}`);
        }
      }
    }
  }
  return lines.join('\n') + '\n';
}

function checkSecurity(packDir) {
  const checks = [];

  // Check for wildcard destinations in policy configs or registry
  let hasWildcards = false;
  let wildcardDetails = [];

  const dsDir = path.join(packDir, 'ds');
  if (fs.existsSync(dsDir)) {
    const files = fs.readdirSync(dsDir);
    files.forEach(f => {
      if (f.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(dsDir, f), 'utf8');
          const data = JSON.parse(content);
          const contentStr = JSON.stringify(data);
          if (contentStr.includes('*') || contentStr.includes('["*"]') || contentStr.match(/"[^*]*\*[^*]*"/)) {
            hasWildcards = true;
            wildcardDetails.push(`wildcard in ${f}`);
          }
        } catch (e) {
          wildcardDetails.push(`parse error in ${f}: ${e.message}`);
        }
      }
    });
  }

  // Check registry for wildcards or invalid types
  const registryPath = path.join(packDir, 'registry', 'registry.jsonl');
  const allowedControlTypes = ['http', 'restricted_shell', 'mcp_proxy'];

  let registryValid = false;
  let registryDetails = [];

  if (fs.existsSync(registryPath)) {
    try {
      const content = fs.readFileSync(registryPath, 'utf8');
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      let validEntries = 0;
      let invalidEntries = 0;

      lines.forEach((line, idx) => {
        try {
          const entry = JSON.parse(line);
          if (entry.control_action_type && allowedControlTypes.includes(entry.control_action_type)) {
            validEntries++;
          } else if (entry.control_action_type) {
            registryDetails.push(`registry line ${idx+1}: invalid control_action_type ${entry.control_action_type}`);
            invalidEntries++;
          }
          // Check for wildcards in domain_action_id
          if (entry.domain_action_id && (entry.domain_action_id.includes('*') || entry.domain_action_id.includes(' '))) {
            wildcardDetails.push(`wildcard in domain_action_id at line ${idx+1}`);
            hasWildcards = true;
          }
        } catch (e) {
          registryDetails.push(`parse error at line ${idx+1}: ${e.message}`);
        }
      });

      registryValid = validEntries > 0 && invalidEntries === 0;
    } catch (e) {
      registryDetails.push(`cannot read registry: ${e.message}`);
    }
  }

  checks.push({
    name: 'security_no_wildcards',
    status: hasWildcards ? 'fail' : 'pass',
    details: wildcardDetails
  });

  checks.push({
    name: 'registry_control_action_type_valid',
    status: registryValid ? 'pass' : 'fail',
    details: registryDetails
  });

  return checks;
}

function runPositive(packDir, requestFile) {
  const env = readJson(requestFile);
  if (env.mova_version !== '4.1.1') {
    throw new Error('Version mismatch');
  }

  const checks = [];

  // Structure checks
  const dsExists = fs.existsSync(path.join(packDir, 'ds'));
  checks.push({
    name: 'structure_has_ds_dir',
    status: dsExists ? 'pass' : 'fail',
    details: dsExists ? [] : ['ds directory missing']
  });

  // Check for docs/examples/pos/
  const posDir = path.join(packDir, 'docs/examples/pos');
  const posExists = fs.existsSync(posDir);
  const posFiles = posExists ? fs.readdirSync(posDir).filter(f => !f.startsWith('.')).length : 0;
  const minPos = env.requirements?.min_pos_examples || 1;
  checks.push({
    name: 'structure_has_pos_examples',
    status: (posExists && posFiles >= minPos) ? 'pass' : 'fail',
    details: [`found ${posFiles}, required ${minPos}`]
  });

  // Check for docs/examples/neg/
  const negDir = path.join(packDir, 'docs/examples/neg');
  const negExists = fs.existsSync(negDir);
  const negFiles = negExists ? fs.readdirSync(negDir).filter(f => !f.startsWith('.')).length : 0;
  const minNeg = env.requirements?.min_neg_examples || 2;
  checks.push({
    name: 'structure_has_neg_examples',
    status: (negExists && negFiles >= minNeg) ? 'pass' : 'fail',
    details: [`found ${negFiles}, required ${minNeg}`]
  });

  // Check for registry/registry.jsonl
  const registryPath = path.join(packDir, 'registry/registry.jsonl');
  const registryExists = fs.existsSync(registryPath);
  checks.push({
    name: 'registry_exists',
    status: registryExists ? 'pass' : 'fail',
    details: registryExists ? [] : ['registry.jsonl missing']
  });

  // JSON validation
  const jsonFiles = collectJsonPaths(packDir);
  const validationDetails = [];
  for (const filePath of jsonFiles) {
    const error = validateJsonFile(filePath);
    if (error) {
      validationDetails.push(`${rel(filePath)}: ${error}`);
    }
  }
  checks.push({
    name: 'json_validation',
    status: validationDetails.length ? 'fail' : 'pass',
    details: validationDetails
  });

  // Security checks
  checks.push(...checkSecurity(packDir));

  return checks;
}

function runNegative(suitePath) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const suite = readJson(suitePath);
  const cases = [];

  for (const entry of suite.cases || []) {
    const requestPath = path.join(repoRoot, entry.request);

    // First ensure demo pack exists
    if (getArg('--neg')) {
      const child = spawnSync('node', [scaffoldGenerator], {
        cwd: repoRoot,
        encoding: 'utf8'
      });
      if (child.status !== 0) {
        cases.push({
          id: entry.id,
          request: rel(requestPath),
          status: 'fail',
          errors: [`scaffold generator failed: ${child.stderr}`]
        });
        continue;
      }
    }

    // Load env and get pack dir
    const env = readJson(requestPath);
    const packDir = path.join(repoRoot, env.pack_dir);

    const runChild = spawnSync('node', [process.argv[1], requestPath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    const expect = entry.expect || {};
    const caseResult = {
      id: entry.id,
      request: rel(requestPath),
      exit_code: runChild.status ?? 1,
      expected: expect,
      actual: {},
      status: 'fail',
      errors: []
    };

    if (runChild.status === 0) {
      caseResult.errors.push('check unexpectedly succeeded');
      caseResult.actual = {
        code: 'SUCCESS',
        message: 'quality check succeeded in a negative case',
        stdout: (runChild.stdout || '').trim(),
        stderr: (runChild.stderr || '').trim()
      };
    } else {
      let output;
      try {
        output = JSON.parse(runChild.stdout || '{}');
        caseResult.actual = {
          code: output.status || 'UNKNOWN',
          message: output.summary || '',
          stdout: runChild.stdout,
          stderr: runChild.stderr
        };

        // Check expectations
        if (expect.fail_with_message && !caseResult.actual.message.includes(expect.fail_with_message)) {
          caseResult.errors.push('message mismatch');
        }
        if (expect.fail_status && caseResult.actual.code !== expect.fail_status) {
          caseResult.errors.push(`status mismatch (got ${caseResult.actual.code})`);
        }
      } catch (e) {
        caseResult.errors.push(`cannot parse output: ${e.message}`);
        caseResult.actual = {
          code: 'PARSE_ERROR',
          stdout: runChild.stdout,
          stderr: runChild.stderr
        };
      }
    }

    caseResult.status = caseResult.errors.length ? 'fail' : 'pass';
    cases.push(caseResult);
  }

  const overall = cases.every((entry) => entry.status === 'pass') ? 'pass' : 'fail';
  const report = {
    run_id: runId,
    mode: 'negative',
    status: overall,
    cases,
    created_at: new Date().toISOString()
  };

  const reportPath = writeReportDir(runId, 'quality_report_negative.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(writeReportDir(runId, 'quality_report_negative.md'), makeMd(report), 'utf8');

  return report;
}

function main() {
  const requestArg = getArg('--request');
  if (!requestArg) {
    console.error('Usage: node domain_pack_quality_v0.mjs --request <env_file>');
    process.exit(1);
  }

  const requestPath = path.isAbsolute(requestArg) ? requestArg : path.join(repoRoot, requestArg);
  const env = readJson(requestPath);

  if (getArg('--neg')) {
    const negativeSuitePath = getArg('--suite');
    if (!negativeSuitePath) {
      console.error('Negative mode requires --suite');
      process.exit(1);
    }
    const report = runNegative(negativeSuitePath);
    const prefix = '[domain_pack_quality:neg]';
    if (report.status === 'pass') {
      console.log(`${prefix} PASS (reports: ${rel(path.dirname(writeReportDir(report.run_id, 'quality_report_negative.json')))})`);
      process.exit(0);
    } else {
      console.error(`${prefix} FAIL`);
      process.exit(1);
    }
  } else {
    // Positive mode
    const packDir = path.join(repoRoot, env.pack_dir);

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const checks = runPositive(packDir, requestPath);

    const reportStatus = checks.every((check) => check.status === 'pass') ? 'pass' : 'fail';
    const report = {
      run_id: runId,
      mode: 'positive',
      status: reportStatus,
      pack_dir: rel(packDir),
      checks,
      created_at: new Date().toISOString()
    };

    const reportPath = writeReportDir(runId, 'quality_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(writeReportDir(runId, 'quality_report.md'), makeMd(report), 'utf8');

    const prefix = '[domain_pack_quality:pos]';
    if (report.status === 'pass') {
      console.log(`${prefix} PASS (reports: ${rel(path.dirname(writeReportDir(runId, 'quality_report.json')))})`);
      process.exit(0);
    } else {
      console.error(`${prefix} FAIL`);
      process.exit(1);
    }
  }
}

main();