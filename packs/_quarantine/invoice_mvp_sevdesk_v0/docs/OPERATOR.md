# Invoice MVP (sevDesk) Operator Guide

## What it is

sevDesk provider via driver; dry-run default; behind Gateway.

## Quick commands (copy/paste)

npm run quality:invoice_mvp_sevdesk

npm run quality:invoice_mvp_sevdesk:neg

npm run invoice_mvp:create_send:a

npm run invoice_mvp:create_send:b

npm run invoice_mvp:compare

npm run smoke:invoice_gateway_e2e

npm run smoke:episode_store_e2e

## Strict mode examples (with env vars)

gateway e2e (GATEWAY_BASE_URL, GATEWAY_AUTH_TOKEN, INVOICE_WORKER_BASE_URL, SMOKE_STRICT=true)

episode store e2e (STORE_EPISODE_REMOTE_URL/TOKEN, SEARCH url if needed, SMOKE_STRICT=true)

## Real sevDesk mode (manual only)

SEVDESK_API_TOKEN, SEVDESK_BASE_URL

Note: not for CI, only in manual mode.