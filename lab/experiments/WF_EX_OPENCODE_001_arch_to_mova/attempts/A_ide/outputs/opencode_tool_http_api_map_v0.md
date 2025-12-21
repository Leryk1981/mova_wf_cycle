# OpenCode Tool HTTP API Map (v0)

**Evidence:** `tmp/external/opencode/packages/opencode/src/server/server.ts`

## Base Routes

### GET /experimental/tool/ids
- **Line:** 414-435
- **Method:** GET
- **Description:** List all available tool IDs (built-in + dynamically registered)
- **Request:** None
- **Response:** `string[]` (array of tool ID strings)
- **Example:** `["read", "write", "edit", "bash", ...]`

### GET /experimental/tool
- **Line:** 437-487
- **Method:** GET
- **Query Parameters:**
  - `provider` (string, required)
  - `model` (string, required)
- **Description:** Get list of available tools with JSON schema parameters for specific provider/model
- **Request:** Query params only
- **Response:** `ToolListItem[]` where each item has:
  - `id` (string)
  - `description` (string)
  - `parameters` (any) - JSON schema
- **Example Response:**
  ```json
  [
    {
      "id": "read",
      "description": "Read file contents",
      "parameters": { "type": "object", "properties": { "path": { "type": "string" } } }
    }
  ]
  ```

## Tool Execution (via Session)

Tools are executed indirectly through session messages. The model in a session decides to call tools based on user messages.

### POST /session/:sessionID/message
- **Line:** 1180-1220
- **Method:** POST
- **Path Parameter:** `sessionID` (string)
- **Request Body:** `SessionPrompt.PromptInput` (omitting sessionID)
- **Description:** Send message to session, AI responds and may call tools
- **Response:** Streamed JSON with `{ info: MessageV2.Assistant, parts: MessageV2.Part[] }`
- **Tool Execution:** Tools are executed as part of AI response, events emitted via SSE `/event`

### GET /event
- **Line:** 99-151 (SSE stream)
- **Method:** GET
- **Description:** Server-Sent Events stream for real-time updates
- **Response:** SSE stream with events:
  - `server.connected` - initial connection
  - `session.updated` - session progress
  - `message.part.updated` - message parts
  - `tool.execute` - tool execution started
  - `tool.result` - tool execution completed
  - `file.edited` - file changes

## Notes

- Direct tool execution endpoint does not exist in OpenCode API
- Tools are executed by AI model within session context
- Tool execution events are observable via SSE `/event` stream
- Tool list requires provider/model query params (even if not used for execution)

