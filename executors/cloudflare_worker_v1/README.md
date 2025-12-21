# Cloudflare Worker Executor v1

**Status**: Stub / Scaffold (Not Implemented)

This executor provides execution capabilities via Cloudflare Workers runtime.

## Current Status

⚠️ **NOT IMPLEMENTED** - This is a placeholder scaffold.

The driver (`driver_cloudflare_worker_v1.mjs`) currently returns `DENY/NOT_IMPLEMENTED` responses to indicate that this executor is not yet available.

## Configuration

This executor uses **wrangler.jsonc** (JSONC format) for configuration. TOML format is not used.

- **Config file**: `executors/cloudflare_worker_v1/worker/wrangler.jsonc`
- **Main entry**: `executors/cloudflare_worker_v1/worker/src/index.ts`

Wrangler officially supports and recommends `wrangler.jsonc` format, which allows comments and is easier to maintain than TOML.

## Development

```bash
# Start local development server
npm run cf:dev

# Deploy to Cloudflare
npm run cf:deploy
```

## Future Implementation

When implemented, this executor will:

- Deploy tool execution requests to Cloudflare Workers
- Support shell commands, file operations, and other tools via Worker runtime
- Provide evidence collection and provenance tracking
- Integrate with Cloudflare Workers API for deployment and execution

## Usage

```javascript
import { executeStep } from '../executor_router_v1.mjs';

const result = await executeStep({
  executor_ref: 'cloudflare_worker_v1',
  step: { tool_id: 'shell', args: { command: 'echo test' } },
  ctx: { logsDir: './logs' }
});
```

**Note**: Currently returns `exit_code: 1` with `NOT_IMPLEMENTED` error message.

