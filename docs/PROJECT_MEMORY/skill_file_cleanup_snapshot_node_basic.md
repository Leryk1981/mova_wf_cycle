# skill.file_cleanup_snapshot_node_basic — notes (archive)

This archive captured the first notes for the `file_cleanup_snapshot_node_basic` skill.

Highlights:
- Input: `env.file_cleanup_snapshot_request_v1`; output: `ds.file_cleanup_snapshot_v1`.
- Scans a target path recursively and collects metadata without mutating files.
- Pairs with `skill.file_cleanup_plan_node_basic` for planning follow-up actions.
