# MOVA repo snapshot (wrapper)
1. Use when you need a deterministic dump of the current repo plus MOVA memory context before planning other workstreams.
2. Always supply a request payload shaped like `skills/repo_snapshot_basic/mova/ds/ds.repo_snapshot_request_v1.schema.json` and capture the response using `skills/repo_snapshot_basic/mova/ds/ds.repo_snapshot_result_v1.schema.json`.
3. Run the binding through Node to avoid reimplementing the CLI: `node .codex/skills/mova_repo_snapshot_basic/scripts/run.mjs --request path/to/request.json`.
4. The wrapper simply replays `skills/repo_snapshot_basic/impl/bindings/node/cli.mjs` inside the repo, so the working directory must be the repo root.
5. Outputs land as JSON alongside any filesystem artifacts declared in `skills/repo_snapshot_basic/mova/env/env.repo_snapshot_run_v1.schema.json`.
6. Populate that env document (paths, timestamps, commit hashes) for traceability; attach it plus the raw CLI stdout to evidence.
7. Expected latency is a few seconds; fail fast if the CLI returns non-zero and include the stderr excerpt above the env block.
8. If you need to pinch repo state mid-run, rerun with `--force` and clearly version the resulting env dataset.
9. Downstream tools expect attachments zipped with the `repo_snapshot_result` payload, so do not rename keys without updating consumers.
10. Document any manual edits to the working copy inside `env.repo_snapshot_run_v1.schema.json` under `notes`.
11. Close the loop by listing the produced evidence files inside MOVA inventory docs before continuing the workflow.
