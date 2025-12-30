# skill.skill_ingest_store_episode_basic

Skill Seeker episode storage:
- input: `env.skill_ingest_run_store_episode_v1` (contains `ds.episode_skill_ingest_run_v1`);
- action: writes the episode to the lab’s file store (`lab/episodes/skill_ingest/`);
- output: confirmation `{ ok, episode_id, path }`.

Remote mode (Cloudflare memory v0):
- set `STORE_EPISODE_REMOTE_URL=https://mova-tool-gateway-v0-dev.<account>.workers.dev/episode/store`;
- set `STORE_EPISODE_REMOTE_TOKEN=<Bearer token>`;
- the skill automatically POSTs the envelope, returning the JSON from the gateway.

Used together with `skill.skill_ingest_run_with_skillseeker_basic`.
