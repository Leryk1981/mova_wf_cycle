# MOVA WF winner pack build (wrapper)
1. Use this when you must assemble the WF cycle winner pack bundle for downstream publication.
2. Input contract: `skills/wf_cycle_winner_pack_basic/mova/ds/ds.wf_cycle_winner_pack_request_v1.schema.json`.
3. Expected output JSON: `skills/wf_cycle_winner_pack_basic/mova/ds/ds.wf_cycle_winner_pack_result_v1.schema.json`.
4. Run command: `node .codex/skills/mova_wf_cycle_winner_pack_basic/scripts/run.mjs --request pack_request.json`.
5. The wrapper runs `skills/wf_cycle_winner_pack_basic/impl/bindings/node/build_winner_pack.mjs` using the repo root as CWD.
6. Capture produced archives and screenshots under the `artifacts` block of the result payload so later operators can rehydrate them.
7. If the CLI emits human-readable instructions, copy them into the `notes` section of the result JSON to preserve rationale.
8. When the pack requires extra prompts, document them inline with the `steps` array in the request file to keep agents aligned.
9. Attach cross-links to lab inventory docs describing why this pack is the winner to avoid orphan deliverables.
10. On failure, mark the schema `status` as `error`, include stderr, and open a MOVA ticket before rerunning.
