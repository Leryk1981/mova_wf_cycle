-- MOVA Cloudflare Worker Gateway v0 - D1 Database Schema
-- Episodes table for tracking tool executions and policy decisions

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  policy_ref TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  engine_ref TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_episodes_run_id ON episodes(run_id);
CREATE INDEX IF NOT EXISTS idx_episodes_ts ON episodes(ts);

