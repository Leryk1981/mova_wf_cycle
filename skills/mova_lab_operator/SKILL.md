# skill.mova_lab_operator

Laboratory operator skill. Its role is to help an AI agent:

- discover all skills via the registry (`lab/skills_registry_v1.json`);
- understand each skill’s structure (manifest, ds/env, cases, episodes);
- plan skill runs through `ds.skill_run_request_v1` and `tools/run_skill_plan.js`;
- create episodes when needed via `tools/record_episode.js`;
- respect each skill’s `episode_policy`.

This skill does not perform domain work (files, notes, etc.); it explains how to use the lab correctly.
