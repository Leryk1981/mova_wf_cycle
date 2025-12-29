# MOVA Skills Lab — Project snapshot (2025-12-03)

This snapshot captures the repository layout when MOVA Skills Lab was first organized as a three-layer monorepo.

## Repository structure (summary)
- `docs/` — human-facing documentation.
- `core/mova/` — MOVA red core (`4.0.0-core-draft-1`): global vocabulary, ds/env schemas, and catalog manifests (read-only).
- `skills/` — yellow layer skills such as `mova_template`, `context7_docs`, and `mova_lab_operator`.
- `lab/` — green layer experiments, including `skills_registry_v1.json` and example skill runs.
- `tools/` — validation and planning utilities.

## Core notes
- `core/mova/00_MANIFEST.json` pins the MOVA core version and catalog references.
- Global vocabulary, data schemas (`ds.*`), envelopes (`env.*`), and example episodes live under the `core/mova` tree.

## Skill layer highlights
- `mova_template` demonstrates folder structure, manifests, schemas, cases, episodes, and implementation layout.
- `context7_docs` provides an MCP binding to Context7.
- `mova_lab_operator` guides IDE agents through the lab registry and episode policy.

## Experiment layer highlights
- Experiments and smoke flows live under `lab/` with deterministic recipes.
- The skills registry indexes available skills and bindings for use by operators and agents.
