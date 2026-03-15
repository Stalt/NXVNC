#!/usr/bin/env node
// Vendor tool: generates a signed license file
// NOT shipped with the installer
//
// Usage:
//   node tools/generate-license.js \
//     --licensee "Acme Corp" \
//     --edition Enterprise \
//     --maxUsers 25 \
//     --maxConnections 100 \
//     --expires 2027-01-01 \
//     --output license.key

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf('--' + name);
    return idx >= 0 ? args[idx + 1] : null;
}

const licensee = getArg('licensee') || 'Unlicensed';
const edition = getArg('edition') || 'Standard';
const maxConcurrentUsers = parseInt(getArg('maxUsers')) || 5;
const maxConnections = parseInt(getArg('maxConnections')) || 10;
const expiresStr = getArg('expires') || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const outputFile = getArg('output') || 'license.key';

const privateKeyPath = path.join(__dirname, '..', 'keys', 'private.pem');
if (!fs.existsSync(privateKeyPath)) {
    console.error('Error: keys/private.pem not found. Run `node tools/generate-keypair.js` first.');
    process.exit(1);
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

const payload = {
    licensee,
    edition,
    maxConcurrentUsers,
    maxConnections,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(expiresStr + 'T23:59:59Z').toISOString(),
    licenseId: crypto.randomUUID(),
};

const payloadB64 = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64');

const signer = crypto.createSign('RSA-SHA256');
signer.update(payloadB64);
const signatureB64 = signer.sign(privateKey, 'base64');

const licenseFile = `-----BEGIN WEBVNC LICENSE-----
${payloadB64.match(/.{1,64}/g).join('\n')}
-----END WEBVNC LICENSE-----
-----BEGIN WEBVNC SIGNATURE-----
${signatureB64.match(/.{1,64}/g).join('\n')}
-----END WEBVNC SIGNATURE-----
`;

fs.writeFileSync(outputFile, licenseFile);
console.log(`License generated: ${outputFile}`);
console.log(`  Licensee:    ${licensee}`);
console.log(`  Edition:     ${edition}`);
console.log(`  Max Users:   ${maxConcurrentUsers}`);
console.log(`  Max Conns:   ${maxConnections}`);
console.log(`  Expires:     ${payload.expiresAt}`);
console.log(`  License ID:  ${payload.licenseId}`);
