/**
 * MOVA Cloudflare Worker Tool Gateway v0
 * 
 * Executor gateway that handles tool execution requests with:
 * - Policy checking (deny-by-default, allowlist)
 * - Evidence collection (R2 artifacts, D1 episodes)
 * - Tool execution (v0: kv.get, http.fetch GET only)
 * - Schema registry and payload validation (WF_EX_SCHEMA_PAYLOAD_002)
 */

import { Validator } from '@cfworker/json-schema';

interface Env {
  POLICY_KV: any; // KVNamespace
  EPISODES_DB: any; // D1Database
  ARTIFACTS: any; // R2Bucket
  GATEWAY_VERSION: string;
  GATEWAY_AUTH_TOKEN: string;
  DEFAULT_POLICY_REF: string;
  ADMIN_AUTH_TOKEN?: string; // Optional admin token for V2 inline schema
  ALLOW_INLINE_SCHEMA?: string; // "true" to allow inline schema in dev
}

interface ToolRequest {
  request_id?: string;
  envelope_id?: string;
  tool_id: string;
  args: Record<string, any>;
  ctx?: {
    run_id?: string;
    step_id?: string;
    policy_ref?: string;
  };
}

interface PolicyProfile {
  policy_id: string;
  policy_version: string;
  default_decision: 'allow' | 'deny';
  tool_allowlist?: string[];
  http_fetch_hostname_allowlist?: string[];
}

interface ToolResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  data?: any;
  status?: number;
  headers?: Record<string, string>;
}

interface GatewayResponse {
  ok: boolean;
  tool_result?: ToolResult;
  policy_check?: {
    decision: 'allow' | 'deny';
    reason: string;
    rule_id?: string;
  };
  evidence_refs?: string[];
  engine_ref: string;
}

// Schema registry interfaces
interface SchemaPutRequest {
  schema_id: string;
  version: string;
  schema_json: any;
}

interface SchemaMeta {
  ts: number;
  sha256: string;
  size: number;
}

interface PayloadValidateRequest {
  variant: 'v0' | 'v1' | 'v2';
  schema_ref?: string; // For V1: "payload@v2"
  schema_inline?: any; // For V2: inline schema JSON
  payload: any;
  strict?: boolean;
}

interface PayloadValidateResponse {
  ok: boolean;
  valid: boolean;
  errors: string[];
  policy_check?: {
    decision: 'allow' | 'deny';
    reason: string;
    rule_id?: string;
  };
  ds_payload_ref?: string;
  ds_payload_hash?: string;
  cache_hit: boolean;
  compile_ms: number;
  validate_ms: number;
  engine_ref: string;
  evidence_refs: string[];
}

interface EpisodeStoreEnvelope {
  mova_version: string;
  envelope_type: string;
  envelope_id: string;
  requested_by?: string;
  requested_at?: string;
  episode: Record<string, any>;
}

interface EpisodeStoreMeta {
  episode_id: string;
  type: string;
  source: string;
  run_id: string | null;
  created_ts: number;
  stored_ts: number;
}

interface EpisodeSearchRequest {
  episode_id?: string;
  type?: string;
  source?: string;
  run_id?: string;
  since_ts?: number;
  until_ts?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}

// Validator cache entry
interface CachedValidator {
  validator: Validator;
  timestamp: number;
}

// Global schema validator cache (per-request isolation in Workers)
// In production, this would be per-isolate, but we'll use a module-level Map
const schemaCache = new Map<string, CachedValidator>();

/**
 * Generate engine identity evidence
 */
function generateEngineIdentity(request: Request, env: Env): Record<string, any> {
  const cf = (request as any).cf || {};
  return {
    gateway_version: env.GATEWAY_VERSION,
    cf_metadata: {
      colo: cf.colo || 'unknown',
      country: cf.country || 'unknown',
      asn: cf.asn || 'unknown'
    },
    config: {
      bindings: {
        kv_namespaces: ['POLICY_KV'],
        d1_databases: ['EPISODES_DB'],
        r2_buckets: ['ARTIFACTS']
      },
      env: 'production' // Could be determined from request headers or env vars
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Load policy from KV
 */
async function loadPolicy(policyRef: string, env: Env): Promise<PolicyProfile | null> {
  // First, get active version
  const versionKey = `policy:active:${policyRef}`;
  const version = await env.POLICY_KV.get(versionKey);
  
  if (!version) {
    return null;
  }
  
  // Then, get policy profile
  const policyKey = `policy:${policyRef}:${version}`;
  const policyJson = await env.POLICY_KV.get(policyKey);
  
  if (!policyJson) {
    return null;
  }
  
  return JSON.parse(policyJson) as PolicyProfile;
}

/**
 * Check policy decision
 */
function checkPolicy(
  toolId: string,
  args: Record<string, any>,
  policy: PolicyProfile
): { decision: 'allow' | 'deny'; reason: string; rule_id?: string } {
  // Default deny
  if (policy.default_decision === 'deny') {
    // Check tool allowlist
    if (policy.tool_allowlist && policy.tool_allowlist.includes(toolId)) {
      // Additional check for http.fetch hostname allowlist
      if (toolId === 'http.fetch' && args.url) {
        try {
          const url = new URL(args.url);
          const hostname = url.hostname;
          
          if (policy.http_fetch_hostname_allowlist && 
              policy.http_fetch_hostname_allowlist.length > 0 &&
              !policy.http_fetch_hostname_allowlist.includes(hostname)) {
            return {
              decision: 'deny',
              reason: `Hostname ${hostname} not in allowlist`,
              rule_id: 'http_fetch_hostname_check'
            };
          }
        } catch (e) {
          return {
            decision: 'deny',
            reason: `Invalid URL: ${e}`,
            rule_id: 'http_fetch_url_validation'
          };
        }
      }
      
      return {
        decision: 'allow',
        reason: `Tool ${toolId} is in allowlist`,
        rule_id: 'tool_allowlist_match'
      };
    }
    
    return {
      decision: 'deny',
      reason: `Tool ${toolId} not in allowlist (default deny)`,
      rule_id: 'default_deny'
    };
  }
  
  // Default allow (less common)
  return {
    decision: 'allow',
    reason: 'Default allow policy',
    rule_id: 'default_allow'
  };
}

/**
 * Execute tool (v0: kv.get, http.fetch GET only)
 */
async function executeTool(
  toolId: string,
  args: Record<string, any>,
  env: Env
): Promise<ToolResult> {
  if (toolId === 'kv.get') {
    const key = args.key;
    if (!key || typeof key !== 'string') {
      return {
        exit_code: 1,
        stdout: '',
        stderr: 'kv.get requires key (string)'
      };
    }
    
    try {
      // KV.get returns null if key is missing (not an error)
      const value = await env.POLICY_KV.get(key);
      
      // Missing key (null) is success with exit_code=0, data=null
      // Only real errors (binding issues, exceptions) should return exit_code != 0
      return {
        exit_code: 0,
        stdout: '',
        stderr: '',
        data: value // null if key not found, string if found
      };
    } catch (error: any) {
      // Real execution error (binding issue, exception, etc.)
      return {
        exit_code: 1,
        stdout: '',
        stderr: `kv.get error: ${error.message || 'Unknown error'}`,
        data: null
      };
    }
  }
  
  if (toolId === 'http.fetch') {
    const url = args.url;
    if (!url || typeof url !== 'string') {
      return {
        exit_code: 1,
        stdout: '',
        stderr: 'http.fetch requires url (string)'
      };
    }
    
    // v0: GET only
    const method = args.method || 'GET';
    if (method !== 'GET') {
      return {
        exit_code: 1,
        stdout: '',
        stderr: 'http.fetch v0 supports GET only'
      };
    }
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: args.headers || {}
      });
      
      const text = await response.text();
      
      // Extract subset of headers
      const headers: Record<string, string> = {};
      const headerNames = ['content-type', 'content-length', 'cache-control'];
      headerNames.forEach(name => {
        const value = response.headers.get(name);
        if (value) {
          headers[name] = value;
        }
      });
      
      return {
        exit_code: response.ok ? 0 : 1,
        stdout: text,
        stderr: response.ok ? '' : `HTTP ${response.status}`,
        data: text,
        status: response.status,
        headers
      };
    } catch (error: any) {
      return {
        exit_code: 1,
        stdout: '',
        stderr: `Fetch error: ${error.message}`
      };
    }
  }
  
  return {
    exit_code: 1,
    stdout: '',
    stderr: `Unknown tool: ${toolId}`
  };
}

/**
 * Compute SHA256 hash (using Web Crypto API)
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Load schema from KV by schema_ref (e.g., "payload@v2")
 */
async function loadSchema(schemaRef: string, env: Env): Promise<any | null> {
  const [schemaId, version] = schemaRef.split('@');
  if (!schemaId || !version) {
    return null;
  }
  
  const schemaKey = `schema:${schemaId}:${version}`;
  const schemaJson = await env.POLICY_KV.get(schemaKey);
  
  if (!schemaJson) {
    return null;
  }
  
  return JSON.parse(schemaJson);
}

/**
 * Prepare schema validator (with caching)
 * Uses @cfworker/json-schema which is worker-safe (no code generation)
 */
function prepareSchemaValidator(schemaJson: any, schemaHash: string): CachedValidator {
  // Check cache
  const cached = schemaCache.get(schemaHash);
  if (cached) {
    return cached;
  }
  
  // Create new validator instance
  // @cfworker/json-schema is worker-safe and doesn't use code generation
  const validator = new Validator(schemaJson);
  
  const cachedValidator: CachedValidator = {
    validator,
    timestamp: Date.now()
  };
  
  // Cache it (with size limit - simple LRU eviction)
  if (schemaCache.size > 100) {
    // Simple eviction: clear oldest 50%
    const entries = Array.from(schemaCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 50; i++) {
      schemaCache.delete(entries[i][0]);
    }
  }
  schemaCache.set(schemaHash, cachedValidator);
  
  return cachedValidator;
}

function parseTimestamp(input: any): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const parsed = Date.parse(input);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function extractEpisodeMetadata(envelope: EpisodeStoreEnvelope): EpisodeStoreMeta {
  const episode = envelope.episode || {};
  const summary = episode.summary || {};
  const context = episode.context || {};

  const episodeId = episode.episode_id || envelope.envelope_id || `episode_${Date.now()}`;
  const type =
    episode.type ||
    summary.type ||
    context.executor ||
    envelope.requested_by ||
    'unknown';
  const source =
    envelope.requested_by ||
    context.executor ||
    context.source ||
    'unknown';
  const runId = summary.run_id || summary.runId || null;
  const createdTs = parseTimestamp(episode.ts || envelope.requested_at);
  const storedTs = Date.now();

  return {
    episode_id: episodeId,
    type,
    source,
    run_id: runId ? String(runId) : null,
    created_ts: createdTs,
    stored_ts: storedTs
  };
}

/**
 * Handle schema put request (admin only)
 */
async function handleSchemaPut(request: Request, env: Env): Promise<Response> {
  try {
    // Check admin auth
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const token = authHeader.substring(7);
    const isAdmin = env.ADMIN_AUTH_TOKEN && token === env.ADMIN_AUTH_TOKEN;
    if (!isAdmin && token !== env.GATEWAY_AUTH_TOKEN) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid auth token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const body = await request.json() as SchemaPutRequest;
    
    // Validate schema_id and version
    if (!body.schema_id || typeof body.schema_id !== 'string') {
      return new Response(
        JSON.stringify({ ok: false, error: 'schema_id required (string)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (!/^[a-zA-Z0-9._-]+$/.test(body.schema_id)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid schema_id format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (!body.version || typeof body.version !== 'string') {
      return new Response(
        JSON.stringify({ ok: false, error: 'version required (string)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (!/^[a-zA-Z0-9._-]+$/.test(body.version)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid version format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (body.schema_id.length > 128 || body.version.length > 64) {
      return new Response(
        JSON.stringify({ ok: false, error: 'schema_id or version too long' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate schema_json
    if (!body.schema_json || typeof body.schema_json !== 'object') {
      return new Response(
        JSON.stringify({ ok: false, error: 'schema_json required (object)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const schemaJsonStr = JSON.stringify(body.schema_json);
    const schemaSize = new TextEncoder().encode(schemaJsonStr).length;
    
    // Size limit: 64KB
    if (schemaSize > 64 * 1024) {
      return new Response(
        JSON.stringify({ ok: false, error: 'schema_json too large (max 64KB)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Compute hash
    const schemaHash = await sha256(schemaJsonStr);
    
    // Write to KV
    const schemaKey = `schema:${body.schema_id}:${body.version}`;
    await env.POLICY_KV.put(schemaKey, schemaJsonStr);
    
    // Write metadata
    const metaKey = `schema:meta:${body.schema_id}:${body.version}`;
    const meta: SchemaMeta = {
      ts: Date.now(),
      sha256: schemaHash,
      size: schemaSize
    };
    await env.POLICY_KV.put(metaKey, JSON.stringify(meta));
    
    // Update active version (optional, but useful)
    const activeKey = `schema:active:${body.schema_id}`;
    await env.POLICY_KV.put(activeKey, body.version);
    
    return new Response(
      JSON.stringify({
        ok: true,
        schema_ref: `${body.schema_id}@${body.version}`,
        schema_hash: schemaHash
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle schema get request
 */
async function handleSchemaGet(request: Request, env: Env): Promise<Response> {
  try {
    // Check auth
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const token = authHeader.substring(7);
    if (token !== env.GATEWAY_AUTH_TOKEN && token !== env.ADMIN_AUTH_TOKEN) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid auth token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const url = new URL(request.url);
    const schemaId = url.searchParams.get('schema_id');
    const version = url.searchParams.get('version');
    
    if (!schemaId || !version) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing schema_id or version parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const schemaKey = `schema:${schemaId}:${version}`;
    const schemaJson = await env.POLICY_KV.get(schemaKey);
    
    if (!schemaJson) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Schema not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(schemaJson, {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Write payload validate episode to D1
 */
async function writePayloadValidateEpisode(
  requestId: string,
  runId: string,
  stepId: string,
  engineRef: string,
  variant: string,
  dsPayloadRef: string | undefined,
  dsPayloadHash: string | undefined,
  cacheHit: boolean,
  compileMs: number,
  validateMs: number,
  valid: boolean,
  errors: string[],
  evidenceRefs: string[],
  payload: any,
  env: Env
): Promise<void> {
  const ts = Date.now();
  const type = 'payload_validate';
  
  // Extend payload with experiment-specific fields
  // Ensure all required fields are present even if payload is undefined
  const episodePayload = {
    ...(payload || {}),
    variant: variant || 'unknown',
    ds_payload_ref: dsPayloadRef || null,
    ds_payload_hash: dsPayloadHash || null,
    cache_hit: cacheHit !== undefined ? cacheHit : false,
    compile_ms: compileMs !== undefined ? compileMs : 0,
    validate_ms: validateMs !== undefined ? validateMs : 0,
    valid: valid !== undefined ? valid : false,
    errors: errors || []
  };
  
  const payloadJsonStr = JSON.stringify(episodePayload);
  
  await env.EPISODES_DB.prepare(`
    INSERT INTO episodes (
      id, ts, type, run_id, step_id, policy_ref, policy_version,
      engine_ref, decision, reason, evidence_refs_json, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    requestId,
    ts,
    type,
    runId,
    stepId,
    'schema_payload_experiment',
    'v1',
    engineRef,
    valid ? 'allow' : 'deny',
    valid ? 'Payload valid' : `Payload invalid: ${errors.join('; ')}`,
    JSON.stringify(evidenceRefs),
    payloadJsonStr
  ).run();
}

/**
 * Handle payload validate request
 */
async function handlePayloadValidate(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  let requestId = `payload_validate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Check auth
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const token = authHeader.substring(7);
    const isAdmin = env.ADMIN_AUTH_TOKEN && token === env.ADMIN_AUTH_TOKEN;
    const isRegular = token === env.GATEWAY_AUTH_TOKEN;
    
    if (!isAdmin && !isRegular) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid auth token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const body = await request.json() as PayloadValidateRequest;
    
    // Generate engine identity
    const engineIdentity = generateEngineIdentity(request, env);
    const engineRef = `${env.GATEWAY_VERSION}@${(request as any).cf?.colo || 'unknown'}`;
    
    // Prepare evidence refs
    const evidenceRefs: string[] = [];
    const runId = `run_${requestId}`;
    const stepId = `step_${requestId}`;
    
    // Write request artifact
    const requestKey = `payload_validate/${requestId}/request.json`;
    await env.ARTIFACTS.put(requestKey, JSON.stringify(body, null, 2));
    evidenceRefs.push(requestKey);
    
    // Write engine identity
    const identityKey = `payload_validate/${requestId}/engine_identity.json`;
    await env.ARTIFACTS.put(identityKey, JSON.stringify(engineIdentity, null, 2));
    evidenceRefs.push(identityKey);
    
    let schemaJson: any = null;
    let schemaHash: string = '';
    let dsPayloadRef: string | undefined = undefined;
    let cacheHit = false;
    let compileMs = 0;
    let validateMs = 0;
    let valid = false;
    let errors: string[] = [];
    
    // V0: Hardcoded schema
    if (body.variant === 'v0') {
      // Load hardcoded ds.payload_v1 schema
      // For simplicity, we'll embed a minimal version here
      schemaJson = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["kind", "data"],
        "properties": {
          "kind": { "type": "string" },
          "data": { "type": "object", "additionalProperties": true },
          "meta": { "type": "object", "additionalProperties": true }
        }
      };
      const schemaJsonStr = JSON.stringify(schemaJson);
      schemaHash = await sha256(schemaJsonStr);
      dsPayloadRef = 'payload@v1';
    }
    // V1: Schema from registry
    else if (body.variant === 'v1') {
      if (!body.schema_ref) {
        return new Response(
          JSON.stringify({ ok: false, error: 'schema_ref required for variant v1' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      schemaJson = await loadSchema(body.schema_ref, env);
      if (!schemaJson) {
        return new Response(
          JSON.stringify({ ok: false, error: `Schema ${body.schema_ref} not found` }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      const schemaJsonStr = JSON.stringify(schemaJson);
      schemaHash = await sha256(schemaJsonStr);
      dsPayloadRef = body.schema_ref;
    }
    // V2: Inline schema (dangerous - requires admin or ALLOW_INLINE_SCHEMA)
    else if (body.variant === 'v2') {
      // Check policy: deny by default
      const allowInline = env.ALLOW_INLINE_SCHEMA === 'true' || isAdmin;
      if (!allowInline) {
        // Policy check: deny V2 inline schema
        const policyCheck = {
          decision: 'deny' as const,
          reason: 'V2 inline schema not allowed (deny-by-default)',
          rule_id: 'v2_inline_schema_deny'
        };
        
        // Write deny episode
        const denyKey = `payload_validate/${requestId}/policy_deny.json`;
        await env.ARTIFACTS.put(denyKey, JSON.stringify(policyCheck, null, 2));
        evidenceRefs.push(denyKey);
        
        await writePayloadValidateEpisode(
          requestId,
          runId,
          stepId,
          engineRef,
          'v2',
          undefined,
          undefined,
          false,
          0,
          0,
          false,
          [policyCheck.reason],
          evidenceRefs,
          body.payload || {}, // Pass the payload being validated (if any)
          env
        );
        
        return new Response(
          JSON.stringify({
            ok: true,
            valid: false,
            errors: [policyCheck.reason],
            policy_check: policyCheck,
            cache_hit: false,
            compile_ms: 0,
            validate_ms: 0,
            engine_ref: engineRef,
            evidence_refs: evidenceRefs
          } as PayloadValidateResponse),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      if (!body.schema_inline) {
        return new Response(
          JSON.stringify({ ok: false, error: 'schema_inline required for variant v2' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      schemaJson = body.schema_inline;
      const schemaJsonStr = JSON.stringify(schemaJson);
      schemaHash = await sha256(schemaJsonStr);
      dsPayloadRef = 'inline@v2';
    }
    else {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid variant (must be v0, v1, or v2)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Compute payload hash
    const payloadJsonStr = JSON.stringify(body.payload);
    const payloadHash = await sha256(payloadJsonStr);
    
    // Prepare schema validator (with caching)
    const compileStart = Date.now();
    const cached = schemaCache.get(schemaHash);
    let cachedValidator: CachedValidator;
    
    if (cached) {
      cacheHit = true;
      cachedValidator = cached;
      compileMs = 0;
    } else {
      cacheHit = false;
      cachedValidator = prepareSchemaValidator(schemaJson, schemaHash);
      compileMs = Date.now() - compileStart;
    }
    
    // Validate payload
    const validateStart = Date.now();
    const validationResult = cachedValidator.validator.validate(body.payload);
    validateMs = Date.now() - validateStart;
    
    valid = validationResult.valid;
    
    if (!valid && validationResult.errors) {
      errors = validationResult.errors.map((e: any) => {
        // @cfworker/json-schema error format: { instanceLocation, error, keyword, keywordLocation }
        const path = e.instanceLocation || '/';
        const message = e.error || 'Validation error';
        return `${path}: ${message}`;
      });
    }
    
    // Write validation result
    const resultKey = `payload_validate/${requestId}/validate_result.json`;
    const validateResultData = {
      valid,
      errors,
      ds_payload_ref: dsPayloadRef,
      ds_payload_hash: payloadHash,
      cache_hit: cacheHit,
      compile_ms: compileMs,
      validate_ms: validateMs
    };
    await env.ARTIFACTS.put(resultKey, JSON.stringify(validateResultData, null, 2));
    evidenceRefs.push(resultKey);
    
    // Write response
    const responseKey = `payload_validate/${requestId}/response.json`;
    const response: PayloadValidateResponse = {
      ok: true,
      valid,
      errors,
      // Add policy_check for successful validations (allow)
      policy_check: valid ? {
        decision: 'allow' as const,
        reason: 'Payload valid',
        rule_id: 'payload_validation_pass'
      } : undefined,
      ds_payload_ref: dsPayloadRef,
      ds_payload_hash: payloadHash,
      cache_hit: cacheHit,
      compile_ms: compileMs,
      validate_ms: validateMs,
      engine_ref: engineRef,
      evidence_refs: evidenceRefs
    };
    await env.ARTIFACTS.put(responseKey, JSON.stringify(response, null, 2));
    evidenceRefs.push(responseKey);
    
    // Write episode
    await writePayloadValidateEpisode(
      requestId,
      runId,
      stepId,
      engineRef,
      body.variant,
      dsPayloadRef,
      payloadHash,
      cacheHit,
      compileMs,
      validateMs,
      valid,
      errors,
      evidenceRefs,
      body.payload, // Pass the actual payload being validated
      env
    );
    
    return new Response(
      JSON.stringify(response, null, 2),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Write episode to D1
 */
async function writeEpisode(
  requestId: string,
  runId: string,
  stepId: string,
  policyRef: string,
  policyVersion: string,
  engineRef: string,
  decision: 'allow' | 'deny',
  reason: string,
  evidenceRefs: string[],
  payload: any,
  env: Env
): Promise<void> {
  const ts = Date.now();
  const type = decision === 'allow' ? 'tool_execution' : 'policy_deny';
  
  await env.EPISODES_DB.prepare(`
    INSERT INTO episodes (
      id, ts, type, run_id, step_id, policy_ref, policy_version,
      engine_ref, decision, reason, evidence_refs_json, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    requestId,
    ts,
    type,
    runId,
    stepId,
    policyRef,
    policyVersion,
    engineRef,
    decision,
    reason,
    JSON.stringify(evidenceRefs),
    JSON.stringify(payload)
  ).run();
}

/**
 * Handle episode store request
 */
async function handleEpisodeStore(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as EpisodeStoreEnvelope;
    if (!body || typeof body !== 'object') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (body.mova_version !== '4.0.0') {
      return new Response(
        JSON.stringify({ ok: false, error: 'mova_version must be 4.0.0' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (body.envelope_type !== 'env.skill_ingest_run_store_episode_v1') {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid envelope_type' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!body.episode || typeof body.episode !== 'object') {
      return new Response(
        JSON.stringify({ ok: false, error: 'episode payload required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (body.episode.mova_version !== '4.0.0') {
      return new Response(
        JSON.stringify({ ok: false, error: 'episode.mova_version must be 4.0.0' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const meta = extractEpisodeMetadata(body);
    const episodeJson = JSON.stringify(body.episode);
    const envelopeJson = JSON.stringify(body);

    const stmt = env.EPISODES_DB.prepare(`
      INSERT INTO memory_episodes (
        episode_id, type, source, run_id, created_ts, stored_ts, episode_json, envelope_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        type=excluded.type,
        source=excluded.source,
        run_id=excluded.run_id,
        created_ts=excluded.created_ts,
        stored_ts=excluded.stored_ts,
        episode_json=excluded.episode_json,
        envelope_json=excluded.envelope_json
    `);

    const result = await stmt.bind(
      meta.episode_id,
      meta.type,
      meta.source,
      meta.run_id,
      meta.created_ts,
      meta.stored_ts,
      episodeJson,
      envelopeJson
    ).run();

    const replaced = (result.meta?.changes ?? 0) > 1;

    return new Response(
      JSON.stringify({
        ok: true,
        episode_id: meta.episode_id,
        type: meta.type,
        source: meta.source,
        run_id: meta.run_id,
        created_ts: meta.created_ts,
        stored_ts: meta.stored_ts,
        replaced
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle episode search request
 */
async function handleEpisodeSearch(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as EpisodeSearchRequest;
    const limit = Math.min(Math.max(body.limit ?? 20, 1), 100);
    const order = body.order === 'asc' ? 'ASC' : 'DESC';

    let query = `
      SELECT episode_id, type, source, run_id, created_ts, stored_ts, episode_json
      FROM memory_episodes
      WHERE 1=1
    `;
    const bindings: any[] = [];

    if (body.episode_id) {
      query += ' AND episode_id = ?';
      bindings.push(body.episode_id);
    }
    if (body.type) {
      query += ' AND type = ?';
      bindings.push(body.type);
    }
    if (body.source) {
      query += ' AND source = ?';
      bindings.push(body.source);
    }
    if (body.run_id) {
      query += ' AND run_id = ?';
      bindings.push(body.run_id);
    }
    if (body.since_ts) {
      query += ' AND stored_ts >= ?';
      bindings.push(body.since_ts);
    }
    if (body.until_ts) {
      query += ' AND stored_ts <= ?';
      bindings.push(body.until_ts);
    }

    query += ` ORDER BY stored_ts ${order} LIMIT ?`;
    bindings.push(limit);

    const stmt = env.EPISODES_DB.prepare(query);
    const result = await stmt.bind(...bindings).all();

    const results = (result.results || []).map((row: any) => {
      let episodePayload: any = null;
      try {
        episodePayload = row.episode_json ? JSON.parse(row.episode_json) : null;
      } catch {
        episodePayload = null;
      }
      return {
        episode_id: row.episode_id,
        type: row.type,
        source: row.source,
        run_id: row.run_id,
        created_ts: row.created_ts,
        stored_ts: row.stored_ts,
        episode: episodePayload
      };
    });

    return new Response(
      JSON.stringify({ ok: true, count: results.length, results }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle artifact get request
 */
async function handleArtifactGet(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const ref = url.searchParams.get('ref');
    
    if (!ref) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing ref parameter' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate ref
    if (ref.length > 512) {
      return new Response(
        JSON.stringify({ ok: false, error: 'ref too long (max 512)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (!/^[a-zA-Z0-9._/-]+$/.test(ref)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid ref format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (ref.includes('..')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'ref must not contain ..' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (ref.startsWith('/')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'ref must not start with /' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Get from R2
    const object = await env.ARTIFACTS.get(ref);
    
    if (!object) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Artifact not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Determine content type
    let contentType = 'application/octet-stream';
    if (ref.endsWith('.json')) {
      contentType = 'application/json';
    } else if (ref.endsWith('.jsonl')) {
      contentType = 'application/x-ndjson';
    }
    
    // Get body
    const body = await object.arrayBuffer();
    
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle tool execution request
 */
async function handleToolRun(request: Request, env: Env): Promise<Response> {
  // Parse request
  const body = await request.json() as ToolRequest;
  
  // Validate required fields
  const requestId = body.request_id || body.envelope_id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const toolId = body.tool_id;
  const args = body.args || {};
  const ctx = body.ctx || {};
  
  if (!toolId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'tool_id required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // Derive deterministic IDs
  const runId = ctx.run_id || `run_${requestId}`;
  const stepId = ctx.step_id || `step_${requestId}`;
  const policyRef = ctx.policy_ref || env.DEFAULT_POLICY_REF;
  
  // Load policy
  const policy = await loadPolicy(policyRef, env);
  
  if (!policy) {
    return new Response(
      JSON.stringify({ ok: false, error: `Policy ${policyRef} not found` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // Check policy
  const policyCheck = checkPolicy(toolId, args, policy);
  
  // Generate engine identity
  const engineIdentity = generateEngineIdentity(request, env);
  const engineRef = `${env.GATEWAY_VERSION}@${(request as any).cf?.colo || 'unknown'}`;
  
  // Prepare evidence refs
  const evidenceRefs: string[] = [];
  const timestamp = Date.now();
  
  // Write request artifact
  const requestKey = `requests/${requestId}/request.json`;
  await env.ARTIFACTS.put(requestKey, JSON.stringify(body, null, 2));
  evidenceRefs.push(requestKey);
  
  // Write engine identity
  const identityKey = `requests/${requestId}/engine_identity.json`;
  await env.ARTIFACTS.put(identityKey, JSON.stringify(engineIdentity, null, 2));
  evidenceRefs.push(identityKey);
  
  if (policyCheck.decision === 'deny') {
    // DENY path: write policy decision, no side effects
    const decisionKey = `requests/${requestId}/policy_decision.json`;
    await env.ARTIFACTS.put(decisionKey, JSON.stringify(policyCheck, null, 2));
    evidenceRefs.push(decisionKey);
    
    // Write episode
    await writeEpisode(
      requestId,
      runId,
      stepId,
      policyRef,
      policy.policy_version,
      engineRef,
      'deny',
      policyCheck.reason,
      evidenceRefs,
      { request: body, policy_check: policyCheck },
      env
    );
    
    const response: GatewayResponse = {
      ok: false,
      policy_check: policyCheck,
      evidence_refs: evidenceRefs,
      engine_ref: engineRef
    };
    
    return new Response(
      JSON.stringify(response, null, 2),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  // ALLOW path: execute tool
  const toolResult = await executeTool(toolId, args, env);
  
  // Write tool result
  const resultKey = `requests/${requestId}/tool_result.json`;
  await env.ARTIFACTS.put(resultKey, JSON.stringify(toolResult, null, 2));
  evidenceRefs.push(resultKey);
  
  // Write response
  const responseKey = `requests/${requestId}/response.json`;
  const gatewayResponse: GatewayResponse = {
    ok: true,
    tool_result: toolResult,
    policy_check: policyCheck,
    evidence_refs: evidenceRefs,
    engine_ref: engineRef
  };
  await env.ARTIFACTS.put(responseKey, JSON.stringify(gatewayResponse, null, 2));
  evidenceRefs.push(responseKey);
  
  // Write episode
  await writeEpisode(
    requestId,
    runId,
    stepId,
    policyRef,
    policy.policy_version,
    engineRef,
    'allow',
    policyCheck.reason,
    evidenceRefs,
    { request: body, tool_result: toolResult, policy_check: policyCheck },
    env
  );
  
  return new Response(
    JSON.stringify(gatewayResponse, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Main fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      const cf = (request as any).cf || {};
      return new Response(
        JSON.stringify({
          ok: true,
          engine_ref: `${env.GATEWAY_VERSION}@${cf.colo || 'unknown'}`,
          time: new Date().toISOString()
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Tool execution
    if (url.pathname === '/tool/run' && request.method === 'POST') {
      // Check auth
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      const token = authHeader.substring(7);
      if (token !== env.GATEWAY_AUTH_TOKEN) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid auth token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      return handleToolRun(request, env);
    }
    
    // Episode store
    if (url.pathname === '/episode/store' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const token = authHeader.substring(7);
      if (token !== env.GATEWAY_AUTH_TOKEN) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid auth token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return handleEpisodeStore(request, env);
    }

    // Episode search
    if (url.pathname === '/episode/search' && request.method === 'POST') {
      // Check auth
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      const token = authHeader.substring(7);
      if (token !== env.GATEWAY_AUTH_TOKEN) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid auth token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      return handleEpisodeSearch(request, env);
    }
    
    // Artifact get
    if (url.pathname === '/artifact/get' && request.method === 'GET') {
      // Check auth
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Missing or invalid Authorization header' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      const token = authHeader.substring(7);
      if (token !== env.GATEWAY_AUTH_TOKEN) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Invalid auth token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      
      return handleArtifactGet(request, env);
    }
    
    // Schema put (admin only)
    if (url.pathname === '/schema/put' && request.method === 'POST') {
      return handleSchemaPut(request, env);
    }
    
    // Schema get
    if (url.pathname === '/schema/get' && request.method === 'GET') {
      return handleSchemaGet(request, env);
    }
    
    // Payload validate
    if (url.pathname === '/payload/validate' && request.method === 'POST') {
      return handlePayloadValidate(request, env);
    }
    
    // 404 for unknown routes
    return new Response(
      JSON.stringify({ ok: false, error: 'Not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

