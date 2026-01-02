import gatewayPolicyConfig from "../config/gateway_policy_v0.json" with { type: "json" };
import gatewayRoutesConfig from "../config/gateway_routes_v0.json" with { type: "json" };
// Note: For Node.js runtime compatibility, the signature library functions are implemented directly in this file
// The original import was: import { signRequest } from "./lib/gw_sig_v0.ts";

const gatewayPolicyLocal = gatewayPolicyConfig;
const gatewayRoutesLocal = (gatewayRoutesConfig.routes || []);

// Signature library functions for gateway
async function sha256Hex(input) {
  // Use Node.js crypto for server-side execution
  if (typeof require !== 'undefined') {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(input).digest('hex');
  }
  // Use Web Crypto API for browser/worker execution
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signRequest(
  method,
  pathname,
  body,
  secretKey
) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodySha256 = await sha256Hex(body);

  // Canonical string to sign
  const stringToSign = `${method}\n${pathname}\n${ts}\n${bodySha256}`;

  // Create HMAC signature
  if (typeof require !== 'undefined') {
    // Node.js implementation
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(stringToSign);
    const signatureHex = hmac.digest('hex');

    // Generate request ID
    const requestId = crypto.randomUUID();

    return {
      headers: {
        'x-gw-request-id': requestId,
        'x-gw-ts': ts,
        'x-gw-body-sha256': bodySha256,
        'x-gw-sig': signatureHex,
      },
      body
    };
  } else {
    // Web Crypto API implementation for Cloudflare Workers
    const encoder = new TextEncoder();
    const keyBuffer = encoder.encode(secretKey);
    const signingKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      signingKey,
      encoder.encode(stringToSign)
    );

    // Convert signature to hex
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Generate request ID
    const requestId = crypto.randomUUID();

    return {
      headers: {
        'x-gw-request-id': requestId,
        'x-gw-ts': ts,
        'x-gw-body-sha256': bodySha256,
        'x-gw-sig': signatureHex,
      },
      body
    };
  }
}

const DEFAULT_GATEWAY_TIMEOUT_MS = 1500;
const DEFAULT_GATEWAY_RESPONSE_LIMIT = 64 * 1024;
const MAX_GATEWAY_REQUEST_BYTES = 16 * 1024;

function makeLogEntry(stage, message, level = "info", data) {
  return {
    at: new Date().toISOString(),
    level,
    stage,
    message,
    data
  };
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(secret, message) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  return toHex(signature);
}

async function readJsonWithLimit(request, maxBytes) {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      return {
        error: {
          code: "request_too_large",
          message: `Request body ${contentLength} bytes exceeds limit ${maxBytes}`
        }
      };
    }
  }
  const clone = request.clone();
  const buffer = await clone.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    return {
      error: {
        code: "request_too_large",
        message: `Request body ${buffer.byteLength} bytes exceeds limit ${maxBytes}`
      }
    };
  }
  const text = new TextDecoder().decode(buffer);
  if (!text) {
    return { body: {} };
  }
  try {
    const body = JSON.parse(text);
    return { body };
  } catch (error) {
    return {
      error: {
        code: "invalid_json",
        message: `Failed to parse JSON: ${error.message}`
      }
    };
  }
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  const record = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    return record;
  }
  Object.entries(headers).forEach(([key, value]) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

async function loadGatewayPolicy(env) {
  try {
    const kvPolicy = await env.POLICY_KV.get("gateway_policy_v0");
    if (kvPolicy) {
      return JSON.parse(kvPolicy);
    }
  } catch (error) {
    console.warn("[gateway] policy KV read failed", error);
  }
  return gatewayPolicyLocal;
}

async function loadGatewayRoutes(env) {
  try {
    const kvRoutes = await env.POLICY_KV.get("gateway_routes_v0");
    if (kvRoutes) {
      const parsed = JSON.parse(kvRoutes);
      if (parsed?.routes?.length) {
        return parsed.routes;
      }
    }
  } catch (error) {
    console.warn("[gateway] routes KV read failed", error);
  }
  return gatewayRoutesLocal;
}

function checkGatewayPolicy(domain, action, policy) {
  const allowRules = policy.allow || [];
  const rule = allowRules.find((entry) => entry.domain === domain);
  if (!rule) {
    return {
      decision: "deny",
      reason: `Domain ${domain} not in allowlist`,
      rule_id: "domain_not_allowed"
    };
  }
  if (rule.actions && !rule.actions.includes(action)) {
    return {
      decision: "deny",
      reason: `Action ${action} not allowed for domain ${domain}`,
      rule_id: "action_not_allowed"
    };
  }
  if (policy.default_decision === "deny") {
    return {
      decision: "allow",
      reason: `Matched allow rule for ${domain}/${action}`,
      rule_id: "allow_match"
    };
  }
  return {
    decision: "allow",
    reason: "Default allow (no deny rule matched)",
    rule_id: "default_allow"
  };
}

async function writeGatewayEvidence(requestId, policyEvents, logs, env) {
  const evidenceRefs = [];
  const base = `gateway/${requestId}`;
  try {
    if (env.ARTIFACTS?.put) {
      const policyKey = `${base}/policy_events.jsonl`;
      const logKey = `${base}/request_log.json`;
      await env.ARTIFACTS.put(policyKey, policyEvents.map((e) => JSON.stringify(e)).join("\n"));
      evidenceRefs.push(policyKey);
      await env.ARTIFACTS.put(logKey, JSON.stringify(logs, null, 2));
      evidenceRefs.push(logKey);
    }
  } catch (error) {
    console.warn("[gateway] failed to write evidence", error);
  }
  return evidenceRefs;
}

function resolveGatewayRoute(domain, action, routes) {
  return routes.find((route) => route.domain === domain && route.action === action) || null;
}

async function readResponseWithLimit(response, maxBytes) {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    return {
      error: {
        code: "response_too_large",
        message: `Response body ${buffer.byteLength} bytes exceeds limit ${maxBytes}`
      }
    };
  }
  const text = new TextDecoder().decode(buffer);
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return {
    result: {
      status: response.status,
      body,
      headers: normalizeHeaders(response.headers)
    }
  };
}

function applyQueryParams(base, query) {
  if (!query || Object.keys(query).length === 0) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function normalizePath(pathname) {
  if (!pathname) return "";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function joinUrl(base, pathname = "") {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = normalizePath(pathname);
  return `${normalizedBase}${normalizedPath}`;
}

function parseUrlSafe(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function invokeGatewayRoute(route, requestId, domain, action, body, env, logs) {
  const timeoutMs = route.timeout_ms ?? DEFAULT_GATEWAY_TIMEOUT_MS;
  const maxBytes = route.max_response_bytes ?? DEFAULT_GATEWAY_RESPONSE_LIMIT;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort("timeout");
  }, timeoutMs);
  const forwardPayload = {
    request_id: requestId,
    domain,
    action,
    payload: body.payload || {},
    meta: {
      gateway_version: env.GATEWAY_VERSION,
      received_at: new Date().toISOString()
    }
  };
  const baseHeaders = {
    "content-type": "application/json",
    "x-gw-request-id": requestId
  };
  let response;
  try {
    let invocationPromise;
    if (route.mode === "service") {
      const bindingName = route.service_binding || "";
      const binding = env[bindingName];
      if (!binding || typeof binding.fetch !== "function") {
        return {
          error: {
            code: "binding_missing",
            message: `Service binding ${bindingName || "<missing>"} not available`
          }
        };
      }
      const targetUrl = applyQueryParams(
        joinUrl(`https://${route.domain}`, route.path || `/${action}`),
        body.query
      );
      const headers = new Headers(baseHeaders);
      Object.entries(body.headers || {}).forEach(([key, value]) => headers.set(key, value));

      // Use the new signature library to sign the request for service binding
      const secret = route.hmac_secret_env ? env[route.hmac_secret_env] : env.GW_SECRET_KEY;
      if (secret) {
        const { headers: sigHeaders } = await signRequest(
          "POST",
          new URL(targetUrl).pathname,
          JSON.stringify(forwardPayload),
          secret
        );

        // Add signature headers to the request
        Object.entries(sigHeaders).forEach(([key, value]) => headers.set(key, value));
      } else {
        // If no secret is available, we still need to add the request ID header
        headers.set("x-gw-request-id", requestId);
      }

      invocationPromise = binding.fetch(
        new Request(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(forwardPayload),
          signal: controller.signal
        })
      );
    } else {
      const envUrl = route.env_url_key ? env?.[route.env_url_key] : null;
      const targetBase = envUrl || route.url || `https://${route.domain}`;
      if (!targetBase) {
        logs.push(
          makeLogEntry("route", "HTTPS route missing URL", "error", {
            domain,
            action,
            env_url_key: route.env_url_key || null
          })
        );
        return {
          error: {
            code: "route_url_missing",
            message: `No HTTPS target configured for ${domain}/${action}`
          }
        };
      }
      const parsedBase = parseUrlSafe(targetBase);
      const baseHasPath = !!(parsedBase && parsedBase.pathname && parsedBase.pathname !== "/");
      const targetPath = route.path || (baseHasPath ? "" : `/${action}`);
      const targetUrl = applyQueryParams(
        targetPath ? joinUrl(targetBase, targetPath) : targetBase,
        body.query
      );
      const headers = new Headers(baseHeaders);
      Object.entries(body.headers || {}).forEach(([key, value]) => headers.set(key, value));

      // Use the new signature library to sign the request
      const secret = route.hmac_secret_env ? env[route.hmac_secret_env] : env.GW_SECRET_KEY;
      if (secret) {
        const { headers: sigHeaders } = await signRequest(
          "POST",
          new URL(targetUrl).pathname,
          JSON.stringify(forwardPayload),
          secret
        );

        // Add signature headers to the request
        Object.entries(sigHeaders).forEach(([key, value]) => headers.set(key, value));
      } else {
        // If no secret is available, we still need to add the request ID header
        headers.set("x-gw-request-id", requestId);
      }

      invocationPromise = fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(forwardPayload),
        signal: controller.signal
      });
    }
    response = await invocationPromise;
    if (timedOut) {
      throw Object.assign(new Error("timeout"), { name: "AbortError" });
    }
    clearTimeout(timer);
    const limited = await readResponseWithLimit(response, maxBytes);
    if (limited.result) {
      logs.push(makeLogEntry("invoke", "Downstream responded", "info", { status: limited.result.status }));
    } else if (limited.error) {
      logs.push(makeLogEntry("invoke", "Downstream response rejected", "error", { error: limited.error.code }));
    }
    return limited;
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === "AbortError") {
      logs.push(makeLogEntry("invoke", "Downstream timed out", "error", { timeout_ms: timeoutMs }));
      return {
        error: {
          code: "timeout",
          message: `Downstream did not respond within ${timeoutMs}ms`
        }
      };
    }
    logs.push(makeLogEntry("invoke", "Downstream invocation failed", "error", { error: error?.message }));
    return {
      error: {
        code: "invoke_failed",
        message: error?.message || "Downstream invocation failed"
      }
    };
  }
}

export async function handleGatewayRoute(request, env, domain, action) {
  const cf = request?.cf || {};
  const engineRef = `${env.GATEWAY_VERSION}@${cf.colo || "unknown"}`;
  const logs = [makeLogEntry("gateway", "Gateway request received", "info", { domain, action })];
  const policyEvents = [];

  const { body, error: parseError } = await readJsonWithLimit(request, MAX_GATEWAY_REQUEST_BYTES);
  let requestId = (body?.request_id) || request.headers.get("x-request-id") || `gateway_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const buildResponse = (status, payload) => {
    const responsePayload = {
      ok: payload.ok ?? !payload.error,
      request_id: requestId,
      domain,
      action,
      route_mode: payload.route_mode || "unknown",
      engine_ref: engineRef,
      result: payload.result,
      error: payload.error,
      policy_check: payload.policy_check,
      evidence_refs: payload.evidence_refs,
      logs: logs
    };
    return new Response(JSON.stringify(responsePayload, null, 2), {
      status,
      headers: {
        "Content-Type": "application/json",
        "x-gw-request-id": requestId
      }
    });
  };

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logs.push(makeLogEntry("auth", "Missing bearer token", "error"));
    const evidenceRefs = await writeGatewayEvidence(requestId, policyEvents, logs, env);
    return buildResponse(401, {
      ok: false,
      error: { code: "unauthorized", message: "Missing or invalid Authorization header" },
      evidence_refs: evidenceRefs,
      route_mode: "unknown"
    });
  }

  const token = authHeader.substring(7);
  if (token !== env.GATEWAY_AUTH_TOKEN) {
    logs.push(makeLogEntry("auth", "Invalid auth token", "error"));
    const evidenceRefs = await writeGatewayEvidence(requestId, policyEvents, logs, env);
    return buildResponse(401, {
      ok: false,
      error: { code: "unauthorized", message: "Invalid auth token" },
      evidence_refs: evidenceRefs,
      route_mode: "unknown"
    });
  }

  if (parseError) {
    logs.push(makeLogEntry("parse", parseError.message, "error"));
    const evidenceRefs = await writeGatewayEvidence(requestId, policyEvents, logs, env);
    const statusCode = parseError.code === "request_too_large" ? 413 : 400;
    return buildResponse(statusCode, {
      ok: false,
      error: parseError,
      evidence_refs: evidenceRefs,
      route_mode: "unknown"
    });
  }

  const gatewayBody = body || {};
  requestId = gatewayBody.request_id || requestId;

  const policy = await loadGatewayPolicy(env);
  const policyDecision = checkGatewayPolicy(domain, action, policy);
  policyEvents.push({
    at: new Date().toISOString(),
    request_id: requestId,
    decision: policyDecision.decision,
    reason: policyDecision.reason,
    rule_id: policyDecision.rule_id
  });

  if (policyDecision.decision === "deny") {
    logs.push(makeLogEntry("policy", "Policy denied request", "warn", policyDecision));
    const evidenceRefs = await writeGatewayEvidence(requestId, policyEvents, logs, env);
    return buildResponse(403, {
      ok: false,
      error: { code: "policy_denied", message: policyDecision.reason, details: { rule_id: policyDecision.rule_id } },
      policy_check: policyDecision,
      evidence_refs: evidenceRefs,
      route_mode: "unknown"
    });
  }

  const routes = await loadGatewayRoutes(env);
  const route = resolveGatewayRoute(domain, action, routes);
  if (!route) {
    logs.push(makeLogEntry("route", "Route not found", "error", { domain, action }));
    const evidenceRefs = await writeGatewayEvidence(requestId, policyEvents, logs, env);
    return buildResponse(404, {
      ok: false,
      error: { code: "route_not_found", message: `No route for ${domain}/${action}` },
      policy_check: policyDecision,
      evidence_refs: evidenceRefs,
      route_mode: "unknown"
    });
  }

  logs.push(makeLogEntry("route", "Route resolved", "info", { mode: route.mode, service_binding: route.service_binding }));
  const invocation = await invokeGatewayRoute(route, requestId, domain, action, gatewayBody, env, logs);
  const evidenceRefs = await writeGatewayEvidence(requestId, policyEvents, logs, env);

  if (invocation.error) {
    let status = 502;
    if (invocation.error.code === "timeout") status = 504;
    else if (invocation.error.code === "binding_missing") status = 502;
    else if (invocation.error.code === "response_too_large") status = 502;
    return buildResponse(status, {
      ok: false,
      error: invocation.error,
      policy_check: policyDecision,
      evidence_refs: evidenceRefs,
      route_mode: route.mode
    });
  }

  return buildResponse(invocation.result?.status || 200, {
    ok: true,
    result: invocation.result,
    policy_check: policyDecision,
    evidence_refs: evidenceRefs,
    route_mode: route.mode
  });
}
