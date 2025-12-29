# Workflow experiment schemas — requirements (v1)

Goal: define the minimal JSON Schemas and envelopes needed to run workflow experiments in MOVA Skills Lab.

## Data schemas (ds.*)
- `ds.lab_workflow_procedure_v1` — describes a workflow procedure and steps.
- `ds.lab_workflow_experiment_config_v1` — describes an experiment (participants, constraints, metrics, datasets).
- `ds.lab_workflow_experiment_result_v1` — aggregated metrics and textual findings.
- `ds.lab_workflow_episode_data_v1` — captures per-run episode data and observations.

## Envelopes (env.*)
- `env.lab_workflow_experiment_plan_request_v1`
- `env.lab_workflow_variant_generate_request_v1`
- `env.lab_workflow_variant_run_request_v1`
- `env.lab_workflow_experiment_aggregate_request_v1`

## Acceptance criteria
- Schemas validate with existing tooling (mova-check or repo validators).
- Each schema/envelope has at least one minimal JSON example.
- New vocabulary additions are documented and aligned with `core/mova` global definitions.
