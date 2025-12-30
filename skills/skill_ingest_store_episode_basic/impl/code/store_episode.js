#!/usr/bin/env node

/**
 * Skill Seeker ingest episode storage.
 * Input: env.skill_ingest_run_store_episode_v1
 * Output: { ok, episode_id, path }
 */
const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function resolveBaseDir(customDir) {
  if (customDir) return customDir;
  const envDir = process.env.STORE_EPISODE_BASE_DIR;
  if (envDir) return envDir;
  return path.join(__dirname, "..", "..", "..", "..", "lab", "episodes", "skill_ingest");
}

function fetchJson(url, options) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Remote store request timed out"));
    }, options.timeout ?? 15000);

    fetch(url, {
      ...options,
      signal: controller.signal
    }).then(async (res) => {
      clearTimeout(timeout);
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch (err) {
        reject(new Error(`Remote store returned non-JSON payload (${err.message})`));
        return;
      }
      if (!res.ok || json.ok === false) {
        const code = json.error || res.statusText || "remote error";
        reject(new Error(`Remote store failed (${res.status}): ${code}`));
        return;
      }
      resolve({ status: res.status, body: json });
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function storeSkillIngestEpisodeBasic(envelope, options = {}) {
  if (!envelope || envelope.envelope_type !== "env.skill_ingest_run_store_episode_v1") {
    throw new Error("Invalid envelope_type, expected env.skill_ingest_run_store_episode_v1");
  }

  const episode = envelope.episode;
  if (!episode) {
    throw new Error("Missing episode payload");
  }
  if (episode.mova_version !== "4.0.0") {
    throw new Error("episode.mova_version must be 4.0.0");
  }
  if (!episode.episode_id || !episode.envelope_id) {
    throw new Error("episode_id and envelope_id are required");
  }

  const remoteUrl = options.remoteUrl || process.env.STORE_EPISODE_REMOTE_URL;
  if (remoteUrl) {
    const token = options.remoteToken || process.env.STORE_EPISODE_REMOTE_TOKEN;
    if (!token) {
      throw new Error("STORE_EPISODE_REMOTE_TOKEN required when STORE_EPISODE_REMOTE_URL is set");
    }
    const result = await fetchJson(remoteUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(envelope)
    });
    return {
      ok: true,
      episode_id: result.body.episode_id || episode.episode_id,
      remote: true,
      endpoint: remoteUrl,
      response: result.body
    };
  }

  const baseDir = resolveBaseDir(options.baseDir);
  ensureDir(baseDir);

  const filename = options.fileName
    ? options.fileName
    : `${episode.episode_id}__${episode.envelope_id}.json`;
  const outPath = path.join(baseDir, filename);

  fs.writeFileSync(outPath, JSON.stringify(episode, null, 2), "utf8");

  return {
    ok: true,
    episode_id: episode.episode_id,
    path: outPath
  };
}

async function main() {
  function resolveInputArg() {
    const args = process.argv.slice(2);
    let candidate = null;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--request" || arg === "--input" || arg === "-r") {
        candidate = args[i + 1];
        i += 1;
        continue;
      }
      const match = arg.match(/^--(?:request|input)=(.+)$/);
      if (match) {
        candidate = match[1];
        continue;
      }
      if (!arg.startsWith("--") && !candidate) {
        candidate = arg;
        continue;
      }
    }
    return candidate;
  }

  const inputArg = resolveInputArg();
  if (!inputArg) {
    console.error("Usage: node store_episode.js --request <path/to/envelope.json>");
    process.exit(1);
  }
  const absolutePath = path.isAbsolute(inputArg)
    ? inputArg
    : path.join(process.cwd(), inputArg);

  const envelope = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  try {
    const res = await storeSkillIngestEpisodeBasic(envelope);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  storeSkillIngestEpisodeBasic,
  resolveBaseDir
};
