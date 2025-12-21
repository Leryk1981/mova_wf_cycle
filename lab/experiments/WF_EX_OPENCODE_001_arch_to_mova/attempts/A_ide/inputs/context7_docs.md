# Context7 docs (raw)

## Query 1: "sst opencode" / "opencode ai" architecture

### Server Architecture: REST endpoints + Streaming

**Evidence paths:**
- `packages/opencode/src/server/server.ts` - Main server implementation (Hono-based)
- `packages/opencode/src/cli/cmd/serve.ts` - Server entry point

**REST Endpoints:**
- `POST /session` - Create new session
- `POST /session/{id}/message` - Send message to session
- `GET /session` - List all sessions
- `GET /session/{id}` - Get session details (cost, stats)
- `POST /session/{id}/fork` - Fork session at specific message
- `POST /session/{id}/abort` - Abort running session
- `POST /session/{id}/revert` - Revert file changes
- `POST /session/{id}/share` - Share session publicly
- `GET /session/{id}/diff` - Get session diff summary
- `GET /session/{id}/children` - List child sessions
- `POST /session/{id}/summarize` - Generate session summary
- `GET /project` - Project management endpoints
- `GET /tool` - Tool-related endpoints
- `GET /mcp` - MCP server endpoints
- `GET /global/event` - Global event bus

**Streaming:**
- `GET /event` - Server-Sent Events (SSE) stream for real-time updates
  - First event: `server.connected`
  - Subsequent events: bus events (session.updated, message.part.updated, tool.execute, tool.result, file.edited)
- WebSocket support for TUI client

**Event Types:**
- `session.updated` - Session progress and cost info
- `message.part.updated` - Text parts of AI messages
- `tool.execute` - Tool execution details
- `tool.result` - Tool execution output
- `file.edited` - File change notifications

### Client Attach Flow

**Evidence paths:**
- `packages/opencode/src/cli/cmd/tui/attach.ts` - TUI attach implementation

**Flow:**
1. User runs `opencode attach <url>` (e.g., `http://localhost:4096`)
2. Client connects to server via WebSocket/SSE
3. Server creates/loads session
4. TUI renders interactive interface
5. User messages sent via WebSocket/SSE
6. Server streams responses back

**SDK Client Creation:**
```typescript
// Create server and client together
const { client, server } = await createOpencode({
  port: 4096,
  hostname: "127.0.0.1"
})

// Or connect to existing server
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096"
})
```

## Query 2: Agent profiles + permission model

**Evidence paths:**
- `packages/opencode/src/agent/agent.ts` - Agent profile definitions

**Agent Profiles:**
1. **build** (default, primary agent)
   - Full access: `edit: allow`, `bash: allow`
   - Mode: `primary`
   - Native: `true`

2. **plan** (read-only agent)
   - `edit: deny`
   - `bash: ask` (with specific allow patterns for read-only commands like `git diff*`, `git log*`, `find *`, `grep*`, `ls*`, etc.)
   - Mode: `primary`
   - Native: `true`
   - Ideal for exploring unfamiliar codebases or planning changes

3. **general** (subagent)
   - Description: "General-purpose agent for researching complex questions and executing multi-step tasks"
   - Tools: `todoread: false`, `todowrite: false` (disabled)
   - Mode: `subagent`
   - Native: `true`
   - Hidden: `true`
   - Invoked using `@general` in messages

4. **explore** (read-only exploration)
   - Tools: `todoread: false`, `todowrite: false`, `edit: false`, `write: false`
   - Mode: `subagent`
   - Native: `true`

**Permission Model:**
- Values: `allow`, `deny`, `ask`
- Permission types:
  - `edit` - File editing permission
  - `bash` - Bash command permission (supports glob patterns, e.g., `"git *": "ask"`, `"*": "allow"`)
  - `webfetch` - Web fetching permission
  - `doom_loop` - Doom loop protection
  - `external_directory` - External directory access

**Permission Hierarchy:**
- Global permissions (in `opencode.jsonc`)
- Agent-specific permissions override global
- Specific bash command patterns override wildcards

**Example Config:**
```json
{
  "permission": {
    "edit": "allow",
    "bash": {
      "git push": "ask",
      "*": "allow"
    },
    "webfetch": "deny"
  },
  "agent": {
    "build": {
      "permission": {
        "edit": "ask",
        "bash": {
          "git push": "allow"
        }
      }
    }
  }
}
```

## Query 3: Tool registry + MCP tools

**Evidence paths:**
- `packages/opencode/src/tool/registry.ts` - Tool registry implementation
- `packages/opencode/src/tool/` - Built-in tool implementations
- `packages/opencode/src/mcp/index.ts` - MCP integration

**Built-in Tools:**
- `bash` - Execute bash commands
- `read` - Read files
- `write` - Write files
- `edit` - Edit files
- `grep` - Search files
- `glob` - File globbing
- `ls` (list) - List files/directories
- `task` - Task management
- `todo` (todoread, todowrite) - Todo list operations
- `webfetch` - Fetch web content
- `websearch` - Web search
- `codesearch` - Code search
- `multiedit` - Multi-file editing
- `patch` - Apply patches
- `lsp-hover` - LSP hover information
- `lsp-diagnostics` - LSP diagnostics
- `batch` - Batch operations
- `invalid` - Invalid tool handler

**Custom Tools:**
- Loaded from `tool/*.{js,ts}` files in config directories (`.opencode/`, project root)
- Tools exported from TypeScript/JavaScript files
- Format: `<filename>_<exportname>` for multiple exports

**MCP Tools:**
- MCP (Model Context Protocol) server integration
- Transports: `stdio`, `SSE`, `streamable-http`
- MCP servers defined in `opencode.jsonc`:
  ```json
  {
    "mcp": {
      "my-mcp": {
        "type": "local",
        "command": ["bun", "x", "my-mcp-command"]
      },
      "context7": {
        "type": "remote",
        "url": "https://mcp.context7.com/mcp"
      }
    }
  }
  ```
- MCP tools registered in tool registry alongside built-in tools
- Can be enabled/disabled per agent using wildcards: `"my-mcp*": true/false`

**Plugin Tools:**
- Defined via `@opencode-ai/plugin` package
- Tools can be defined in plugin files

**Tool Enable/Disable:**
- Global: `"tools": { "write": false, "bash": false }`
- Per-agent: `"agent": { "plan": { "tools": { "write": false } } }`
- Wildcards: `"mymcp_*": false`

## Query 4: Config hierarchy merge order

**Evidence paths:**
- `packages/opencode/src/config/config.ts` - Config system implementation

**Merge Order (hierarchical, later overrides earlier):**
1. Global config directory (`~/.opencode/opencode.jsonc`)
2. Project `.opencode/opencode.jsonc` (walking up from project root to worktree)
3. Project root `opencode.jsonc` (walking up from project root to worktree)
4. Environment variable `OPENCODE_CONFIG_CONTENT` (JSON content)
5. Well-known configs (from `/.well-known/opencode` endpoints for authenticated providers)
6. Flag `OPENCODE_CONFIG` (custom config file path)
7. Flag `OPENCODE_CONFIG_DIR` (custom config directory)

**Config File Priority:**
- `opencode.jsonc` preferred over `opencode.json`
- Both checked in each directory level

**Plugin Array Merging:**
- Custom merge function concatenates plugin arrays instead of replacing
- Plugin deduplication via Set

**Config Structure:**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": { "providerID": "...", "modelID": "..." },
  "agent": { "build": { ... }, "plan": { ... } },
  "tools": { "write": true, "bash": true },
  "permission": { "edit": "allow", ... },
  "mcp": { ... },
  "lsp": { ... },
  "plugin": [ ... ]
}
```

## Query 5: Session state + compaction + snapshots

**Evidence paths:**
- `packages/opencode/src/session/` - Session management
- `packages/opencode/src/session/compaction.ts` - Session compaction
- `packages/opencode/src/snapshot/` - Project snapshots

**Session State:**
- Session ID (unique identifier)
- Message history (user + assistant + tool calls)
- Tool execution results
- Session metadata (cost, stats, status)
- Child sessions (forked sessions)
- Revert state (which messages/files were reverted)

**Session Compaction:**
- Reduces token usage by compacting message history
- Compaction prompts: `packages/opencode/src/agent/prompt/compaction.txt`
- Compacts older messages while preserving context

**Session Artifacts:**
- Session summary (generated via `/session/{id}/summarize`)
- Session diff (file changes summary via `/session/{id}/diff`)
- Session sharing (public URL via `/session/{id}/share`)

**Project Snapshots:**
- File tree snapshots for context
- Used for understanding project structure
- Stored in `packages/opencode/src/snapshot/`

**Session Operations:**
- `POST /session/{id}/fork` - Fork at specific message
- `POST /session/{id}/revert` - Revert file changes
- `POST /session/{id}/unrevert` - Restore reverted messages
- `POST /session/{id}/abort` - Abort running session
- `GET /session/{id}/children` - List child sessions
- `POST /session/{id}/summarize` - Generate summary

**Session API Examples:**
```bash
# Create session
POST /session
{
  "agent": "build",
  "model": { "providerID": "anthropic", "modelID": "claude-3-5-sonnet-20241022" }
}

# Send message
POST /session/{id}/message
{
  "parts": [
    { "type": "text", "text": "..." },
    { "type": "file", "url": "file:///path/to/file.ts" }
  ]
}

# Revert files
POST /session/{id}/revert
{
  "files": ["/path/to/file1.ts", "/path/to/file2.ts"]
}
```

## Summary

**Key Architecture Facts:**
1. **Server**: Hono-based HTTP server with REST API + WebSocket/SSE streaming
2. **Client**: TUI attaches via `attach` command, connects via WebSocket/SSE
3. **Agents**: build (full access), plan (read-only), general (subagent), explore (read-only)
4. **Permissions**: allow/deny/ask with glob patterns for bash commands
5. **Tools**: Built-in + custom (tool/*.ts) + MCP + plugin tools
6. **Config**: Hierarchical merge (global → .opencode/ → root → env → flags)
7. **Session**: State management with compaction, snapshots, fork/revert operations
