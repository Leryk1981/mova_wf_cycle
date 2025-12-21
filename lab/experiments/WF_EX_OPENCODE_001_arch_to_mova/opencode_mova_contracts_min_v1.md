# Minimal MOVA Contracts for OpenCode Executor (v1)

## Data Schemas (ds.*)
- ds.opencode_repo_ref_v1 (repo + commit + clone path)
- ds.opencode_project_context_v1 (project root, allowlisted paths, runtime info)
- ds.opencode_session_state_ref_v1 (session id + storage refs, no secrets)
- ds.tool_call_provenance_v1 (tool_id, args_hash, start/end, cwd, env_redaction)
- ds.tool_result_provenance_v1 (exit_code, stdout/stderr refs, produced artifacts refs)
- ds.policy_profile_v1 (allow/deny/approve rules, scopes, limits)
- ds.instruction_profile_v1 (planner guidance; human/model/log channels)
- ds.security_event_episode_v1 (allow/deny decisions + evidence)

## Envelopes (env.* speech-acts)
- env.policy_check_request_v1 / response_v1
- env.tool_run_request_v1 / response_v1
- env.session_message_request_v1 / response_v1 (planner step, returns tool_call proposals)
- env.episode_store_request_v1 / response_v1
- (optional) env.session_fork_request_v1, env.session_revert_request_v1

## Notes
- ds.* are state/context; env.* are actions/requests/responses.
- The executor MUST reject any tool execution not explicitly allowed by policy_profile.
