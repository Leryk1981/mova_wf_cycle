# skill.file_cleanup_plan_node_basic

Baseline file_cleanup planner (no deletions).
- Input: `env.file_cleanup_plan_request_v1` (snapshot + preferences).
- Output: `ds.file_cleanup_plan_v1` (action per file: keep/delete/archive/ask, with reason and summary).
- Logic: reads the snapshot, applies simple rules (installers/archives in Downloads, stale Desktop files, large old videos → archive/delete; documents keep; other files ask), and produces a plan. It does not change the file system.
