const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { getDb } = require('../db/database');

const BCRYPT_ROUNDS = 13;

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
    db.prepare('INSERT INTO sessions (id, user_id, expires_at, last_activity) VALUES (?, ?, ?, datetime(\'now\'))')
        .run(jti, user.id, expiresAt);

    // Limit concurrent sessions per user (keep most recent 5)
    const MAX_SESSIONS = 5;
    const oldSessions = db.prepare(`
        SELECT id FROM sessions
        WHERE user_id = ? AND revoked = 0
        ORDER BY expires_at DESC
        LIMIT -1 OFFSET ?
    `).all(user.id, MAX_SESSIONS);

    if (oldSessions.length > 0) {
        const ids = oldSessions.map(s => s.id);
        db.prepare(`UPDATE sessions SET revoked = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    }

    return token;
}

function verifyToken(token) {
    const decoded = jwt.verify(token, config.jwtSecret);
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND revoked = 0').get(decoded.jti);
    if (!session) return null;

    // Check for idle session (30 minutes of inactivity)
    if (isSessionIdle(session)) {
        revokeSession(decoded.jti);
        return null;
    }

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

function generateWsToken(user) {
    return jwt.sign(
        { sub: user.id, role: user.role, username: user.username, purpose: 'ws' },
        config.jwtSecret,
        { expiresIn: '60s' }
    );
}

function verifyWsToken(token) {
    const decoded = jwt.verify(token, config.jwtSecret);
    // Accept both regular session tokens and short-lived WS tokens
    if (decoded.purpose === 'ws') {
        const db = getDb();
        const user = db.prepare('SELECT id, username, role, display_name, enabled FROM users WHERE id = ? AND enabled = 1').get(decoded.sub);
        if (!user) return null;
        return { ...decoded, user };
    }
    // Fall back to regular session-based verification
    return verifyToken(token);
}

function updateSessionActivity(jti) {
    const db = getDb();
    db.prepare("UPDATE sessions SET last_activity = datetime('now') WHERE id = ? AND revoked = 0").run(jti);
}

function isSessionIdle(session, maxIdleMs = 30 * 60 * 1000) {
    if (!session.last_activity) return false;
    const lastActivity = new Date(session.last_activity + 'Z').getTime();
    return (Date.now() - lastActivity) > maxIdleMs;
}

function cleanExpiredSessions() {
    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now') OR revoked = 1").run();
}

async function checkPasswordReuse(userId, newPassword, historyCount = 5) {
    const db = getDb();
    const history = db.prepare(
        'SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, historyCount);

    // Also check current password
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (user) {
        const sameAsCurrent = await bcrypt.compare(newPassword, user.password_hash);
        if (sameAsCurrent) return true;
    }

    for (const entry of history) {
        const match = await bcrypt.compare(newPassword, entry.password_hash);
        if (match) return true;
    }
    return false;
}

function savePasswordHistory(userId, passwordHash) {
    const db = getDb();
    db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)').run(userId, passwordHash);
    // Keep only last 5
    db.prepare(`
        DELETE FROM password_history WHERE user_id = ? AND id NOT IN (
            SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
        )
    `).run(userId, userId);
}

module.exports = {
    hashPassword,
    verifyPassword,
    generateToken,
    generateWsToken,
    verifyToken,
    verifyWsToken,
    revokeSession,
    revokeAllUserSessions,
    updateSessionActivity,
    isSessionIdle,
    cleanExpiredSessions,
    checkPasswordReuse,
    savePasswordHistory,
};
