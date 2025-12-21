# OpenCode → MOVA mapping (as-is)

**Input:**
- opencode commit: `11b3927dc239160e718a37a57ca9463499b6e589` (see opencode_input.json)
- repo sources: README + key files list (see opencode_ls_files_hits.txt)
- Context7 docs: see `attempts/A_ide/inputs/context7_docs.md`

## 1) OpenCode components (as-is)

### Clients
- **TUI client** (`packages/opencode/src/cli/cmd/tui/attach.ts`): Terminal UI, attaches to server via URL
- **Web client** (`packages/console/app/`): Browser-based console interface
- **Desktop client** (`packages/desktop/`): Tauri-based desktop app
- **VSCode extension** (`sdks/vscode/`): IDE integration

### Server
- **Headless server** (`packages/opencode/src/server/server.ts`): Hono-based HTTP server
  - REST API endpoints: `/session`, `/project`, `/tool`, `/mcp`, `/global/event`
  - SSE streaming (`GET /event`) for real-time TUI
  - Entry: `packages/opencode/src/cli/cmd/serve.ts`

### Agent profiles
- **build** (`packages/opencode/src/agent/agent.ts`): Default, full access (edit: allow, bash: allow)
- **plan** (`packages/opencode/src/agent/agent.ts`): Read-only (edit: deny, bash: ask)
- **general** (`packages/opencode/src/agent/agent.ts`): Subagent for complex multi-step tasks
- **explore** (`packages/opencode/src/agent/agent.ts`): Read-only exploration (no edit/write)

### Tools registry + MCP
- **Built-in tools** (`packages/opencode/src/tool/`): bash, read, write, edit, grep, glob, ls, task, todo, webfetch, websearch, codesearch, multiedit, patch, lsp-hover, lsp-diagnostics, batch
- **Custom tools** (`packages/opencode/src/tool/registry.ts`): Loaded from `tool/*.{js,ts}` in config directories
- **MCP tools** (`packages/opencode/src/mcp/index.ts`): External tools via Model Context Protocol (stdio/SSE/HTTP transports)
- **Plugin tools** (`packages/plugin/`): Plugin-defined tools

### Config + rules
- **opencode.jsonc** (`packages/opencode/src/config/config.ts`): Hierarchical config (global → .opencode/ → root → env)
- **AGENTS.md** (`AGENTS.md`, `packages/opencode/AGENTS.md`): Agent behavior documentation/rules
- **Agent permissions** (`packages/opencode/src/agent/agent.ts`): Per-agent permissions (edit, bash, webfetch, doom_loop, external_directory)

## 2) Data/control flows (as-is)

### Interactive flow (TUI)
1. User runs `opencode attach <url>`
2. Client connects to server via SSE
3. Server creates/loads session
4. User types message in TUI
5. Client sends message to server
6. Server routes to agent, executes tools, streams responses
7. Client renders in TUI

**Evidence:** `packages/opencode/src/cli/cmd/tui/attach.ts`, `packages/opencode/src/server/server.ts`

### Headless API flow
1. Client sends HTTP POST to `/session` endpoint
2. Server creates session, processes message
3. Server executes agent with tools
4. Server returns response (JSON or SSE stream)

**Evidence:** `packages/opencode/src/server/server.ts`

### Tool execution flow
1. Agent decides tool call from available tools (built-in + custom + MCP + plugin)
2. Tool Registry resolves tool definition (`packages/opencode/src/tool/registry.ts`)
3. Tool executes (file ops, bash, web, etc.)
4. Result returned to agent for next step/response

**Evidence:** `packages/opencode/src/tool/registry.ts`, `packages/opencode/src/tool/*.ts`

### MCP tool flow
1. Config defines MCP servers in `opencode.jsonc`
2. MCP connects via stdio/SSE/HTTP transport (`packages/opencode/src/mcp/index.ts`)
3. MCP registers tools/resources
4. Tool Registry includes MCP tools in available set
5. Agent can call MCP tools like built-in tools

**Evidence:** `packages/opencode/src/mcp/index.ts`, `packages/opencode/src/config/config.ts`

## 3) MOVA mapping (proposed)

### instruction_profile
**OpenCode equivalent:** Agent system prompts + generation prompts
- **Location:** `packages/opencode/src/agent/prompt/`, `packages/opencode/src/agent/generate.txt`
- **MOVA mapping:** `instruction_profile` should capture:
  - Agent role/system prompt (build vs plan vs explore)
  - Tool calling instructions
  - Permission constraints
  - Model parameters (temperature, topP) per agent

**Deterministic executor:** Load instruction_profile from config/agent definition
**Model responsibility:** Follow instruction_profile when generating tool calls

### policy_profile
**OpenCode equivalent:** Agent permissions + tool enable/disable
- **Location:** `packages/opencode/src/agent/agent.ts` (permission object), `packages/opencode/src/config/config.ts`
- **MOVA mapping:** `policy_profile` should capture:
  - Edit permission (allow/deny/ask)
  - Bash command patterns (allow/deny/ask per pattern)
  - Web fetch permission
  - Doom loop protection
  - External directory access
  - Tool enable/disable per agent

**Deterministic executor:** Enforce policy_profile before executing tool calls
**Model responsibility:** None (policy is deterministic enforcement)

### ds.* (data structures / context / state)
**OpenCode equivalent:** Project context + session state + tool registry + config
- **ds.project** (`packages/opencode/src/project/instance.ts`): Project directory, worktree, file tree (read-only context)
- **ds.session** (`packages/opencode/src/session/`): Conversation history, tool call results (read-only context)
- **ds.tools** (`packages/opencode/src/tool/registry.ts`): Available tools registry (read-only context)
- **ds.config** (`packages/opencode/src/config/config.ts`): Merged config (read-only context)
- **ds.lsp** (`packages/opencode/src/lsp/server.ts`): LSP diagnostics/hover (read-only context)
- **ds.mcp** (`packages/opencode/src/mcp/index.ts`): MCP server connections (read-only context)

**Deterministic executor:** Build ds.* from project state, session, registry, config
**Model responsibility:** Use ds.* envelopes for context (read-only)

### env.* (speech-acts / actions / requests)
**OpenCode equivalent:** Tool execution requests, session operations, policy checks
- **env.tool_run** (`packages/opencode/src/tool/*.ts`): Tool execution request (tool name + parameters)
- **env.session_message** (`packages/opencode/src/server/server.ts`): Send message to session (user message parts)
- **env.policy_check** (`packages/opencode/src/agent/agent.ts`): Permission check request (tool + agent + context)
- **env.episode_store** (`packages/opencode/src/session/`): Store episode event (message, tool_call, tool_result)
- **env.session_fork** (`packages/opencode/src/server/server.ts`): Fork session at message
- **env.session_revert** (`packages/opencode/src/server/server.ts`): Revert file changes

**Deterministic executor:** Process env.* requests, execute actions, return results
**Model responsibility:** Generate env.* requests (tool_run, session_message) based on ds.* context

### episode/provenance
**OpenCode equivalent:** Session state + message history
- **Location:** `packages/opencode/src/session/`
- **MOVA mapping:** `episode` should capture:
  - Session ID
  - Message sequence (user + assistant + tool calls)
  - Tool execution results
  - Session compaction history
  - Project snapshot references

**Deterministic executor:** Record episode events via `env.episode_store` (message, tool_call, tool_result)
**Model responsibility:** None (episode is deterministic recording)

### deterministic executor responsibilities
**OpenCode equivalent:** Tool execution + policy enforcement + session management
1. **Tool execution** (`packages/opencode/src/tool/*.ts`): Execute tools (read, write, edit, bash, etc.) via `env.tool_run`
2. **Policy enforcement** (`packages/opencode/src/agent/agent.ts`): Check permissions via `env.policy_check` before executing tool calls
3. **Session management** (`packages/opencode/src/session/`): Store messages, manage state via `env.session_message`, `env.episode_store`
4. **Project context** (`packages/opencode/src/project/instance.ts`): Provide directory/worktree context as `ds.project`
5. **Config loading** (`packages/opencode/src/config/config.ts`): Load and merge configs as `ds.config`
6. **MCP/LSP integration** (`packages/opencode/src/mcp/`, `packages/opencode/src/lsp/`): Connect external services, expose as `ds.mcp`, `ds.lsp`

### model responsibilities (within MOVA)
**OpenCode equivalent:** Agent LLM calls + tool selection
1. **Message generation** (`packages/opencode/src/agent/agent.ts`): Generate assistant responses
2. **Tool selection** (`packages/opencode/src/tool/registry.ts`): Decide which tools to call, generate `env.tool_run`
3. **Tool parameter generation** (`packages/opencode/src/tool/*.ts`): Generate tool call parameters in `env.tool_run`
4. **Context understanding** (`packages/opencode/src/session/`): Use `ds.session` for context
5. **Follow instruction_profile** (`packages/opencode/src/agent/prompt/`): Adhere to agent role/prompts

**Note:** Model does NOT enforce policy (that's deterministic executor's job). Model generates `env.*` requests, executor processes them.

## 4) Evidence (file/path refs)

### Components
- `README.md` - Project overview, installation, agents description
- `AGENTS.md` - Agent behavior rules
- `packages/opencode/src/server/server.ts` - Server implementation (Hono, REST + SSE)
- `packages/opencode/src/cli/cmd/serve.ts` - Server entry point
- `packages/opencode/src/cli/cmd/tui/attach.ts` - TUI client attach command
- `packages/opencode/src/agent/agent.ts` - Agent profile definitions (build, plan, general, explore)
- `packages/opencode/src/tool/registry.ts` - Tool registry (built-in + custom + MCP + plugin)
- `packages/opencode/src/mcp/index.ts` - MCP integration (stdio/SSE/HTTP transports)
- `packages/opencode/src/config/config.ts` - Config system (hierarchical merge)
- `packages/opencode/src/project/instance.ts` - Project/Instance management
- `packages/opencode/src/session/` - Session management
- `packages/opencode/src/lsp/server.ts` - LSP integration

### Interfaces
- `packages/opencode/src/server/server.ts` - HTTP REST API endpoints
- `packages/opencode/src/server/server.ts` - SSE streaming (`GET /event`)
- `packages/opencode/src/mcp/index.ts` - MCP protocol implementation
- `packages/opencode/src/lsp/server.ts` - LSP protocol implementation
- `packages/sdk/js/` - JavaScript SDK

### Flows
- `packages/opencode/src/cli/cmd/tui/attach.ts` - Interactive TUI flow
- `packages/opencode/src/server/server.ts` - Headless API flow
- `packages/opencode/src/tool/registry.ts` - Tool execution flow
- `packages/opencode/src/mcp/index.ts` - MCP tool flow

### Controls
- `packages/opencode/src/agent/agent.ts` - Agent permissions (edit, bash, webfetch, doom_loop, external_directory)
- `packages/opencode/src/config/config.ts` - Tool enable/disable, config hierarchy merge order
- `packages/opencode/src/session/compaction.ts` - Session compaction

### Artifacts
- `packages/opencode/src/session/` - Session state
- `packages/opencode/src/snapshot/` - Project snapshots
- `packages/opencode/src/tool/` - Tool definitions
- `opencode.jsonc`, `.opencode/opencode.jsonc` - Config files
- `AGENTS.md` - Agent rules documentation
- `packages/opencode/src/agent/prompt/` - Agent prompts
