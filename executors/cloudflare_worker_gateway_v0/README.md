# Cloudflare Worker Tool Gateway v0

**Status**: Executor Gateway (Remote)

This is an **executor**, not a skill. Skills call executors through the driver/router interface.

## Overview

Cloudflare Worker Tool Gateway v0 provides a remote executor gateway that:

- Accepts tool execution requests via HTTP API
- Performs policy checks (deny-by-default, allowlist-based)
- Executes v0 tools: `kv.get`, `http.fetch` (GET only)
- Collects evidence (R2 artifacts, D1 episodes)
- Returns normalized tool results with evidence references

## Architecture

- **Worker**: `executors/cloudflare_worker_gateway_v0/worker/`
- **Config**: `wrangler.jsonc` (JSONC format, not TOML)
- **Bindings**: KV (POLICY_KV), D1 (EPISODES_DB), R2 (ARTIFACTS)

## Routes

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "engine_ref": "cloudflare_worker_gateway_v0@...",
  "time": "2024-12-17T..."
}
```

### `POST /api/:domain/:action`

Domain router endpoint (alias: `/gw/:domain/:action`) for forwarding to downstream domain workers with policy and hard limits.

**Headers:**
- `Authorization: Bearer <GATEWAY_AUTH_TOKEN>` (required)
- `Content-Type: application/json`

**Request Body (`ds.gateway_request_v0`):**
```json
{
  "request_id": "gw_echo_001",
  "payload": { "message": "hello" },
  "headers": { "x-trace": "demo" },
  "query": { "lang": "en" }
}
```

**Routing & policy:**
- Deny-by-default allowlist from `worker/config/gateway_policy_v0.json` (KV override supported).
- Routes resolved from `worker/config/gateway_routes_v0.json` with per-route `mode` (`service` bindings or `https`).
- `env_url_key` allows HTTPS routes to read the base URL from the Worker env (e.g., `GATEWAY_REMOTE_STATUS_URL`); `url` remains as fallback.
- Optional HMAC signing via `hmac_secret_env`, always forwards `x-gw-request-id` to downstream.

**Limits & timeouts:**
- Request size hard limit: **16KB** → `413 request_too_large`.
- Downstream timeout: **1500ms** default (override via `timeout_ms` per route) → `504 timeout`.
- Response cap: **64KB** default unless `max_response_bytes` overrides.

**Response (ALLOW):**
```json
{
  "ok": true,
  "request_id": "gw_echo_001",
  "domain": "demo.local",
  "action": "echo",
  "route_mode": "service",
  "result": { "status": 200, "body": { "echoed": { "message": "hello" } } },
  "policy_check": { "decision": "allow", "rule_id": "allow_match" },
  "engine_ref": "cloudflare_worker_gateway_v0@..."
}
```

**Response (normalized error):**
```json
{
  "ok": false,
  "request_id": "gw_echo_oversize",
  "error": { "code": "request_too_large", "message": "Request body ... exceeds limit 16384" },
  "policy_check": { "decision": "allow", "rule_id": "allow_match" },
  "route_mode": "service",
  "engine_ref": "cloudflare_worker_gateway_v0@..."
}
```

Error codes include `unauthorized`, `policy_denied`, `route_not_found`, `route_url_missing`, `timeout`, `response_too_large`, `invoke_failed`, `request_too_large`.

### `POST /tool/run`

Execute a tool with policy checking.

**Headers:**
- `Authorization: Bearer <GATEWAY_AUTH_TOKEN>` (required)

**Request Body:**
```json
{
  "request_id": "req_123",
  "tool_id": "kv.get",
  "args": {
    "key": "some-key"
  },
  "ctx": {
    "run_id": "run_123",
    "step_id": "step_123",
    "policy_ref": "policy.default"
  }
}
```

**Response (ALLOW):**
```json
{
  "ok": true,
  "tool_result": {
    "exit_code": 0,
    "stdout": "...",
    "stderr": "",
    "data": "..."
  },
  "policy_check": {
    "decision": "allow",
    "reason": "Tool kv.get is in allowlist",
    "rule_id": "tool_allowlist_match"
  },
  "evidence_refs": [
    "requests/req_123/request.json",
    "requests/req_123/engine_identity.json",
    "requests/req_123/tool_result.json",
    "requests/req_123/response.json"
  ],
  "engine_ref": "cloudflare_worker_gateway_v0@..."
}
```

**Response (DENY):**
```json
{
  "ok": false,
  "policy_check": {
    "decision": "deny",
    "reason": "Tool http.fetch not in allowlist (default deny)",
    "rule_id": "default_deny"
  },
  "evidence_refs": [
    "requests/req_123/request.json",
    "requests/req_123/engine_identity.json",
    "requests/req_123/policy_decision.json"
  ],
  "engine_ref": "cloudflare_worker_gateway_v0@..."
}
```

### `POST /episode/search`

Search episodes in D1 database. **Read-only endpoint** (does not create episodes).

**Headers:**
- `Authorization: Bearer <GATEWAY_AUTH_TOKEN>` (required)

**Request Body:**
```json
{
  "limit": 20,
  "id": "optional_exact_id",
  "id_prefix": "optional_prefix",
  "decision": "allow|deny",
  "type": "tool_execution|policy_deny",
  "since_ts": 0,
  "until_ts": 0,
  "order": "desc|asc"
}
```

**Parameters:**
- `limit`: Max results (default: 20, max: 100)
- `order`: Sort order (default: "desc")
- All other parameters are optional filters

**Response:**
```json
{
  "ok": true,
  "results": [
    {
      "id": "req_123",
      "ts": 1702834567890,
      "type": "tool_execution",
      "run_id": "run_123",
      "step_id": "step_123",
      "policy_ref": "policy.default",
      "policy_version": "v0.1.0",
      "engine_ref": "cloudflare_worker_gateway_v0@LHR",
      "decision": "allow",
      "reason": "Tool kv.get is in allowlist",
      "evidence_refs": ["requests/req_123/request.json", "..."]
    }
  ]
}
```

**Example:**
```bash
curl -X POST https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev/episode/search \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10, "decision": "allow", "order": "desc"}'
```

### `GET /artifact/get?ref=...`

Get artifact from R2 bucket. **Read-only endpoint** (does not create episodes).

**Headers:**
- `Authorization: Bearer <GATEWAY_AUTH_TOKEN>` (required)

**Query Parameters:**
- `ref`: Artifact reference path (required, max 512 chars, must match `^[a-zA-Z0-9._/-]+$`, no `..`, no leading `/`)

**Response:**
- `200 OK`: Artifact body with appropriate `Content-Type`:
  - `.json` → `application/json`
  - `.jsonl` → `application/x-ndjson`
  - Other → `application/octet-stream`
- `404 Not Found`: Artifact does not exist
- `400 Bad Request`: Invalid ref format

**Headers:**
- `Content-Type`: Based on file extension
- `Cache-Control: no-store`

**Example:**
```bash
curl -X GET "https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev/artifact/get?ref=requests/req_123/request.json" \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN"
```

## Policy Loading

### How to Load Policy into KV

1. **Create KV namespace** (if not exists):
```bash
wrangler kv:namespace create "POLICY_KV"
wrangler kv:namespace create "POLICY_KV" --preview
```

2. **Update wrangler.jsonc** with actual KV namespace IDs

3. **Load default policy**:
```bash
# Set active version
wrangler kv:key put "policy:active:policy.default" "v0.1.0" --namespace-id=<POLICY_KV_ID>

# Load policy profile
wrangler kv:key put "policy:policy.default:v0.1.0" --path=policy/default_policy_v0.json --namespace-id=<POLICY_KV_ID>
```

4. **For preview environment**:
```bash
wrangler kv:key put "policy:active:policy.default" "v0.1.0" --namespace-id=<POLICY_KV_PREVIEW_ID> --preview
wrangler kv:key put "policy:policy.default:v0.1.0" --path=policy/default_policy_v0.json --namespace-id=<POLICY_KV_PREVIEW_ID> --preview
```

## D1 Database Setup

1. **Create D1 database**:
```bash
wrangler d1 create mova-episodes-v0
```

2. **Update wrangler.jsonc** with actual database ID

3. **Run migration** (local dev):
```bash
wrangler d1 execute mova-episodes-v0 --local --file=sql/001_init.sql
```

4. **Run migration** (production):
```bash
wrangler d1 execute mova-episodes-v0 --file=sql/001_init.sql
```

## R2 Bucket Setup

1. **Create R2 bucket**:
```bash
wrangler r2 bucket create mova-artifacts-v0
```

2. **Update wrangler.jsonc** with actual bucket name

## Secrets

Set secrets via wrangler (not in repo):

```bash
wrangler secret put GATEWAY_AUTH_TOKEN
```

## Development

```bash
# Start local dev server
npm run cf:dev:gateway

# Deploy to Cloudflare
npm run cf:deploy:gateway

# Run local tests (optional, manual)
npm run cf:test:gateway:local

# Run smoke test via driver
npm run cf:smoke:gateway

# Run quality suites (gates + positive[/negative] cases)
npm run quality:gateway
npm run quality:gateway:neg
```

## Local Config

The main `wrangler.jsonc` file is sanitized and contains placeholder IDs (`REPLACE_ME`) for security reasons. 

For local development with real Cloudflare resources, use `wrangler.dev.jsonc`:

1. **Create local config** (if not exists):
   ```bash
   cp executors/cloudflare_worker_gateway_v0/worker/wrangler.jsonc \
      executors/cloudflare_worker_gateway_v0/worker/wrangler.dev.jsonc
   ```

2. **Fill in real IDs** in `wrangler.dev.jsonc`:
   - Replace `REPLACE_ME` in `env.dev.kv_namespaces[0].id` with your KV namespace ID
   - Replace `REPLACE_ME` in `env.dev.d1_databases[0].database_id` with your D1 database ID
   - Keep R2 bucket name as-is (or update if needed)

3. **Use dev-specific scripts**:
   ```bash
   npm run cf:dev:gateway:dev    # Start dev server with local config
   npm run cf:deploy:gateway:dev # Deploy to dev environment
   ```

**Note**: `wrangler.dev.jsonc` is gitignored and should never be committed.

## Using Node Driver (driver_cf_gateway_v0)

The Node.js driver (`executors/cloudflare_worker_gateway_v0/driver/driver_cf_gateway_v0.mjs`) provides a programmatic interface to the gateway, implementing `EXECUTOR_DRIVER_CONTRACT_v0`.

### Basic Usage

```javascript
import { createDriver } from './executors/cloudflare_worker_gateway_v0/driver/driver_cf_gateway_v0.mjs';

// Create driver instance
const driver = createDriver({
  baseUrl: 'http://localhost:8787',  // Optional, defaults to GATEWAY_URL env or localhost:8787
  authToken: 'your-token'            // Optional, defaults to GATEWAY_AUTH_TOKEN env
});

// Execute a tool
const result = await driver.runTool({
  request_id: 'req_123',
  tool_id: 'kv.get',
  args: { key: 'test-key' },
  ctx: {
    run_id: 'run_001',
    step_id: 'step_001',
    policy_ref: 'policy.default'
  }
}, {
  logsDir: './.tmp/gateway_logs'  // Optional, for evidence storage
});

// Check result
if (result.ok && result.tool_result) {
  console.log('Tool executed:', result.tool_result);
} else {
  console.log('Policy DENY:', result.policy_check.reason);
}
```

### Secrets Management

The driver reads `GATEWAY_AUTH_TOKEN` from:
1. `options.authToken` (explicit parameter)
2. `process.env.GATEWAY_AUTH_TOKEN` (environment variable)
3. `.dev.vars` file (when using `wrangler dev`, automatically loaded)

**Important**: Never commit secrets to the repository. The `.dev.vars` file is already in `.gitignore`.

For different environments:
- **Local dev**: Use `.dev.vars` (auto-loaded by `wrangler dev`)
- **Remote dev**: Use `wrangler secret put GATEWAY_AUTH_TOKEN --env dev`
- **Production**: Use `wrangler secret put GATEWAY_AUTH_TOKEN --env prod`

The driver does not automatically load `.dev.vars` files - it only reads from `process.env`. When running tests manually, set the environment variable:
```bash
$env:GATEWAY_AUTH_TOKEN="your-token"
node tools/cf_gateway_smoke_v0.mjs
```

### Smoke Test

Run the smoke test using the driver:
```bash
npm run cf:smoke:gateway
```

This tests both DENY and ALLOW paths through the driver interface.

## Tools v0

Currently supported tools:

- **kv.get**: Read from KV namespace
  - Args: `{ key: string }`
  
- **http.fetch**: HTTP GET requests only
  - Args: `{ url: string, headers?: Record<string, string> }`
  - Hostname allowlist enforced via policy

## Evidence Collection

Every request creates evidence artifacts in R2:

- `requests/<request_id>/request.json` - Original request
- `requests/<request_id>/engine_identity.json` - Gateway identity
- `requests/<request_id>/tool_result.json` - Tool execution result (ALLOW only)
- `requests/<request_id>/policy_decision.json` - Policy decision (DENY only)
- `requests/<request_id>/response.json` - Gateway response (ALLOW only)

Every request also creates an episode record in D1 with:
- Request metadata (run_id, step_id, policy_ref, etc.)
- Policy decision and reason
- Evidence references
- Full payload

## Notes

- **No secrets in repo**: All secrets set via `wrangler secret put`
- **No Durable Objects**: v0 uses KV, D1, R2 only
- **Deny path has 0 side effects**: Policy DENY creates evidence but does not execute tool
- **v0 tools only**: kv.get and http.fetch (GET) with hostname allowlist
