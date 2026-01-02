# Domain Signature Guard Snippet

This is a reusable code snippet that can be added to domain workers to verify gateway signatures and implement a "closed kitchen" policy.

## TypeScript/JavaScript Implementation

```typescript
import { createSignatureVerificationMiddleware } from './path/to/gw_sig_v0'; // Adjust path as needed

// Create the verification middleware with your secret key
const verifySignature = createSignatureVerificationMiddleware(
  // Use environment variable for the secret key
  env.GW_SECRET_KEY || env.GATEWAY_SECRET || 'your-default-secret-key',
  // Optional: time window in seconds (default is 60)
  60
);

// Use this middleware in your request handler
async function handleRequest(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  // Check if signature verification is required
  // In production, always require signatures; in development, allow opt-out
  const requireSignature = env.GW_REQUIRE_SIGNATURE !== 'false' && env.NODE_ENV !== 'development';
  
  if (requireSignature) {
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
  
  // Continue with your normal request processing
  // ... your domain logic here
}
```

## Environment Variables

- `GW_SECRET_KEY` or `GATEWAY_SECRET`: The shared secret key used for HMAC signatures
- `GW_REQUIRE_SIGNATURE`: Set to 'false' to disable signature verification (for development only)

## Default Behavior

- **PROD**: Signature required (deny-by-default)
- **DEV**: Allow opt-out via env (e.g. `GW_REQUIRE_SIGNATURE=false`) ONLY for local debugging