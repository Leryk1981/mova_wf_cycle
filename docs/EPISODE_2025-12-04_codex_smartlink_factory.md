# Genetic Episode – 2025-12-04 – Codex + MOVA Skills Lab on SmartLink Factory

## 1. Context

- External repo: **MOVA SmartLink Factory** (React/Vite + Cloudflare Worker, MOVA 3.6.0).
- MOVA Skills Lab lives as a subfolder `mova_skills_lab/` inside the SmartLink repo.
- IDE agent: **Codex** (VS Code), conversing with the user in Russian/Ukrainian.
- Session goal: confirm how an IDE agent can use Skills Lab as a factory for skills and connectors without long prompts.

## 2. Session goals

- Walk the full cycle: repository → snapshot → plan → small change.
- Check infrastructure skills:
  - `skill.repo_snapshot_basic`
  - `skill.repo_code_change_plan_basic`
  - `skill.code_exec_task_basic`
- Check the skill factory:
  - `skill.skill_scaffolder_basic`
  - run a new skill on real data.
- Check the connector factory:
  - `skill.connector_scaffolder_basic`
  - `skill.runtime_binding_code_scaffolder_basic` for both skill and connector.
- Measure speed, accuracy, and token cost for real IDE work.

## 3. Skills used in this episode

- `skill.repo_snapshot_basic`  
  – produced a structured snapshot of the SmartLink Factory repo and was stored as PROJECT_SNAPSHOT inside the project.

- `skill.repo_code_change_plan_basic`  
  – suggested separating contracts vs execution (contracts/mova3.6/*), preparing for schema-first and migration to MOVA 4.0.0.

- `skill.code_exec_task_basic`  
  – executed a scoped change: introduced `contracts/mova3.6/*`, updated paths in config/code, verified `npm run build`.

- `skill.skill_scaffolder_basic`  
  – created a new skill `skill.smartlink_contracts_snapshot_basic` with ds/env schemas, profile, binding, and a sample case.

- `skill.smartlink_contracts_snapshot_basic` (run)  
  – built a structured snapshot of the MOVA 3.6.0 contracts layer and an `open_questions` list (missing infra schema, possible additional envelopes, etc.).

- `skill.runtime_binding_code_scaffolder_basic` (for the skill)  
  – generated TypeScript client `smartlinkContractsSnapshotClient.ts` with `runSmartlinkContractsSnapshot(...)`.

- `skill.connector_scaffolder_basic`  
  – created connector `connector.smartlink_worker_status_basic` (manifest, ds/env, HTTP binding, case).

- `skill.runtime_binding_code_scaffolder_basic` (for the connector)  
  – generated TypeScript client `smartlinkWorkerStatusClient.ts` with `getSmartlinkWorkerStatus(...)` using `fetch`.

## 4. Key outcomes

- End-to-end Skills Lab loop worked on a live project:
  - repo → snapshot → plan → scoped change → new skill → new connector → runtime clients.
- All operations ran in a separate experimental branch of the SmartLink repo, keeping the canonical `mova_skills_lab` safe.
- Codex correctly read `skills_registry_v1.json`, manifests, and ds/env schemas as contracts rather than plain text.
- Client code generation (TypeScript) for the skill and connector showed Skills Lab can act as an applied API-client factory.
- Total token spend ≈ 65k, acceptable for the amount of structure and code touched.

## 5. Observations about agent behaviour

- The agent consistently followed the order “plan → small step → code/skill” instead of chaotic edits.
- Language handling was solid: user explanations/commands in Russian/Ukrainian while identifiers/files stayed in English notation.
- The agent’s grasp of Skills Lab was sufficient for regular work: it leaned on the registry and manifests confidently.
- Risky spots (git permissions, dangerous commands) were minimized by explicitly blocking git operations until allowed.

## 6. Risks and limitations

- All artifacts from this episode (new skills/connectors/TS clients) live in the external SmartLink repo, not in canonical `mova_skills_lab`.
- There is no unified machine-readable episode storage yet (only this markdown report).
- Deep runtime integration (MCP/HTTP host) was not tested — clients currently act as facades/stubs.
- Other agents (Gemini/Qwen) were not validated against the same protocol.

## 7. Next steps suggested

- Formalize a stable IDE-agent protocol (Profile + Protocol v1) for using MOVA Skills Lab in any repo.
- Add a user guide: “How to use MOVA Skills Lab in your project” with ready-made phrases/templates for launching key skills.
- Use this episode as a reference when integrating external tools (e.g., Skill Seeker) into the MOVA genetic layer.
- In the future, convert similar episodes to `ds.episode_*` and store them in machine-readable form for analysis and evolution.
