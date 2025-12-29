# skill.skill_ingest_store_episode_basic

Skill Seeker episode storage:
- input: `env.skill_ingest_run_store_episode_v1` (contains `ds.episode_skill_ingest_run_v1`);
- action: writes the episode to the lab’s file store (`lab/episodes/skill_ingest/`);
- output: confirmation `{ ok, episode_id, path }`.

Used together with `skill.skill_ingest_run_with_skillseeker_basic`.
