# Engine Provenance: mova/opencode-engine

**Purpose**: Document the origin, build process, and trustworthiness of the `mova/opencode-engine` Docker image used in this vendor snapshot.

---

## Image Identity

**Name**: `mova/opencode-engine:11b3927`

**Digest**: `sha256:0ee686dbdb923a13d69a7a4d3ec9a28df6e1d03158ded1e383967030dced2291`

**Size**: 3.15 GB

**Created**: 2025-12-16T21:10:22.585751089Z

---

## Build Origin

### Who Built It?
- **Built**: Locally (not from a public registry)
- **Storage**: Local Docker image cache only
- **Registry**: None (local-only image)

### Upstream Source

**Base Image**: `oven-sh/bun:1.3.4`
- Bun runtime revision: `5eb2145b3104f48eadd601518904e56aaa9937bf`
- Source: https://github.com/oven-sh/bun
- Created: 2025-12-07T04:55:04.246Z

**OpenCode Source**: Unknown commit (needs verification)
- Expected repository: https://github.com/sst/opencode
- **TODO**: Verify exact commit SHA by inspecting container filesystem

### Build Process
This image was created during local development, likely via:
1. Base: `oven-sh/bun:1.3.4` runtime
2. OpenCode source cloned into `/work/packages/opencode/`
3. Dependencies installed (bun install)
4. Custom entrypoint configured
5. Auth credentials pre-configured (details not in provenance)

**Verification Status**: ⚠️ **NOT REPRODUCIBLE** - Built locally without recorded build script or Dockerfile.

---

## Image Contents

### Entrypoint & Command
```bash
Entrypoint: /usr/local/bin/docker-entrypoint.sh
Command: bash -lc bun run packages/opencode/src/index.ts serve --hostname 0.0.0.0 --port 4096
```

### Exposed Ports
- **4096/tcp**: OpenCode server HTTP API + SSE

### Expected Endpoints
- `GET /event` - SSE stream for server events (emits `server.connected`)
- `POST /session` - Create new execution session
- `POST /session/:id/shell` - Execute shell command in session
- `POST /session/:id/file.read` - Read file from session workspace
- `POST /session/:id/file.list` - List files in session workspace

### Environment Variables (built-in)
```bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/bun-node-fallback-bin
BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
BUN_INSTALL_BIN=/usr/local/bin
HUSKY=0
CI=1
```

### Working Directory
- `/work` - Expected to contain OpenCode source in `packages/opencode/src/`

---

## Policy & Usage Constraints

### Where This Image May Be Used

✅ **APPROVED**:
- **Development environments only**
- **Local testing & experimentation**
- **CI smoke/soak tests (if image is available in CI environment)**

❌ **PROHIBITED**:
- **Production deployments** - Image is not reproducibly built
- **Public distribution** - Contains unverified auth credentials
- **Compliance-sensitive environments** - Provenance cannot be verified

### Rationale

This image is a **convenience development artifact** that enables rapid iteration without requiring:
- Manual auth setup on every container start
- API key management in .env files
- Repeated OpenCode source builds

However, it **lacks reproducible build evidence**:
- No Dockerfile committed to source control
- No build logs or layer checksums
- No upstream commit SHA verification
- No audit trail for embedded credentials

### Recommended Path Forward

For production or compliance needs:
1. Use official `ghcr.io/sst/opencode` image (digest-pinned)
2. Provide API keys via secure secret management
3. Document exact upstream commit SHA
4. Enable build provenance (SLSA, Sigstore, etc.)

For development:
- Current `mova/opencode-engine` is acceptable
- Periodically verify image still functions correctly
- Plan migration to official image + secret management before any production use

---

## Verification Commands

```bash
# Verify image exists locally
docker image ls mova/opencode-engine:11b3927

# Get digest
docker inspect mova/opencode-engine:11b3927 --format "{{.RepoDigests}}"

# Check creation date
docker inspect mova/opencode-engine:11b3927 --format "{{.Created}}"

# List image layers (partial provenance)
docker history mova/opencode-engine:11b3927 --no-trunc

# Run identity check
npm run opencode:identity
```

---

## Change Log

- **2025-12-17**: Initial provenance documentation (Phase 6)
- **TODO**: Add OpenCode upstream commit SHA verification
- **TODO**: Document credential embedding process (if safe to disclose)
- **TODO**: Create reproducible build script (Dockerfile + build.sh)

