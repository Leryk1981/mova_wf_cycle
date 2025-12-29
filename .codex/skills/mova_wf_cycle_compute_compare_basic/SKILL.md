# MOVA WF compute vs baseline (wrapper)
1. Invoke when you must compare fresh wf_cycle outputs against baseline artifacts for guardrail sign-off.
2. Prepare inputs following `skills/wf_cycle_compute_compare_basic/mova/ds/ds.wf_cycle_compare_request_v1.schema.json`.
3. Launch via `node .codex/skills/mova_wf_cycle_compute_compare_basic/scripts/run.mjs --request data.json`.
4. The wrapper calls `skills/wf_cycle_compute_compare_basic/impl/bindings/node/compute_compare.mjs` with no alterations.
5. Capture results that align with `skills/wf_cycle_compute_compare_basic/mova/ds/ds.wf_cycle_compare_result_v1.schema.json`.
6. Provide filesystem references for diff artifacts (screens, text exports) inside the `attachments` field of the result payload.
7. When the CLI signals errors, surface stderr and mark the run as `status: fail` inside the result schema before retrying.
8. This skill does not ship env schemas, so treat stdout/stderr plus the request/result pair as the full audit surface.
9. The compute compare step frequently reads large packs; ensure local caches are fresh to keep runtime under 2 minutes.
10. Always link the compare evidence into the WF cycle decision record before closing the gate.
