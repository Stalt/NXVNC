const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { getDb } = require('../db/database');

const BCRYPT_ROUNDS = 12;

async function hashPassword(plain) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

function generateToken(user) {
    const jti = uuidv4();
    const payload = {
        sub: user.id,
        role: user.role,
        username: user.username,
        jti,
    };
    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiry });

    // Decode to get actual expiry timestamp
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000).toISOString();

    // Store session
    const db = getDb();
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
        .run(jti, user.id, expiresAt);

    return token;
}

function verifyToken(token) {
    const decoded = jwt.verify(token, config.jwtSecret);
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND revoked = 0').get(decoded.jti);
    if (!session) return null;

    const user = db.prepare('SELECT id, username, role, display_name, enabled, must_change_password FROM users WHERE id = ? AND enabled = 1').get(decoded.sub);
    if (!user) return null;

    return { ...decoded, user };
}

function revokeSession(jti) {
    const db = getDb();
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(jti);
}

function revokeAllUserSessions(userId) {
    const db = getDb();
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(userId);
}

function cleanExpiredSessions() {
    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now') OR revoked = 1").run();
}

module.exports = {
    hashPassword,
    verifyPassword,
    generateToken,
    verifyToken,
    revokeSession,
    revokeAllUserSessions,
    cleanExpiredSessions,
};
