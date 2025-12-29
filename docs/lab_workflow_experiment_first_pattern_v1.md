# Workflow experiment pattern – WF-EX-001 baseline

## Context
In DPP-lab and MOVA Skills Lab we already use the cycle: repo snapshot → change plan → apply step → record. This document captures the first baseline workflow experiment.

## Baseline workflow (as-is)
1. Choose repository and branch.  
2. Run `repo_snapshot_basic` and store the snapshot.  
3. Define the change task (L/T scope).  
4. Run `repo_code_change_plan_basic` to generate a plan.  
5. Open IDE and execute one or more plan steps with an agent.  
6. Run tests/checks.  
7. Record the episode (changes, timing, issues).

## Experiment config
- Format: `ds.lab_workflow_experiment_config_v1` with an ID like `WF-EX-001: repo_change_plan_workflow_baseline_vs_agents`.
- Participants: chat agent (browser), IDE agent (VS Code), optional repo agent; model family field records the actual model (e.g., `gpt`).
- Metrics: `total_time_minutes`, `iterations_count`, `errors_count`, `subjective_load` (1–5), all minimizing.
- Constraints: keep repo structure stable, avoid new deps unless required, respect existing Skills Lab/DPP-lab scenarios.

## Experiment steps
1. Fill `lab_workflow_procedure` for the as-is workflow.  
2. Create `lab_workflow_experiment_config` for WF-EX-001.  
3. For each `agent_profile`, call `env.lab_workflow_variant_generate_request_v1` and collect candidate procedures.  
4. Pick 3–5 real code-change tasks in a repo.  
5. For each candidate procedure and task, run the workflow (human + agent) and capture episodes (time, iterations, errors, subjective load).  
6. Call `env.lab_workflow_experiment_aggregate_request_v1` for `experiment_id = "WF-EX-001"`.  
7. Store result JSON + markdown report under `lab/examples/`.

## Expected outcome
- Complete artifact set: config, procedures, episodes, aggregated result.
- A human report with conclusions and recommendations for an improved baseline workflow to reuse in later experiments.
