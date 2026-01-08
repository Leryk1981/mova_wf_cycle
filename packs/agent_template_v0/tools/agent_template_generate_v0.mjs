#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const schemaPath = path.join(repoRoot, "packs", "agent_template_v0", "ds", "env.agent_template_generate_request_v0.json");
const defaultRequest = path.join(repoRoot, "packs", "agent_template_v0", "docs", "examples", "pos", "agent_template_request_min.json");
const allowedRoles = ["planner", "executor", "qa", "notary"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function relRepo(target) {
  return path.relative(repoRoot, target).replace(/\\/g, "/");
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function run() {
  const requestedPath = getArg("--request") || defaultRequest;
  if (!fs.existsSync(requestedPath)) {
    fail("ERR_MISSING_REQUEST", `request file missing: ${requestedPath}`);
  }
  const request = readJson(requestedPath);
  if (request.mova_version !== "4.1.1") {
    fail("ERR_INVALID_MOVA_VERSION", `mova_version must be 4.1.1`);
  }
  const schema = readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(request);
  if (!valid) {
    const message = (validate.errors || []).map((err) => `${err.instancePath || "/"} ${err.message}`).join("; ");
    fail("ERR_SCHEMA_VALIDATION", `request schema invalid: ${message}`);
  }

  const unknown = request.roles.filter((role) => !allowedRoles.includes(role));
  if (unknown.length) {
    fail("ERR_UNKNOWN_ROLE", `unknown roles: ${unknown.join(", ")}`);
  }
  const missing = allowedRoles.filter((role) => !request.roles.includes(role));
  if (missing.length) {
    fail("ERR_MISSING_ROLE", `missing canonical roles: ${missing.join(", ")}`);
  }
  const wildcardDestinations = request.destinations.filter((dest) => typeof dest === "string" && dest.includes("*"));
  if (wildcardDestinations.length) {
    fail("ERR_WILDCARD_DESTINATION", "destinations must not contain wildcard tokens");
  }

  const actions = Array.isArray(request.actions) ? request.actions : [];
  const actionIds = actions.map((action) => action.action_id);
  const destinationAllowlist = Array.from(
    new Set([
      ...(Array.isArray(request.destinations) ? request.destinations : []),
      ...actions.flatMap((action) => action.destinations || []),
    ].filter((dest) => typeof dest === "string" && !dest.includes("*")))
  );
  const roleActionMap = allowedRoles.reduce((acc, role) => {
    acc[role] = actions
      .filter((action) => Array.isArray(action.role_allowlist) && action.role_allowlist.includes(role))
      .map((action) => action.action_id);
    return acc;
  }, {});

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const baseDir = path.join(repoRoot, "artifacts", "agent_template", runId);
  const bundleDir = path.join(baseDir, "bundle");
  fs.mkdirSync(bundleDir, { recursive: true });
  const filesCreated = [];

  function track(relativePath) {
    const abs = path.join(bundleDir, relativePath);
    filesCreated.push(relRepo(abs));
  }

  function writeJson(relativePath, payload) {
    const target = path.join(bundleDir, relativePath);
    ensureDir(target);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
    track(relativePath);
  }

  function writeText(relativePath, content) {
    const target = path.join(bundleDir, relativePath);
    ensureDir(target);
    fs.writeFileSync(target, content, "utf8");
    track(relativePath);
  }

  const policy = {
    version: "v0",
    default: "deny",
    allow_actions: actionIds,
    deny_actions: [],
    destinations: destinationAllowlist,
    policy_overrides: request.policy_overrides ?? {},
    pipeline_enabled: request.pipeline_enabled !== false,
    limits: {
      max_plan_iterations: 3,
      max_executor_rounds: 2,
      max_observed_commands: 5
    },
    notes: "deny-by-default policy for agent_template bundles"
  };
  writeJson(path.join("mova", "policy", "policy.v0.json"), policy);

  const registryEntries = actions.map((action) => ({
    entry_id: action.action_id,
    type: "action",
    category: action.driver_kind,
    driver_kind: action.driver_kind,
    description: `Parameterized ${action.driver_kind} action ${action.action_id}`,
    driver_config: action.driver_config,
    role_allowlist: action.role_allowlist,
    destinations: Array.isArray(action.destinations) ? action.destinations : [],
    allow: true
  }));
  const registryDir = path.join(bundleDir, "mova", "registry");
  fs.mkdirSync(registryDir, { recursive: true });
  const registryFile = path.join(registryDir, "registry.jsonl");
  fs.writeFileSync(registryFile, registryEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  filesCreated.push(relRepo(registryFile));

  const roleBundles = {
    version: "v0",
    roles: allowedRoles.map((role) => ({
      role_id: role,
      description: `Canonical ${role} role for agent_template bundles`,
      capabilities: [
        role === "planner"
          ? "plan"
          : role === "executor"
          ? "execute"
          : role === "qa"
          ? "verify"
          : "notarize"
      ],
      multiplex: false,
      allowed_actions: roleActionMap[role]
    }))
  };
  writeJson(path.join("mova", "roles", "role_bundles_v0.json"), roleBundles);

const roleMatrix = {
  version: "v0",
  transitions: [
    { from_role: "planner", to_role: "executor" },
    { from_role: "executor", to_role: "qa" },
    { from_role: "qa", to_role: "notary" }
  ],
  note: "Linear planner → executor → qa → notary flow",
  role_action_map: roleActionMap
};
  writeJson(path.join("mova", "roles", "role_matrix_v0.json"), roleMatrix);

  const instructionProfiles = {
    version: "v0",
    profiles: [
      {
        id: "evidence_first",
        description: "Require evidence before conclusions",
        preferences: {
          evidence_first: true,
          allow_secrets: false,
          max_citations: 3
        }
      }
    ]
  };
  writeJson(path.join("mova", "instruction_profiles", "instruction_profiles_v0.json"), instructionProfiles);

  const pipeline = {
    version: "v0",
    pipeline: [
      { id: "plan", description: "Plan the high-level steps" },
      { id: "execute", description: "Execute the plan" },
      { id: "verify", description: "Verify the results" },
      { id: "notarize", description: "Capture evidence and close" }
    ]
  };
  writeJson(path.join("mova", "pipeline", "pipeline_v0.json"), pipeline);

  const claudeSettings = {
    mode: "plan",
    allowlisted_commands: [
      "git status",
      "npm run smoke:wf_cycle",
      "node tools/wf_cycle_smoke_ci.mjs"
    ]
  };
  writeJson(path.join(".claude", "settings.json"), claudeSettings);

  const claudeCommandFiles = {
    "gates.md": "# Gates Command Reference\n\n1. `npm run smoke:wf_cycle` - exercise the wf_cycle smoke suite.\n2. `npm run validate` - verify all schemas and manifests stay valid.\n",
    "quality.md": "# Quality Command Reference\n\n1. `npm run quality:agent_template` - run the positive quality checks for agent_template bundles.\n2. `npm run quality:agent_template:neg` - ensure negatives fail as expected.\n",
    "station.md": "# Station Command Reference\n\n1. `node skills/station_cycle_v1/impl/bindings/run_station_cycle.js` - drive the station_cycle workflow with optional quality/ship steps.\n2. Use `tmp_station_cycle_agent_template_request.json` samples to toggle steps.\n",
    "ship.md": "# Ship Command Reference\n\n1. `npm run ship:agent_template` - package the agent template bundle and emit manifest metadata (pass `--request` or set `AGENT_TEMPLATE_REQUEST`).\n"
  };
  for (const [filename, content] of Object.entries(claudeCommandFiles)) {
    writeText(path.join(".claude", "commands", filename), content.trim() + "\n");
  }

  const claudeMd = `# Agent template operator rules\n\n- Operate in evidence-first mode; cite data before assertions.\n- Never disclose secrets or credentials.\n- Use only the allowlisted station commands for exploratory probes.\n- Escalate any unexpected signals to the engineering team before continuing.\n`;
  writeText("CLAUDE.md", claudeMd);

  const README = `# Agent Template v0\n\nRole-aware bundle created for ${request.roles.join(", ")} targeting ${request.destinations.join(", ")}.\n\nThis bundle follows the plan→execute→verify→notarize pipeline while enforcing an evidence-first operator profile.\n`;
  writeText("README_AGENT_TEMPLATE.md", README);

  const metadata = {
    mova_version: "4.1.1",
    run_id: runId,
    request: {
      path: relRepo(requestedPath),
      roles: request.roles,
      destinations: request.destinations
    },
    bundle_path: relRepo(bundleDir),
    bundle_files: filesCreated
  };
  const metadataPath = path.join(baseDir, "bundle_metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");
  filesCreated.push(relRepo(metadataPath));

  const result = {
    mova_version: "4.1.1",
    run_id: runId,
    bundle_dir: relRepo(bundleDir),
    bundle_files: filesCreated
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

try {
  run();
} catch (error) {
  const code = error.code || "ERR_AGENT_TEMPLATE_GENERATE";
  console.error(`[agent_template_generate] ${code} ${error.message}`);
  process.exit(1);
}
