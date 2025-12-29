# skill.skill_ingest_run_with_skillseeker_basic

Baseline Skill Seeker launcher via CLI:
- input: `env.skill_ingest_run_request_v1` (inline configs for source/run);
- action: builds a temp config and calls `skill-seekers <mode> --config <temp>` with the required flags;
- output: `ds.skill_ingest_run_result_v1` (status + output paths, no deep parsing).

Episodes are not written by this skill; use `skill.skill_ingest_store_episode_basic` to persist episodes.
