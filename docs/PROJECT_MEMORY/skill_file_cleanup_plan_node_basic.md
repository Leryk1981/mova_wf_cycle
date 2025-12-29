# skill.file_cleanup_plan_node_basic — notes (archive)

Archived notes for the planner companion to file cleanup:
- Input: `env.file_cleanup_plan_request_v1`; output: `ds.file_cleanup_plan_v1`.
- Applies simple heuristics to suggest keep/delete/archive/ask actions without touching the filesystem.
- Intended to consume snapshots from `skill.file_cleanup_snapshot_node_basic`.
