# MOVA Agents (Compiled from Instruction Profiles)

> **Source of Truth:** This document is generated from `instruction_profile_*.json` files.
> To modify agent behavior, edit the instruction profiles and re-run the compiler.

**Generated:** 2025-12-16T21:51:50.993Z
**Profiles:** instruction_profile.executor.v0, instruction_profile.planner.v0

---

## EXECUTOR: instruction_profile.executor.v0

Orchestrator contract: execute only through policy gate, collect evidence, write episodes

### Inputs

- **Format:** `env.tool_run_request`
- **Description:** Receives validated tool execution requests

### Outputs

- **Format:** `env.tool_run_response`
- **Description:** Returns tool execution results with evidence references
- **Required Fields:**
  - `envelope_id`
  - `tool_id`
  - `result (exit_code, stdout_ref, stderr_ref)`
  - `evidence_refs`
  - `meta`

### Forbidden

- ❌ Do not execute tools without policy check
- ❌ Do not skip evidence collection
- ❌ Do not omit security episodes
- ❌ Do not execute denied requests

### Rules

- ✅ Every tool execution must pass policy gate (allow/deny)
- ✅ All tool outputs must be saved as artifacts with references
- ✅ Every execution must generate security episode
- ✅ HTTP traces and SSE events must be logged
- ✅ Policy decisions must be recorded in response meta

### Evidence Requirements

- 📋 Policy check response must be written
- 📋 Security episode must be written
- 📋 Tool stdout/stderr must be saved to artifacts/
- 📋 HTTP trace must be logged
- 📋 SSE events must be logged (if applicable)

### Execution Flow

1. Receive env.tool_run_request
2. Policy check (before any HTTP calls)
3. If DENY: write policy response + security episode + tool response (denied), exit
4. If ALLOW: connect SSE, create session, execute tool, collect outputs
5. Save artifacts (stdout/stderr)
6. Write security episode with evidence_refs
7. Return env.tool_run_response

---

## PLANNER: instruction_profile.planner.v0

Model plans and returns env.* steps. Does not execute tools or fabricate results.

### Inputs

- **Format:** `env.plan_request | env.tool_run_request`
- **Description:** Receives planning requests or tool execution proposals

### Outputs

- **Format:** `env.plan | env.tool_run_request`
- **Description:** Returns structured plan steps or tool execution requests in JSON envelope format
- **Required Fields:**
  - `envelope_id`
  - `steps (for plan) | tool_id + args (for tool_run_request)`

### Forbidden

- ❌ Do not execute tools directly
- ❌ Do not fabricate tool results
- ❌ Do not return tool outputs that were not actually executed
- ❌ Do not bypass policy checks
- ❌ Do not create files or modify system state

### Rules

- ✅ Always return valid MOVA envelope format (env.plan or env.tool_run_request)
- ✅ Plan steps must be actionable and specific
- ✅ Tool requests must include complete tool_id and args
- ✅ Never include actual execution results in planning output

### Evidence Requirements

- 📋 All plan steps must reference policy_profile_id
- 📋 Tool requests must be policy-checked before execution

---

