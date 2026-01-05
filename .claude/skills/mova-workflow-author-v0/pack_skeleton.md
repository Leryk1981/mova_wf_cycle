# Pack skeleton

## Folders
- `packs/<pack_name>/ds/`
- `packs/<pack_name>/env/`
- `packs/<pack_name>/runtime/`
- `packs/<pack_name>/examples/`

## Scripts (package.json)
- `run:<pack_name>:a`
- `run:<pack_name>:b`
- `compare:<pack_name>`
- `quality:<pack_name>`
- `quality:<pack_name>:neg`

## Quality
- Positive suite validates expected behavior.
- Negative suite covers deny/unauthorized/invalid signatures/oversize/validation errors.

## MCP hooks
- smoke/e2e: prefer Gateway + MCP (run via `mova_run_envelope_v0`).
- local scripts: only for verification (gates/quality), not business actions.
