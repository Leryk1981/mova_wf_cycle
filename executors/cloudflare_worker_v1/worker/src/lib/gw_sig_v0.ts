/**
 * Gateway signature library v0
 * Provides functions for signing (gateway side) and verifying (domain side) requests
 */

/**
 * Creates a SHA-256 hash of the input string
 */
async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signs a request using HMAC
 */
export async function signRequest(
  method: string,
  pathname: string,
  body: string,
  secretKey: string
): Promise<{
  headers: Record<string, string>;
  body: string;
}> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodySha256 = await sha256Hex(body);
  
  // Canonical string to sign
  const stringToSign = `${method}\n${pathname}\n${ts}\n${bodySha256}`;
  
  // Create HMAC signature
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

/**
 * Verifies a request signature
 */
export async function verifySignature(
  method: string,
  pathname: string,
  ts: string,
  bodySha256: string,
  signature: string,
  secretKey: string,
  timeWindowSeconds: number = 60
): Promise<boolean> {
  // Check timestamp is within allowed window (±60 seconds by default)
  const now = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(ts, 10);
  
  if (isNaN(tsNum) || Math.abs(now - tsNum) > timeWindowSeconds) {
    console.log(`Timestamp check failed: now=${now}, ts=${tsNum}, diff=${Math.abs(now - tsNum)}`);
    return false;
  }
  
  // Recreate the canonical string to verify
  const stringToVerify = `${method}\n${pathname}\n${ts}\n${bodySha256}`;
  
  // Import the key for verification
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(secretKey);
  const signingKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  
  // Import the signature for verification
  const signatureBytes = hexToBytes(signature);
  const isValid = await crypto.subtle.verify(
    'HMAC',
    signingKey,
    signatureBytes,
    encoder.encode(stringToVerify)
  );
  
  return isValid;
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Middleware function to verify incoming requests
 */
export function createSignatureVerificationMiddleware(secretKey: string, timeWindowSeconds: number = 60) {
  return async (request: Request): Promise<{ isValid: boolean; error?: string }> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const pathname = url.pathname;
    
    // Extract required headers
    const requestId = request.headers.get('x-gw-request-id');
    const ts = request.headers.get('x-gw-ts');
    const bodySha256 = request.headers.get('x-gw-body-sha256');
    const signature = request.headers.get('x-gw-sig');
    
    // Check if all required headers are present
    if (!requestId || !ts || !bodySha256 || !signature) {
      console.log('Missing required signature headers');
      return { isValid: false, error: 'Missing required signature headers' };
    }
    
    // Get the request body for verification
    const body = await request.text();
    const actualBodySha256 = await sha256Hex(body);
    
    // Verify body hash matches
    if (actualBodySha256 !== bodySha256) {
      console.log('Body hash mismatch');
      return { isValid: false, error: 'Body hash mismatch' };
    }
    
    // Verify the signature
    const isValid = await verifySignature(
      method,
      pathname,
      ts,
      bodySha256,
      signature,
      secretKey,
      timeWindowSeconds
    );
    
    if (!isValid) {
      console.log('Signature verification failed');
      return { isValid: false, error: 'Invalid signature' };
    }
    
    return { isValid: true };
  };
}