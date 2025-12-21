Terminal A: cd pults/inngest_wf_cycle_v0 && node server.mjs
Terminal B: cd pults/inngest_wf_cycle_v0 && npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
Trigger smoke (PowerShell): Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{'Content-Type'='application/json'} -Method POST -Body '{"name":"lab/wf_cycle.smoke","data":{}}'
Trigger full (PowerShell): Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{'Content-Type'='application/json'} -Method POST -Body '{"name":"lab/wf_cycle.full","data":{}}'
Artifacts: lab/inngest_runs/<runId>/steps/... (smoke) and lab/inngest_runs/<runId>/wf_cycle_full/... (full)
MOVA context pack: ./MOVA_CONTEXT_PACK.md
