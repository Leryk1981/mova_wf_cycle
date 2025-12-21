# Executor Driver Interface v1

Unified contract for all executor drivers in MOVA.

## Driver Factory

All drivers must export a `createDriver(options)` function:

```javascript
export function createDriver(options = {}) {
  return new DriverInstance(options);
}
```

## Driver Instance Methods

### `runStep(step, options) -> Promise<Object>`

Execute a single tool step through the executor.

**Input:**
- `step.tool_id` (string) - Tool identifier (e.g., `shell`, `file.read`, `file.list`)
- `step.args` (object) - Tool-specific arguments
- `options.logsDir` (string) - Directory path for writing evidence logs

**Output:**
```javascript
{
  tool_id: string,              // Echo of input tool_id
  result: {                     // Normalized tool result
    exit_code: number,          // 0 = success, non-zero = failure
    stdout: string,             // Standard output
    stderr: string              // Standard error (empty if none)
  },
  session_id?: string,          // Executor session identifier (if applicable)
  engine_ref?: string,           // Executor engine reference (image/version)
  evidence_refs?: string[],     // Array of evidence file paths
  // Additional executor-specific fields allowed
}
```

### `getHttpTrace() -> Array<Object>`

Return HTTP request/response trace for evidence (if applicable).

**Output:**
```javascript
[
  {
    method: string,
    url: string,
    request_body?: any,
    response_status?: number,
    response_body?: any,
    timestamp: string
  },
  ...
]
```

### `getSseEvents() -> Array<Object>`

Return SSE events captured during execution (if applicable).

**Output:**
```javascript
[
  {
    type: string,
    data: any,
    timestamp: string
  },
  ...
]
```

## Evidence Requirements

All drivers must:

1. **Write evidence files** to `options.logsDir`:
   - HTTP trace logs (if HTTP-based)
   - SSE event logs (if SSE-based)
   - Any other executor-specific evidence

2. **Return `evidence_refs`** array in `runStep` result:
   - Paths relative to project root or absolute
   - Must be accessible for post-execution analysis

3. **Include `engine_ref`** in result:
   - Executor engine identifier (image digest, version, etc.)
   - Used for provenance tracking

## Error Handling

- **Network/connection errors**: Throw Error with descriptive message
- **Tool execution failures**: Return `result.exit_code !== 0`, do not throw
- **Invalid step configuration**: Throw Error before execution

## Example Implementation

```javascript
export class MyDriver {
  async runStep(step, { logsDir }) {
    // 1. Execute tool via executor API
    // 2. Write evidence to logsDir
    // 3. Normalize result
    return {
      tool_id: step.tool_id,
      result: {
        exit_code: 0,
        stdout: "...",
        stderr: ""
      },
      engine_ref: "my-executor@v1.0.0",
      evidence_refs: [`${logsDir}/http_trace.jsonl`]
    };
  }
  
  getHttpTrace() { return []; }
  getSseEvents() { return []; }
}

export function createDriver(options) {
  return new MyDriver(options);
}
```

