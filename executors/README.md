# Executors

Executors are external runtimes (servers/engines) that provide execution capabilities for MOVA workflows. They are distinct from skills—executors are infrastructure components, while skills are domain-specific capabilities.

## Structure

Each executor directory contains:

- **docker/** - Docker Compose configuration and environment files for running the executor server
- **driver/** - Client driver code that interfaces with the executor's API
- **scripts/** - Utility scripts (health checks, setup, etc.)
- **README.md** - Executor-specific documentation
- **ENGINE_PROVENANCE.md** - Provenance and trust documentation (if applicable)

## Current Executors

### `opencode_server_v1` ✅ (Working)

OpenCode AI coding agent server executor. Provides shell execution, file operations, and tool execution capabilities via HTTP API and SSE events.

- **Executor Ref**: `opencode_server_v1`
- **Docker**: `executors/opencode_server_v1/docker/`
- **Driver**: `executors/opencode_server_v1/driver/driver_opencode_v1.mjs`
- **Health Check**: `executors/opencode_server_v1/scripts/healthcheck_sse.mjs`
- **Status**: Fully implemented and tested

### `cloudflare_worker_v1` ⚠️ (Stub)

Cloudflare Workers runtime executor. Placeholder scaffold - not yet implemented.

- **Executor Ref**: `cloudflare_worker_v1`
- **Driver**: `executors/cloudflare_worker_v1/driver/driver_cloudflare_worker_v1.mjs`
- **Worker Config**: `executors/cloudflare_worker_v1/worker/wrangler.jsonc` (JSONC format, not TOML)
- **Worker Source**: `executors/cloudflare_worker_v1/worker/src/index.ts`
- **Status**: Stub only - returns `NOT_IMPLEMENTED` responses
- **Dev/Deploy**: `npm run cf:dev` / `npm run cf:deploy`

### `cloudflare_worker_gateway_v0` ✅ (Executor Gateway - Remote)

Cloudflare Worker Tool Gateway - remote executor gateway with policy checking, evidence collection, and episode logging.

- **Type**: Executor Gateway (remote), not a skill
- **Worker Config**: `executors/cloudflare_worker_gateway_v0/worker/wrangler.jsonc` (JSONC format)
- **Worker Source**: `executors/cloudflare_worker_gateway_v0/worker/src/index.ts`
- **Bindings**: KV (POLICY_KV), D1 (EPISODES_DB), R2 (ARTIFACTS)
- **Routes**: `GET /health`, `POST /tool/run`
- **Tools v0**: `kv.get`, `http.fetch` (GET only, hostname allowlist)
- **Status**: Scaffold implemented - policy → exec → evidence → episode
- **Dev/Deploy**: `npm run cf:dev:gateway` / `npm run cf:deploy:gateway`
- **Local Test**: `npm run cf:test:gateway:local` (optional, manual)

### `local_shell_v0` ✅ (Offline Driver)

Local shell driver that runs commands directly on the operator machine. Intended for probes/tests that must work without remote executors.

- **Executor Ref**: `local_shell_v0`
- **Driver**: `executors/local_shell_v0/driver/driver_local_shell_v0.mjs`
- **Capabilities**: `tool_id = "shell"` (command string executed via host shell)
- **Status**: Ready for offline driver probes and CI smoke checks

## Using Executors

All executors are accessed via the executor router:

```javascript
import { executeStep } from './executors/executor_router_v1.mjs';

const result = await executeStep({
  executor_ref: 'opencode_server_v1',  // or 'cloudflare_worker_v1'
  step: {
    tool_id: 'shell',
    args: { command: 'echo test' }
  },
  ctx: {
    logsDir: './logs',
    baseUrl: 'http://127.0.0.1:4096'  // For HTTP-based executors
  }
});

// Result contains:
// - tool_result: { exit_code, stdout, stderr }
// - evidence_refs: Array of evidence file paths
// - engine_ref: Executor engine identifier
// - session_ref: Session identifier (if applicable)
```
