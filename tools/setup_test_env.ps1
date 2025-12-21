# Setup test environment for WF_EX_SCHEMA_PAYLOAD_002
# This script helps set up environment variables for testing

param(
    [string]$GatewayUrl = "https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev"
)

Write-Host "Setting up test environment for WF_EX_SCHEMA_PAYLOAD_002" -ForegroundColor Green
Write-Host ""

# Set GATEWAY_URL
$env:GATEWAY_URL = $GatewayUrl
Write-Host "✓ GATEWAY_URL set to: $env:GATEWAY_URL" -ForegroundColor Green

# Check if tokens are already set
if ($env:GATEWAY_AUTH_TOKEN) {
    Write-Host "✓ GATEWAY_AUTH_TOKEN is already set (length: $($env:GATEWAY_AUTH_TOKEN.Length))" -ForegroundColor Green
} else {
    Write-Host "⚠ GATEWAY_AUTH_TOKEN is NOT set" -ForegroundColor Yellow
    Write-Host "  Please set it: `$env:GATEWAY_AUTH_TOKEN='<your-token>'" -ForegroundColor Yellow
}

if ($env:ADMIN_AUTH_TOKEN) {
    Write-Host "✓ ADMIN_AUTH_TOKEN is already set (length: $($env:ADMIN_AUTH_TOKEN.Length))" -ForegroundColor Green
} else {
    Write-Host "⚠ ADMIN_AUTH_TOKEN is NOT set" -ForegroundColor Yellow
    Write-Host "  Please set it: `$env:ADMIN_AUTH_TOKEN='<your-admin-token>'" -ForegroundColor Yellow
    Write-Host "  (Will fallback to GATEWAY_AUTH_TOKEN if not set)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "To verify, run: node tools/test_env_vars.mjs" -ForegroundColor Cyan
Write-Host "To run tests:" -ForegroundColor Cyan
Write-Host "  npm run smoke:schema_payload -- --base_url `$env:GATEWAY_URL" -ForegroundColor Cyan
Write-Host "  npm run soak:schema_payload -- --base_url `$env:GATEWAY_URL --variant v1 --runs 50 --warmup 10" -ForegroundColor Cyan

