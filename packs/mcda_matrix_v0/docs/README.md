# MCDA Matrix v0 pack

This pack defines minimal data structures for MCDA (multi-criteria decision analysis) matrix scoring.

What this is (Excel-style MCDA, testable & auditable)
- Decision matrix inputs similar to spreadsheet MCDA tables (alternatives x criteria).
- Deterministic scoring with auditable breakdown per criterion.

Supported in v0
- Method: WSM (Weighted Sum Model)
- Normalization: MIN_MAX
- Auto-normalize: AUTO_NORMALIZE flag
- Constraints: simple feasibility limits

Not supported in v0
- TOPSIS
- AHP

Schemas
- Alternatives, Criteria, Evaluations, Constraints
- Problem definition
- Method config (fixed WSM + MIN_MAX + AUTO_NORMALIZE)
- Score request env + score result ds

How to run demo
```
npm run demo:mcda_matrix
```

Where to find reports and example result
- Station receipt: artifacts/station_cycle/<run_id>/
- Vendored quality reports: pos_report.json, neg_report.json in the station_cycle run folder.
- Example result payload: packs/mcda_matrix_v0/examples/pos/mcda_score_result_small_v0.json

What is proven
- Pos/neg quality suites with deterministic outputs.
- Determinism (repeatable results for identical inputs).
- Breakdown explainability (sum of weighted contributions equals score).

Stability promises
- Stable: problem schema, score result schema, demo command (`npm run demo:mcda_matrix`).
- May change: internal artifact layouts, Markdown report formatting.

Pitch
- Excel-style decision matrix, but engineered: versioned contracts + deterministic runtime + pos/neg test suite + auditable artifacts.
- Deterministic WSM + MIN_MAX with explainable breakdown per criterion.
- Proof via station_cycle receipts and vendored reports.
- No TOPSIS/AHP or domain integrations in v0.
