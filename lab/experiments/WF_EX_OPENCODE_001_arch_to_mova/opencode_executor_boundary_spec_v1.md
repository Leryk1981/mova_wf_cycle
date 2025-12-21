# OpenCode as MOVA Executor — Boundary Spec v1

## Purpose
Define a strict boundary: **model proposes** (plan/next action), **code executes** (tools), under MOVA contracts.

## Roles
- Operator (human): sets scope/policy, approves when required.
- Planner (model): generates plan steps and tool_call proposals; cannot execute.
- Executor (code): validates + enforces policy + executes tools + produces tool_result + writes episodes.

## Invariants (MUST)
1) Code executes code. The model never runs tools directly.
2) Every action request is a validated envelope (env.*).
3) Every tool call is policy-checked before execution.
4) Every execution yields evidence + episode (provenance).

## Executor Loop (canonical)
1) Receive env.* request
2) AJV validate (ds/env)
3) Policy check (allow/deny/approve)
4) If approved: execute tool calls (deterministic)
5) Collect tool_result + artifacts refs
6) Write episode (security/audit/provenance)
7) Return env.* response

## Mapping to OpenCode (as-is evidence)
- Server transport: packages/opencode/src/server/server.ts (REST + SSE /event)
- Serve entrypoint: packages/opencode/src/cli/cmd/serve.ts
- Attach flow: packages/opencode/src/cli/cmd/tui/attach.ts
- Agent permissions: packages/opencode/src/agent/agent.ts (allow/deny/ask)
- Tool registry: packages/opencode/src/tool/registry.ts
- MCP: packages/opencode/src/mcp/index.ts
- Config merge: packages/opencode/src/config/config.ts
- Session/compaction/snapshot: packages/opencode/src/session/*, packages/opencode/src/session/compaction.ts, packages/opencode/src/snapshot/*

## What MOVA replaces / wraps
- AGENTS.md => MOVA instruction_profile (source of truth) + optional compiled AGENTS.md facade
- allow/deny/ask => MOVA policy_profile + deterministic enforcement gate
- execution loop => deterministic executor loop; model limited to plan/proposals

## Evidence requirements
- Input repo commit pinned (opencode_input.json)
- tool_call + tool_result captured (stdout/stderr/exit_code + artifact refs)
- gates recorded (validate/test/smoke when applicable)
- episode stored with references

## Planner vs Orchestrator Contract

**Planner** produces `env.planner_plan_v0` containing only action proposals (no execution results).
Plan steps reference `env.tool_run_request_v1` operations with tool_id and args, but never include stdout, stderr, exit_code, artifacts, or tool_result.

**Orchestrator** receives the plan and executes steps sequentially via adapter (policy-gated).
Each step is validated against policy_profile before execution, and only approved steps are forwarded to executor engine.

**Executor engine** (e.g., OpenCode) runs commands deterministically and returns tool results.
Evidence collection and episode writing occur only in the execution phase, never in planning.

**No-exec guarantee:** Planner output must pass validation that confirms absence of execution artifacts.
