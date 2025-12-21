# OpenCode Vendor Snapshot v1

Reproducible OpenCode engine setup via Docker.

## Quick Start

```bash
# 1. Copy example env and pin digest
cp executors/opencode_server_v1/docker/.env.example executors/opencode_server_v1/docker/.env
# Edit .env to set OPENCODE_IMAGE with pinned digest

# 2. Start engine
npm run opencode:up

# 3. Check health
node executors/opencode_server_v1/scripts/healthcheck_sse.mjs

# 4. Stop engine
npm run opencode:down
```

## Image Options

### Option 1: Local Pre-configured Image (Recommended)

Use `mova/opencode-engine:11b3927` - a local image with auth pre-configured:

```bash
# Already included in .env.example:
OPENCODE_IMAGE=mova/opencode-engine@sha256:0ee686dbdb923a13d69a7a4d3ec9a28df6e1d03158ded1e383967030dced2291
```

✅ **No API keys needed in .env** - auth is baked into the image.

### Option 2: Official ghcr.io/sst/opencode

For upstream builds, always use digest-pinned images:

```bash
# Find latest digest
docker pull ghcr.io/sst/opencode:latest
docker inspect ghcr.io/sst/opencode:latest | grep -i sha256

# Update .env
OPENCODE_IMAGE=ghcr.io/sst/opencode@sha256:abc123...
```

⚠️ **Requires API keys** - see [API Keys Required](#api-keys-required) section below.

## Architecture

- **Image**: `mova/opencode-engine` (recommended, pre-configured) or `ghcr.io/sst/opencode` (requires API keys)
- **Command**: Default for mova image; `opencode serve` for ghcr.io
- **Port**: 4096 (configurable via OPENCODE_PORT)
- **Workspace**: Mounted from `WORKSPACE_ROOT` (default: project root)
- **SSE**: `/event` endpoint for server events
- **Session API**: `/session` for creating sessions, `/session/:id/shell` for execution

## Health Check

The health check connects to SSE `/event` and waits for `server.connected` event:

```bash
node executors/opencode_server_v1/scripts/healthcheck_sse.mjs --baseUrl http://127.0.0.1:4096
```

Exit codes:
- `0`: Healthy (server.connected received)
- `1`: Unhealthy (timeout or connection failed)

## Configuration

All configuration via `.env` file (not tracked in git):

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_IMAGE` | (required) | Image with digest, e.g. `ghcr.io/sst/opencode@sha256:...` |
| `OPENCODE_PORT` | `4096` | Host port for OpenCode server |
| `WORKSPACE_ROOT` | `../..` | Path to workspace to mount (relative to this dir) |

### API Keys Required

⚠️ **IMPORTANT (for ghcr.io/sst/opencode only)**: OpenCode requires API keys for LLM providers (Anthropic, OpenAI, etc.) to function.

Without API keys, the container will fail to start. To provide API keys:

```bash
# Add to .env file
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

Then update `docker-compose.yml` to pass these as environment variables:

```yaml
environment:
  - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  - OPENAI_API_KEY=${OPENAI_API_KEY}
```

✅ **For `mova/opencode-engine`**: Auth is pre-configured, no keys needed in .env.

## Docker Compose

The `docker-compose.yml` uses:
- Service name: `opencode`
- Port mapping: `${OPENCODE_PORT}:4096`
- Volume mount: `${WORKSPACE_ROOT}:/work`
- Command: `opencode serve`

## Troubleshooting

### Container won't start
```bash
# Check logs
docker compose -f executors/opencode_server_v1/docker/docker-compose.yml logs

# Check if port is in use
netstat -ano | findstr :4096  # Windows
lsof -i :4096                 # macOS/Linux
```

### Health check fails
```bash
# Verify container is running
docker ps | grep opencode

# Test SSE endpoint manually
curl -N http://127.0.0.1:4096/event
```

### Workspace mount issues
```bash
# Verify mount path in .env is correct
# Path should be relative to this directory or absolute
```

## Smoke Tests

See `tools/opencode_engine_smoke_ci.mjs` for automated smoke testing.

## Soak Tests

See `tools/opencode_engine_soak_test_v1.mjs` for load/stability testing.

