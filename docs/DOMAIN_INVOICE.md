# Invoice Domain API

## Public Entry Point

POST /api/invoice/<action> via Gateway

## Authentication

Bearer auth required

## Response Format

### Success Response
```json
{
  "ok": true,
  "result": { ... }
}
```

### Error Response
```json
{
  "ok": false,
  "error": {
    "code": "error_code",
    "message": "Human readable error message"
  }
}
```

## Actions Table

| Action | Runtime Module | Data Schema | Environment Schema |
|--------|----------------|-------------|-------------------|
| create_send | invoice_create_send_v0.mjs | ds.invoice_mvp_create_send_request_v0.json | env.invoice_mvp_create_send_v0.json |
| reminder_schedule | invoice_reminder_schedule_v0.mjs | ds.invoice_mvp_reminder_schedule_request_v0.json | env.invoice_mvp_reminder_schedule_v0.json |
| mark_paid | (inherited) | ds.invoice_mvp_mark_paid_request_v0.json | env.invoice_mvp_mark_paid_v0.json |
| period_export | (inherited) | ds.invoice_mvp_period_export_request_v0.json | env.invoice_mvp_period_export_v0.json |

## Notes

- No banking integration in MVP
- Paid status is a manual action (logged)
- All operations support dry_run mode by default
- Provider must be explicitly specified (sevdesk or manual)