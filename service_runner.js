/**
 * WebVNC Service Runner
 * Entry point for the Windows Service (wrapped by NSSM).
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */
const path = require('path');

// When compiled with pkg, __dirname points to the virtual snapshot filesystem.
// Use the real executable's directory instead.
const appDir = process.pkg ? path.dirname(process.execPath) : __dirname;
process.chdir(appDir);

console.log('='.repeat(60));
console.log('videowares WebVNC Service starting');
console.log(`  cwd=${process.cwd()}`);
console.log(`  node=${process.version}`);
console.log(`  pid=${process.pid}`);
console.log(`  time=${new Date().toISOString()}`);
console.log('='.repeat(60));

// Load the server
require('./server/index.js');

// Graceful shutdown
function shutdown(signal) {
    console.log(`[service] ${signal} received, shutting down...`);
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGBREAK', () => shutdown('SIGBREAK'));  // Windows
