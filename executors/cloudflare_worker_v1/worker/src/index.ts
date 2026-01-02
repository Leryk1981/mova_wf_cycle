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
    // Check if signature verification is required
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

    // Original stub implementation
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

