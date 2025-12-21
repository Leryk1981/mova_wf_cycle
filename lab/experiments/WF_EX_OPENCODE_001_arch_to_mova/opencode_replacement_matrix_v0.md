# OpenCode → MOVA replacement matrix (v0)

| Component | Keep as-is | Wrap in MOVA | Replace with deterministic code | Notes / Evidence path |
|---|---:|---:|---:|---|
| AGENTS.md rules |  | ✅ |  | Map to `instruction_profile` + compiled human facade. Evidence: `AGENTS.md`, `packages/opencode/AGENTS.md`, `packages/opencode/src/agent/agent.ts` |
| Config loader | ✅ |  |  | Keep hierarchical config merge logic (global → .opencode/ → root → env → flags). Evidence: `packages/opencode/src/config/config.ts` |
| Tool registry | ✅ | ✅ |  | Keep registry structure, wrap with MOVA policy gate. Evidence: `packages/opencode/src/tool/registry.ts` |
| MCP integration | ✅ | ✅ |  | Keep MCP client (stdio/SSE/HTTP transports), wrap tool exposure via MOVA envelopes. Evidence: `packages/opencode/src/mcp/index.ts` |
| Agent permission model |  | ✅ | ✅ | Replace runtime permission checks with compiled `policy.json` + deterministic executor enforcement. Permissions: allow/deny/ask with glob patterns for bash. Evidence: `packages/opencode/src/agent/agent.ts` (permission object) |
| Execution loop |  | ✅ | ✅ | Move tool execution "hands" to deterministic code, model = planner only. Evidence: `packages/opencode/src/server/server.ts` (session handling), `packages/opencode/src/tool/*.ts` (tool implementations) |
| Session management | ✅ | ✅ |  | Keep session state structure, wrap with MOVA episode/provenance. Evidence: `packages/opencode/src/session/` |
| Session compaction | ✅ |  |  | Keep compaction logic (reduces token usage). Evidence: `packages/opencode/src/session/compaction.ts` |
| LSP integration | ✅ |  |  | Keep LSP server as-is (read-only code intelligence). Evidence: `packages/opencode/src/lsp/server.ts` |
| Project/Instance context | ✅ | ✅ |  | Keep instance management, wrap with MOVA `ds.project` envelope (not env.*, as it's context not action). Evidence: `packages/opencode/src/project/instance.ts` |
| Server API (HTTP/SSE) | ✅ |  |  | Keep server infrastructure (REST + SSE streaming via `GET /event`), use for MOVA executor API. Evidence: `packages/opencode/src/server/server.ts` |
| SSE streaming | ✅ |  |  | Keep SSE implementation (`GET /event` with events: server.connected, session.updated, message.part.updated, tool.execute, tool.result, file.edited). Evidence: `packages/opencode/src/server/server.ts` |

## Key decisions

- **Keep**: Infrastructure that works (config merge order, LSP, server, SSE, project context, session compaction)
- **Wrap**: Add MOVA envelopes/provenance without changing core logic (tool registry → ds.tools, MCP → ds.mcp, session → ds.session + env.episode_store)
- **Replace**: Move permission enforcement and tool execution from model to deterministic executor (permissions → policy.json, tool execution → env.tool_run)

## MOVA envelope normalization

- **ds.* (data structures)**: Read-only context/state (ds.project, ds.session, ds.tools, ds.config, ds.lsp, ds.mcp)
- **env.* (speech-acts)**: Actions/requests (env.tool_run, env.session_message, env.policy_check, env.episode_store, env.session_fork, env.session_revert)
