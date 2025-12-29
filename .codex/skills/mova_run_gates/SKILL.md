# MOVA run gates (wrapper)
1. Trigger this when codex changes must clear validation, unit, and smoke gates before merge.
2. From repo root run: `npm run validate`, `npm test`, `npm run smoke:wf_cycle` in that order; the wrapper just orchestrates and aggregates their logs.
3. Until an env schema lands, record results in `env.run_gates_report_v1` with three fixed sections: `validate`, `test`, `smoke`.
4. Each section must specify PASS/FAIL, duration, log path, and blocking issues.
5. If a command exits non-zero, stop the sequence, mark downstream gates as `skipped`, and capture the failing stdout/stderr path.
6. Use this wrapper whenever Ops requests “fresh gates” evidence or before opening a release PR.
7. Attach summarized timings plus the env report to docs/PROJECT_MEMORY as proof.
8. Rerun only after addressing the failure cause; note the remediation commit in the report.
9. This skill is prompt-first, so provide shell traces inline if automation is unavailable on the current host.
10. Keep reports under source control when the gates guard production deploys.
