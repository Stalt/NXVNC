const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { verifyPassword, hashPassword, generateToken, generateWsToken, revokeSession } = require('../auth/auth');
const { requireAuth, csrfProtect } = require('../auth/middleware');
const { checkPasswordReuse, savePasswordHistory } = require('../auth/auth');
const { logAudit } = require('../audit/audit');

const router = express.Router();

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
        logAudit(null, 'login_failed', username, req.ip, { reason: 'user_not_found' });
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.enabled) {
        logAudit(user.id, 'login_failed', username, req.ip, { reason: 'account_disabled' });
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
        logAudit(user.id, 'login_failed', username, req.ip, { reason: 'wrong_password' });
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    // Set CSRF cookie
    const csrfToken = crypto.randomBytes(24).toString('hex');

    res.cookie('webvnc_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: true,
        maxAge: 8 * 60 * 60 * 1000,
    });

    res.cookie('webvnc_csrf', csrfToken, {
        httpOnly: false,
        sameSite: 'strict',
        secure: true,
        maxAge: 8 * 60 * 60 * 1000,
    });

    logAudit(user.id, 'login', username, req.ip, null);

    res.json({
        token,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            displayName: user.display_name,
            mustChangePassword: !!user.must_change_password,
        },
    });
});

// POST /api/v1/auth/logout
router.post('/logout', requireAuth, csrfProtect, (req, res) => {
    revokeSession(req.tokenJti);
    logAudit(req.user.id, 'logout', req.user.username, req.ip, null);
    res.clearCookie('webvnc_token');
    res.clearCookie('webvnc_ws_token');
    res.clearCookie('webvnc_csrf');
    res.json({ ok: true });
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        displayName: req.user.display_name,
        mustChangePassword: !!req.user.must_change_password,
    });
});

// POST /api/v1/auth/change-password
router.post('/change-password', requireAuth, csrfProtect, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const reused = await checkPasswordReuse(req.user.id, newPassword);
    if (reused) {
        return res.status(400).json({ error: 'Cannot reuse a recent password' });
    }

    const hash = await hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?")
        .run(hash, req.user.id);

    savePasswordHistory(req.user.id, hash);
    logAudit(req.user.id, 'password_change', req.user.username, req.ip, null);

    res.json({ ok: true });
});

// GET /api/v1/auth/ws-token — short-lived token for WebSocket auth
router.get('/ws-token', requireAuth, (req, res) => {
    const wsToken = generateWsToken(req.user);
    res.json({ token: wsToken });
});

module.exports = router;
