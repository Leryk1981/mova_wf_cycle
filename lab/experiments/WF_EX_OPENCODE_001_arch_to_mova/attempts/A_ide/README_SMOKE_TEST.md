# OpenCode Tool Run Smoke Test

## Prerequisites

1. OpenCode server must be running on `http://127.0.0.1:4096`
2. To start server (in separate terminal):
   ```bash
   cd tmp/external/opencode/packages/opencode
   bun install  # if dependencies not installed
   bun run src/index.ts serve --port 4096 --hostname 127.0.0.1
   ```

## Running the Test

```bash
node lab/experiments/WF_EX_OPENCODE_001_arch_to_mova/attempts/A_ide/scripts/mova_tool_run_via_opencode_v0.mjs \
  --baseUrl=http://127.0.0.1:4096 \
  --in=lab/experiments/WF_EX_OPENCODE_001_arch_to_mova/attempts/A_ide/inputs/mova_tool_run_request_v0.json \
  --out=lab/experiments/WF_EX_OPENCODE_001_arch_to_mova/attempts/A_ide/outputs/mova_env_tool_run_response_v0.json
```

## Expected Outputs

- `outputs/opencode_tool_list_v0.json` - List of available tools
- `outputs/mova_env_tool_run_response_v0.json` - MOVA-compliant response
- `logs/opencode_http_trace_v0.jsonl` - HTTP request/response trace
- `logs/opencode_sse_events_v0.log` - SSE events including tool.execute and tool.result

## Success Criteria

- GET /experimental/tool/ids returns tool list
- Tool execution completes (read README.md)
- SSE events contain tool.execute and tool.result

