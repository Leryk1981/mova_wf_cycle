# Executor Driver Contract v0

Minimal interface contract for all executor drivers.

## Method: `runTool(request) -> Promise<Response>`

Execute a tool through the executor.

### Input: `request`

```javascript
{
  request_id: string,        // Stable, deterministic request identifier
  tool_id: string,          // Tool identifier (e.g., "kv.get", "http.fetch", "shell")
  args: object,             // Tool-specific arguments
  ctx?: {                   // Optional execution context
    run_id?: string,         // Stable run identifier
    step_id?: string,        // Stable step identifier
    policy_ref?: string      // Policy reference (default: "policy.default")
  }
}
```

### Output: `Response`

```javascript
{
  ok: boolean,              // true = success, false = failure/deny
  tool_result?: {           // Present if ok=true and decision=allow
    exit_code: number,       // 0 = success, non-zero = failure
    stdout: string,          // Standard output
    stderr: string,         // Standard error (empty if none)
    data?: any              // Optional structured data
  },
  policy_check: {           // Policy decision (always present)
    decision: "allow" | "deny",
    reason: string,         // Human-readable reason
    rule_id?: string        // Optional rule identifier
  },
  evidence_refs: string[],  // Array of remote evidence artifact refs (always present, never empty)
                            // Remote refs are accessible through executor (e.g., R2 keys for CF gateway)
                            // Format: "requests/<request_id>/<artifact>.json" or similar
  local_evidence_paths?: string[],  // Optional array of local file paths on operator machine
                                    // Local paths are relative to repo root (e.g., ".tmp/.../http_trace_*.jsonl")
                                    // Must NOT be mixed with remote refs in evidence_refs
  engine_ref: string,       // Executor engine identifier (always present)
  run_id?: string,         // Echo of input run_id if provided
  step_id?: string          // Echo of input step_id if provided
}
```

## Requirements

1. **Stable IDs**: `request_id`, `run_id`, `step_id` must be deterministic and stable across retries.
2. **No secrets in evidence**: Evidence artifacts must never contain secrets, tokens, or sensitive data.
3. **DENY = no execution**: When `policy_check.decision === "deny"`, `tool_result` must be absent and no tool execution must occur.
4. **Evidence required**: `evidence_refs` must always be present and non-empty (even for DENY).
5. **Evidence separation**: `evidence_refs` contains only remote refs accessible through executor. Local files (http traces, SSE logs) must be in `local_evidence_paths` (optional). Never mix remote and local in the same array.
6. **Error handling**: Network/connection errors throw Error; policy DENY returns `ok: false` without throwing.

## Example

```javascript
// DENY response
{
  ok: false,
  policy_check: {
    decision: "deny",
    reason: "Tool http.fetch not in allowlist (default deny)",
    rule_id: "default_deny"
  },
  evidence_refs: ["requests/req_123/request.json", "requests/req_123/policy_decision.json"],
  local_evidence_paths: [".tmp/cf_gateway_driver/http_trace_req_123.jsonl"],
  engine_ref: "cloudflare_worker_gateway_v0@TXL"
}

// ALLOW response
{
  ok: true,
  tool_result: {
    exit_code: 0,
    stdout: "value",
    stderr: "",
    data: "value"
  },
  policy_check: {
    decision: "allow",
    reason: "Tool kv.get is in allowlist",
    rule_id: "tool_allowlist_match"
  },
  evidence_refs: ["requests/req_456/request.json", "requests/req_456/tool_result.json", "requests/req_456/response.json"],
  local_evidence_paths: [".tmp/cf_gateway_driver/http_trace_req_456.jsonl"],
  engine_ref: "cloudflare_worker_gateway_v0@TXL",
  run_id: "run_001",
  step_id: "step_001"
}
```

