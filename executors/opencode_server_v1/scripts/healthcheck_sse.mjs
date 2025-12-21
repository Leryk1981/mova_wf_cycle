#!/usr/bin/env node
/**
 * OpenCode Engine Health Check via SSE
 * 
 * Connects to /event endpoint and waits for server.connected event.
 * Exit codes:
 *   0 - Healthy (server.connected received)
 *   1 - Unhealthy (timeout or connection failed)
 */

const args = process.argv.slice(2);

function getArg(name) {
  const eqArg = args.find(a => a.startsWith(`--${name}=`));
  if (eqArg) return eqArg.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx < args.length - 1) return args[idx + 1];
  return null;
}

const baseUrl = getArg('baseUrl') || process.env.MOVA_OPENCODE_BASE_URL || 'http://127.0.0.1:4096';
const timeoutMs = parseInt(getArg('timeout') || '10000', 10);

console.log(`[healthcheck] Checking OpenCode at ${baseUrl}`);
console.log(`[healthcheck] Timeout: ${timeoutMs}ms`);

async function checkHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(`${baseUrl}/event`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`[healthcheck] FAIL: SSE connection failed with status ${response.status}`);
      process.exit(1);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    // Read until server.connected or timeout
    const readTimeout = setTimeout(() => {
      console.error('[healthcheck] FAIL: Timeout waiting for server.connected event');
      reader.cancel();
      process.exit(1);
    }, timeoutMs);
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        clearTimeout(readTimeout);
        console.error('[healthcheck] FAIL: Stream ended without server.connected event');
        process.exit(1);
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.substring(6));
            if (event.type === 'server.connected') {
              clearTimeout(readTimeout);
              reader.cancel();
              console.log('[healthcheck] PASS: server.connected event received');
              console.log(`[healthcheck] Server version: ${event.version || 'unknown'}`);
              process.exit(0);
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[healthcheck] FAIL: Connection timeout');
    } else {
      console.error(`[healthcheck] FAIL: ${error.message}`);
    }
    process.exit(1);
  }
}

checkHealth();

