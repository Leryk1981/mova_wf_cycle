# Workflow lab modernization roadmap

**Project:** MOVA Skills Lab  
**Focus:** workflow experiments and model competition  
**Horizon:** 2–4 IDE iterations

---

## Phase 0 — Concept freeze (this archive)
Outcome:
- text overview of the workflow lab
- schema + envelope requirements
- description of the first test pattern
- this roadmap

Use these artifacts to start a fresh chat/branch in a concrete repository.

---

## Phase 1 — Schemas and envelopes
**Goal:** add the minimal lab schemas and envelopes to MOVA Skills Lab.

Steps:
1. Create a branch, e.g. `feature/lab-workflow-experiments-v1`.
2. Add JSON Schemas: `ds.lab_workflow_procedure_v1`, `ds.lab_workflow_experiment_config_v1`, `ds.lab_workflow_experiment_result_v1`, `ds.lab_workflow_episode_data_v1`.
3. Add schema tests (validate via mova-check or existing tools).
4. Add envelope schemas: `env.lab_workflow_experiment_plan_request_v1`, `env.lab_workflow_variant_generate_request_v1`, `env.lab_workflow_variant_run_request_v1`, `env.lab_workflow_experiment_aggregate_request_v1`.
5. Update catalogs/indexes and include minimal payload examples.

**Exit:** all new schemas/envelopes validate and have at least one minimal JSON example.

---

## Phase 2 — Yellow skills for workflow experiments
**Goal:** add baseline skills for the new schemas.

Required skills:
1. `skill.workflow_experiment_plan_basic` — input: domain + as-is workflow; output: `ds.lab_workflow_experiment_config_v1`.
2. `skill.workflow_variant_generate_basic` — input: baseline procedure + config + agent_profile; output: candidate `ds.lab_workflow_procedure_v1`.
3. `skill.workflow_variant_run_basic` — input: procedure_id + test_data_ref + context; output: episodes with `lab_workflow_episode_data_v1`.
4. `skill.workflow_experiment_aggregate_basic` — input: experiment_id; output: `ds.lab_workflow_experiment_result_v1` + human-readable markdown report.

Steps:
1. Create skill folders like existing skills.
2. For each skill: define contracts via MOVA schemas, add minimal env run examples, and add tests if a common runner exists.

**Exit:** all four skills have descriptions, examples, and can be invoked manually with env files.

---

## Phase 3 — First experiment WF-EX-001
**Goal:** run the first full workflow experiment.

Steps:
1. Capture the as-is workflow `wf_repo_change_plan_baseline_v1` as `lab_workflow_procedure`.
2. Create `lab_workflow_experiment_config` for `WF-EX-001` per the first pattern document.
3. For each `agent_profile`: call `env.lab_workflow_variant_generate_request_v1` and record candidate procedures.
4. Pick 3–5 real code-change tasks (DPP-lab / Skills Lab).
5. For every procedure variant and task: run the workflow (human + agent), capture episodes (time, iterations, errors, subjective load).
6. Call `env.lab_workflow_experiment_aggregate_request_v1` with `experiment_id = "WF-EX-001"`.
7. Store output JSON + markdown report under `lab/examples/`.

**Exit:** full artifact set (config, procedures, episodes, result) plus a human report with conclusions and a recommended improved workflow.

---

## Phase 4 — Polish and generalize
**Goal:** turn the first experiment into a stable pattern for other domains.

Possible steps:
1. Extract the common parts into a reusable pattern/template.
2. Add basic UI/IDE helpers (Workbench / Skills Lab commands) for launching workflow experiments.
3. Capture best practices in a guide on how to describe workflows, metrics, and constraints.
4. Optionally move stable pieces into a higher-stability layer (yellow/own package) if experiments show they are reusable.

**Exit:** WF-EX-001 is completed, lessons are merged into code/docs, and there is a clear recipe to run WF-EX-00X for another domain (SmartLink, file_cleanup, social_pack, etc.).
