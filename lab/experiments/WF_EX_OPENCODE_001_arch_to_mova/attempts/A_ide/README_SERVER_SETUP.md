# OpenCode Server Setup for Smoke Test

## Prerequisites

1. **Bun runtime** must be installed
   - Check: `bun --version`
   - Install: https://bun.sh

2. **OpenCode dependencies** must be installed
   ```bash
   cd tmp/external/opencode/packages/opencode
   bun install
   ```

## Starting the Server

**Terminal A:**
```bash
cd tmp/external/opencode/packages/opencode
bun run src/index.ts serve --port 4096 --hostname 127.0.0.1
```

Expected output:
```
opencode server listening on http://127.0.0.1:4096
```

## Running the Smoke Test

**Terminal B:**
```bash
cd D:\Projects_Clean\mova_skills_lab
node lab/experiments/WF_EX_OPENCODE_001_arch_to_mova/attempts/A_ide/scripts/mova_tool_run_via_opencode_v0.mjs \
  --baseUrl http://127.0.0.1:4096 \
  --in lab/experiments/WF_EX_OPENCODE_001_arch_to_mova/attempts/A_ide/inputs/mova_tool_run_request_v0.json \
  --out lab/experiments/WF_EX_OPENCODE_001_arch_to_mova/attempts/A_ide/outputs/mova_env_tool_run_response_v0.json
```

## Expected Outputs

- `outputs/opencode_tool_list_v0.json` - List of available tools
- `outputs/mova_env_tool_run_response_v0.json` - MOVA-compliant response
- `logs/opencode_http_trace_v0.jsonl` - HTTP request/response trace
- `logs/opencode_sse_events_v0.log` - Raw SSE events (including server.connected)
- `artifacts/shell_stdout.txt` - Shell command output

## Success Criteria

- SSE connection established (server.connected event received)
- Session created successfully
- Shell command executed via /session/:id/shell
- MOVA response contains exit_code and result

