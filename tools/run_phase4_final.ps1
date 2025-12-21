# Final Phase 4 test runner - requires tokens to be set
param(
    [string]$GatewayUrl = "https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev"
)

$ErrorActionPreference = "Stop"

$env:GATEWAY_URL = $GatewayUrl

Write-Host "=== WF_EX_SCHEMA_PAYLOAD_002 Phase 4 Final Tests ===" -ForegroundColor Green
Write-Host ""

# Verify tokens
if (-not $env:GATEWAY_AUTH_TOKEN) {
    Write-Host "ERROR: GATEWAY_AUTH_TOKEN not set" -ForegroundColor Red
    Write-Host "Set it: `$env:GATEWAY_AUTH_TOKEN='<your-token>'" -ForegroundColor Yellow
    exit 1
}

if (-not $env:ADMIN_AUTH_TOKEN) {
    Write-Host "WARNING: ADMIN_AUTH_TOKEN not set, using GATEWAY_AUTH_TOKEN" -ForegroundColor Yellow
    $env:ADMIN_AUTH_TOKEN = $env:GATEWAY_AUTH_TOKEN
}

Write-Host "✓ GATEWAY_URL: $env:GATEWAY_URL" -ForegroundColor Green
Write-Host "✓ GATEWAY_AUTH_TOKEN: SET (length: $($env:GATEWAY_AUTH_TOKEN.Length))" -ForegroundColor Green
Write-Host "✓ ADMIN_AUTH_TOKEN: SET (length: $($env:ADMIN_AUTH_TOKEN.Length))" -ForegroundColor Green
Write-Host ""

# Run smoke tests
Write-Host "=== 1. Smoke Tests ===" -ForegroundColor Cyan
npm run smoke:schema_payload -- --base_url $env:GATEWAY_URL
if ($LASTEXITCODE -ne 0) {
    Write-Host "Smoke tests FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Smoke tests PASSED" -ForegroundColor Green
Write-Host ""

# Run soak test
Write-Host "=== 2. Soak Test (V1) ===" -ForegroundColor Cyan
npm run soak:schema_payload -- --base_url $env:GATEWAY_URL --variant v1 --runs 50 --warmup 10
if ($LASTEXITCODE -ne 0) {
    Write-Host "Soak test FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Soak test PASSED" -ForegroundColor Green
Write-Host ""

# Check episodes
Write-Host "=== 3. Episode Check ===" -ForegroundColor Cyan
node tools/schema_payload_check_episodes_v0.mjs --base_url $env:GATEWAY_URL
if ($LASTEXITCODE -ne 0) {
    Write-Host "Episode check FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Episode check PASSED" -ForegroundColor Green
Write-Host ""

Write-Host "=== All Tests PASSED ===" -ForegroundColor Green
exit 0

