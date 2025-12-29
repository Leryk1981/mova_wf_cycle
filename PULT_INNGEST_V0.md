Terminal A: `cd pults/inngest_wf_cycle_v0 && node server.mjs`
Terminal B: `cd pults/inngest_wf_cycle_v0 && npx --no-install inngest-cli dev -u http://localhost:3000/api/inngest`

Default behavior: `npm run smoke:pult` skips unless `PULT_SMOKE_ENABLE=1` is set and dev dependencies (`express`, `inngest`, `inngest-cli`) are installed locally.

Trigger smoke (PowerShell):
`Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{'Content-Type'='application/json'} -Method POST -Body '{"name":"lab/wf_cycle.smoke","data":{}}'`

Trigger full (PowerShell):
`Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{'Content-Type'='application/json'} -Method POST -Body '{"name":"lab/wf_cycle.full","data":{}}'`

Trigger flashslot publish (PowerShell):
`Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{'Content-Type'='application/json'} -Method POST -Body '{"name":"lab/flashslot.publish","data":{}}'`

Trigger flashslot experiment (PowerShell):
`Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{'Content-Type'='application/json'} -Method POST -Body '{"name":"flashslot.experiment","data":{}}'`

Trigger experiment (PowerShell):
`Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{'Content-Type'='application/json'} -Method POST -Body '{"name":"lab/wf_cycle.experiment","data":{}}'`

Artifacts: `lab/inngest_runs/<runId>/steps/...` (smoke) and `lab/inngest_runs/<runId>/(wf_cycle_full|wf_cycle_experiment)/...`

FlashSlot experiment artifacts: `lab/inngest_runs/<runId>/flashslot_experiment/experiment_summary.json` and `lab/inngest_runs/<runId>/flashslot_experiment/winner_pack/...`

MOVA context pack: `./MOVA_CONTEXT_PACK.md`

By default `smoke:pult` does not kill stray inngest processes. For CI/force mode set `PULT_SMOKE_KILL_STRAY=1`.
