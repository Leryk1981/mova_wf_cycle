/**
 * MOVA Cloudflare Worker v1
 *
 * Executor implementation for Cloudflare Workers runtime.
 *
 * Status: Scaffold / Stub
 */

// Import the signature verification middleware
import { createSignatureVerificationMiddleware } from './lib/gw_sig_v0';

export default {
  /**
   * Handle incoming requests
   */
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Check if this is the probe endpoint
    if (url.pathname === '/__gw_probe') {
      // For the probe endpoint, we still need to verify the signature
      // Check if signature verification is required
      const requireSignature = env.GW_REQUIRE_SIGNATURE !== 'false' && env.NODE_ENV !== 'development';

      if (requireSignature) {
        // Create the verification middleware with the secret key
        const verifySignature = createSignatureVerificationMiddleware(
          env.GW_SECRET_KEY || env.GATEWAY_SECRET || env.GATEWAY_AUTH_TOKEN || 'default-secret-key',
          60 // time window in seconds
        );

        const verificationResult = await verifySignature(request);

        if (!verificationResult.isValid) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'unauthorized',
                message: verificationResult.error || 'Invalid gateway signature',
                details: 'Direct access denied - gateway signature required'
              }
            }),
            {
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      }

      // Extract the gateway headers to include in the response
      const gwRequestId = request.headers.get('x-gw-request-id');
      const gwTs = request.headers.get('x-gw-ts');
      const gwBodySha256 = request.headers.get('x-gw-body-sha256');
      const gwSig = request.headers.get('x-gw-sig');

      // Return success response with gateway headers
      return new Response(
        JSON.stringify({
          ok: true,
          probe: 'gw_sig_ok',
          x_gw_request_id: gwRequestId,
          x_gw_ts: gwTs,
          x_gw_body_sha256: gwBodySha256,
          has_sig: !!gwSig
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // Check if signature verification is required for other endpoints
    // In production, always require signatures; in development, allow opt-out
    const requireSignature = env.GW_REQUIRE_SIGNATURE !== 'false' && env.NODE_ENV !== 'development';

    if (requireSignature) {
      // Create the verification middleware with the secret key
      const verifySignature = createSignatureVerificationMiddleware(
        env.GW_SECRET_KEY || env.GATEWAY_SECRET || env.GATEWAY_AUTH_TOKEN || 'default-secret-key',
        60 // time window in seconds
      );

      const verificationResult = await verifySignature(request);

      if (!verificationResult.isValid) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'unauthorized',
              message: verificationResult.error || 'Invalid gateway signature',
              details: 'Direct access denied - gateway signature required'
            }
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Original stub implementation for other endpoints
    return new Response(
      JSON.stringify({
        status: 'not_implemented',
        message: 'Cloudflare Worker executor is not yet implemented. This is a scaffold.',
        executor_ref: 'cloudflare_worker_v1',
        timestamp: new Date().toISOString()
      }),
      {
        status: 501, // Not Implemented
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
};

