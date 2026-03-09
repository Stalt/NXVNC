const crypto = require('crypto');
const config = require('../config');

function deriveKey() {
    return crypto.hkdfSync(
        'sha256',
        Buffer.from(config.masterKey, 'hex'),
        Buffer.from('nxvnc-credential-salt'),
        Buffer.from('nxvnc-credential-encryption'),
        32
    );
}

function encryptPassword(plaintext) {
    if (!plaintext) return { ciphertext: null, iv: null, tag: null };
    const key = deriveKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        ciphertext: encrypted,
        iv: iv,
        tag: tag,
    };
}

function decryptPassword(ciphertext, iv, tag) {
    if (!ciphertext || !iv || !tag) return null;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
}

module.exports = { encryptPassword, decryptPassword };
