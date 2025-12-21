# OPERATOR BRIEF

EXP_ID: WF_EX_OPENCODE_001_arch_to_mova
Goal: Describe current OpenCode (sst/opencode) architecture as-is in MOVA terms (components/flows/interfaces/controls/artifacts), using only repo evidence.
Scope: read-only analysis of tmp/external/opencode + its docs; produce MOVA mapping docs inside this experiment folder.
No-Go: no code execution inside opencode; no secrets; no network except git clone already done; no modifications under tmp/external/opencode.
Roles: Operator=Sergey; Architect=ChatGPT; Executor A=Codex IDE; (later) Executor B=Codex CLI.
Gates: baseline (npm ci/validate/test/smoke:wf_cycle) already PASS; outputs must include file/paths evidence and opencode commit sha.
Evidence: opencode commit sha + list of referenced files/paths + logs/artefacts + event_log/metrics where applicable.
