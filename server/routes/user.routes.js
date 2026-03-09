const express = require('express');
const { getDb } = require('../db/database');
const { hashPassword, revokeAllUserSessions, savePasswordHistory } = require('../auth/auth');
const { requireAuth, requireRole } = require('../auth/middleware');
const { logAudit } = require('../audit/audit');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('admin'));

// GET /api/v1/users
router.get('/', (req, res) => {
    const db = getDb();
    const users = db.prepare('SELECT id, username, role, display_name, enabled, must_change_password, created_at, updated_at FROM users ORDER BY id').all();
    res.json(users);
});

// POST /api/v1/users
router.post('/', async (req, res) => {
    const { username, password, role, displayName } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'username, password, and role required' });
    }
    if (!['admin', 'operator', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, dots, and hyphens' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
        return res.status(409).json({ error: 'Username already exists' });
    }

    const hash = await hashPassword(password);
    const result = db.prepare(`
        INSERT INTO users (username, password_hash, role, display_name)
        VALUES (?, ?, ?, ?)
    `).run(username, hash, role, displayName || username);

    logAudit(req.user.id, 'user_create', username, req.ip, { role });

    res.status(201).json({
        id: result.lastInsertRowid,
        username,
        role,
        displayName: displayName || username,
    });
});

// GET /api/v1/users/:id
router.get('/:id', (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT id, username, role, display_name, enabled, must_change_password, created_at, updated_at FROM users WHERE id = ?')
        .get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// PUT /api/v1/users/:id
router.put('/:id', (req, res) => {
    const { role, displayName, enabled } = req.body;
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent disabling the last admin
    if (enabled === false || (role && role !== 'admin')) {
        const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND enabled = 1").get().count;
        if (user.role === 'admin' && adminCount <= 1) {
            return res.status(400).json({ error: 'Cannot remove the last admin user' });
        }
    }

    if (role && !['admin', 'operator', 'viewer'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }

    db.prepare(`
        UPDATE users SET
            role = COALESCE(?, role),
            display_name = COALESCE(?, display_name),
            enabled = COALESCE(?, enabled),
            updated_at = datetime('now')
        WHERE id = ?
    `).run(
        role || null,
        displayName !== undefined ? displayName : null,
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        req.params.id
    );

    if (enabled === false) {
        revokeAllUserSessions(parseInt(req.params.id));
    }

    logAudit(req.user.id, 'user_update', user.username, req.ip, { role, enabled });

    res.json({ ok: true });
});

// DELETE /api/v1/users/:id
router.delete('/:id', (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.id === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND enabled = 1").get().count;
    if (user.role === 'admin' && adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }

    revokeAllUserSessions(user.id);
    db.prepare("UPDATE users SET enabled = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);

    logAudit(req.user.id, 'user_delete', user.username, req.ip, null);

    res.json({ ok: true });
});

// POST /api/v1/users/:id/reset-password
router.post('/:id/reset-password', async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hash = await hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?")
        .run(hash, req.params.id);

    savePasswordHistory(parseInt(req.params.id), hash);
    revokeAllUserSessions(user.id);
    logAudit(req.user.id, 'password_reset', user.username, req.ip, null);

    res.json({ ok: true });
});

module.exports = router;
