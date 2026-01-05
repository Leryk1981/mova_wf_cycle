# Public Proof Kit — MCDA Matrix v0

What it is
- Excel-style decision matrix, but engineered: versioned contracts + deterministic runtime + pos/neg test suite + auditable artifacts.
- Матрица решений как в Excel, но как софт: контракты, детерминированный расчёт, тесты, регрессии и квитанции.

One-command demo
- `npm run demo:mcda_matrix`
- Evidence lands in `artifacts/station_cycle/<run_id>/` (example: `artifacts/station_cycle/<run_id>/quality_mcda_matrix_<run_id>_pos_report.json`).

What is proven
- Pos/neg suites (PASS/FAIL is intentional and reproducible).
- Determinism (same input -> same result, bit-for-bit).
- Breakdown explainability (sum of weighted contributions equals score).
- Audit artifacts: vendored reports in station_cycle output.

What is NOT included
- No TOPSIS/AHP.
- No domain integration or external data connectors.

Why it matters
- Testable decision logic that can be reviewed, versioned, and regression-checked.

One-liner for a post
- If your decision logic can’t pass a negative test suite, it’s not decision logic — it’s vibes.
