import fs from "node:fs";
import path from "node:path";

const DEFAULT_REGISTRY = {
  station_core: {
    allowed_pack_ids: [],
    quarantine_dir: "packs/_quarantine",
    golden_dir: "packs"
  },
  executors_policy: {
    cloudflare: {
      opt_in_env: "CF_ENABLE",
      default_enabled: false
    },
    opencode: {
      opt_in_env: "OPENCODE_ENABLE",
      default_enabled: false
    }
  },
  notes: ""
};

function normalizeRegistry(raw) {
  const registry = raw && typeof raw === "object" ? raw : {};
  const stationCore = registry.station_core || {};
  const executorsPolicy = registry.executors_policy || {};
  return {
    station_core: {
      allowed_pack_ids: stationCore.allowed_pack_ids || DEFAULT_REGISTRY.station_core.allowed_pack_ids,
      quarantine_dir: stationCore.quarantine_dir || DEFAULT_REGISTRY.station_core.quarantine_dir,
      golden_dir: stationCore.golden_dir || DEFAULT_REGISTRY.station_core.golden_dir
    },
    executors_policy: {
      cloudflare: {
        opt_in_env: executorsPolicy.cloudflare?.opt_in_env || DEFAULT_REGISTRY.executors_policy.cloudflare.opt_in_env,
        default_enabled: typeof executorsPolicy.cloudflare?.default_enabled === "boolean"
          ? executorsPolicy.cloudflare.default_enabled
          : DEFAULT_REGISTRY.executors_policy.cloudflare.default_enabled
      },
      opencode: {
        opt_in_env: executorsPolicy.opencode?.opt_in_env || DEFAULT_REGISTRY.executors_policy.opencode.opt_in_env,
        default_enabled: typeof executorsPolicy.opencode?.default_enabled === "boolean"
          ? executorsPolicy.opencode.default_enabled
          : DEFAULT_REGISTRY.executors_policy.opencode.default_enabled
      }
    },
    notes: registry.notes || DEFAULT_REGISTRY.notes
  };
}

export function loadStationRegistry(baseDir = process.cwd(), registryFile = "station_registry_v0.json") {
  const registryPath = path.isAbsolute(registryFile) ? registryFile : path.join(baseDir, registryFile);
  try {
    const content = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(content);
    return normalizeRegistry(parsed);
  } catch (_) {
    return normalizeRegistry({});
  }
}

export function resolvePackPath(packId, registry) {
  const reg = registry ? normalizeRegistry(registry) : normalizeRegistry({});
  const allowed = new Set(reg.station_core.allowed_pack_ids || []);
  const baseDir = allowed.has(packId) ? reg.station_core.golden_dir : reg.station_core.quarantine_dir;
  return path.join(baseDir, packId);
}

export function resolvePackPathAbs(baseDir, packId, registry) {
  const rel = resolvePackPath(packId, registry);
  return path.isAbsolute(rel) ? rel : path.join(baseDir, rel);
}

export function getExecutorPolicy(registry, executorId) {
  const reg = registry ? normalizeRegistry(registry) : normalizeRegistry({});
  const policy = reg.executors_policy || {};
  if (executorId === "cloudflare" || executorId === "cloudflare_worker") {
    return policy.cloudflare || DEFAULT_REGISTRY.executors_policy.cloudflare;
  }
  if (executorId === "opencode" || executorId === "opencode_local_container") {
    return policy.opencode || DEFAULT_REGISTRY.executors_policy.opencode;
  }
  return null;
}

export function getDefaultRegistry() {
  return normalizeRegistry({});
}
