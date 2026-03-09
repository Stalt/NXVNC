const crypto = require('crypto');
const { getDb } = require('../db/database');
const PUBLIC_KEY = require('./publicKey');

function parseLicenseFile(content) {
    const payloadMatch = content.match(
        /-----BEGIN NXVNC LICENSE-----\s*([\s\S]*?)\s*-----END NXVNC LICENSE-----/
    );
    const sigMatch = content.match(
        /-----BEGIN NXVNC SIGNATURE-----\s*([\s\S]*?)\s*-----END NXVNC SIGNATURE-----/
    );

    if (!payloadMatch || !sigMatch) {
        throw new Error('Invalid license file format');
    }

    const payloadB64 = payloadMatch[1].replace(/\s/g, '');
    const signatureB64 = sigMatch[1].replace(/\s/g, '');

    const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(payloadStr);

    return { payload, payloadB64, signatureB64 };
}

function validateSignature(payloadB64, signatureB64) {
    try {
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(payloadB64);
        return verifier.verify(PUBLIC_KEY, signatureB64, 'base64');
    } catch {
        return false;
    }
}

function validateLicense(content) {
    const { payload, payloadB64, signatureB64 } = parseLicenseFile(content);
    const signatureValid = validateSignature(payloadB64, signatureB64);

    return {
        valid: signatureValid,
        payload,
        signatureValid,
    };
}

function storeLicense(content) {
    const { valid, payload, signatureValid } = validateLicense(content);

    const db = getDb();
    db.prepare(`
        INSERT OR REPLACE INTO license (id, license_data, validated_at, licensee, edition, max_users, max_connections, expires_at, signature_valid)
        VALUES (1, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
    `).run(
        content,
        payload.licensee || null,
        payload.edition || null,
        payload.maxConcurrentUsers || null,
        payload.maxConnections || null,
        payload.expiresAt || null,
        signatureValid ? 1 : 0
    );

    return { valid, payload };
}

function getLicense() {
    const db = getDb();
    const row = db.prepare('SELECT * FROM license WHERE id = 1').get();
    if (!row) return null;

    return {
        licensee: row.licensee,
        edition: row.edition,
        maxUsers: row.max_users,
        maxConnections: row.max_connections,
        expiresAt: row.expires_at,
        signatureValid: !!row.signature_valid,
        validatedAt: row.validated_at,
    };
}

function isExpired(license) {
    if (!license || !license.expiresAt) return true;
    return new Date(license.expiresAt) < new Date();
}

function isInGracePeriod(license) {
    if (!license || !license.expiresAt) return false;
    const expiry = new Date(license.expiresAt);
    const graceEnd = new Date(expiry.getTime() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();
    return now > expiry && now <= graceEnd;
}

function isValid(license) {
    if (!license) return false;
    if (!license.signatureValid) return false;
    if (isExpired(license) && !isInGracePeriod(license)) return false;
    return true;
}

function isFreeMode() {
    const license = getLicense();
    if (!license) return true;
    if (!license.signatureValid) return true;
    if (isExpired(license) && !isInGracePeriod(license)) return true;
    return false;
}

// Free mode constants
const FREE_SESSION_LIMIT_MS = 5 * 60 * 1000;   // 5 minutes
const FREE_COOLDOWN_MS = 5 * 60 * 1000;         // 5 minutes

function checkLimits(activeUsers, activeConnections) {
    const license = getLicense();
    if (!license) return { allowed: true };

    const errors = [];
    if (license.maxUsers && activeUsers >= license.maxUsers) {
        errors.push(`Maximum concurrent users (${license.maxUsers}) reached`);
    }
    if (license.maxConnections && activeConnections >= license.maxConnections) {
        errors.push(`Maximum connections (${license.maxConnections}) reached`);
    }
    return { allowed: errors.length === 0, errors };
}

module.exports = {
    parseLicenseFile,
    validateLicense,
    storeLicense,
    getLicense,
    isExpired,
    isInGracePeriod,
    isValid,
    isFreeMode,
    FREE_SESSION_LIMIT_MS,
    FREE_COOLDOWN_MS,
    checkLimits,
};
