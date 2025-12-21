#!/usr/bin/env node
/**
 * Quick test to verify environment variables are accessible
 */
console.log('Environment variables check:');
console.log('GATEWAY_URL:', process.env.GATEWAY_URL ? `SET (${process.env.GATEWAY_URL.substring(0, 30)}...)` : 'NOT SET');
console.log('GATEWAY_AUTH_TOKEN:', process.env.GATEWAY_AUTH_TOKEN ? `SET (length: ${process.env.GATEWAY_AUTH_TOKEN.length})` : 'NOT SET');
console.log('ADMIN_AUTH_TOKEN:', process.env.ADMIN_AUTH_TOKEN ? `SET (length: ${process.env.ADMIN_AUTH_TOKEN.length})` : 'NOT SET');

