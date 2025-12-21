# Run Phase 4 tests with token setup
param(
    [string]$GatewayUrl = "https://mova-tool-gateway-v0-dev.s-myasoedov81.workers.dev"
)

$env:GATEWAY_URL = $GatewayUrl

Write-Host "WF_EX_SCHEMA_PAYLOAD_002 Phase 4 Test Runner" -ForegroundColor Green
Write-Host ""

# Check if tokens are set
if (-not $env:GATEWAY_AUTH_TOKEN) {
    Write-Host "GATEWAY_AUTH_TOKEN is not set." -ForegroundColor Yellow
    Write-Host "Please enter your GATEWAY_AUTH_TOKEN (same as in Cloudflare):" -ForegroundColor Yellow
    $secureToken = Read-Host -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:GATEWAY_AUTH_TOKEN = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

if (-not $env:ADMIN_AUTH_TOKEN) {
    Write-Host "ADMIN_AUTH_TOKEN is not set." -ForegroundColor Yellow
    Write-Host "Please enter your ADMIN_AUTH_TOKEN (same as in Cloudflare):" -ForegroundColor Yellow
    $secureToken = Read-Host -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:ADMIN_AUTH_TOKEN = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

Write-Host ""
Write-Host "Running tests..." -ForegroundColor Cyan
Write-Host ""

# Run smoke tests
Write-Host "=== Smoke Tests ===" -ForegroundColor Yellow
npm run smoke:schema_payload -- --base_url $env:GATEWAY_URL
$smokeExit = $LASTEXITCODE

Write-Host ""
Write-Host "=== Soak Test (V1) ===" -ForegroundColor Yellow
npm run soak:schema_payload -- --base_url $env:GATEWAY_URL --variant v1 --runs 50 --warmup 10
$soakExit = $LASTEXITCODE

Write-Host ""
Write-Host "=== Episode Check ===" -ForegroundColor Yellow
node tools/schema_payload_check_episodes_v0.mjs --base_url $env:GATEWAY_URL
$episodeExit = $LASTEXITCODE

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Green
if ($smokeExit -eq 0 -and $soakExit -eq 0 -and $episodeExit -eq 0) {
    Write-Host "All tests PASSED" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some tests FAILED" -ForegroundColor Red
    exit 1
}

