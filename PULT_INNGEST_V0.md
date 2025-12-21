Terminal A: cd pults/inngest_wf_cycle_v0 && node server.mjs
Terminal B: cd pults/inngest_wf_cycle_v0 && npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
Trigger (PowerShell): Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8288/e/dev -Headers @{"Content-Type"="application/json"} -Method POST -Body {"name":"lab/wf_cycle.smoke","data":{}}
Artifacts: lab/inngest_runs/<runId>/steps/<01_validate|02_test|03_smoke>/(stdout.log, stderr.log, result.json)
