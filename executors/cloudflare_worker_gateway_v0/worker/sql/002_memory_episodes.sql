-- MOVA Cloudflare Worker Gateway v0 - Episode memory (Cloudflare D1)
-- Stores station_cycle and other ingest episodes for quick search.

CREATE TABLE IF NOT EXISTS memory_episodes (
  episode_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  run_id TEXT,
  created_ts INTEGER NOT NULL,
  stored_ts INTEGER NOT NULL,
  episode_json TEXT NOT NULL,
  envelope_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_episodes_type ON memory_episodes(type);
CREATE INDEX IF NOT EXISTS idx_memory_episodes_run_id ON memory_episodes(run_id);
CREATE INDEX IF NOT EXISTS idx_memory_episodes_stored_ts ON memory_episodes(stored_ts);
