const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../auth/middleware');
const { encryptPassword, decryptPassword } = require('../crypto/credentials');
const { logAudit } = require('../audit/audit');

const router = express.Router();

router.use(requireAuth);

// GET /api/v1/connections
router.get('/', (req, res) => {
    const db = getDb();
    let connections;

    if (req.user.role === 'admin') {
        connections = db.prepare(`
            SELECT c.id, c.name, c.host, c.port, c.protocol, c.owner_id, c.shared_with, c.created_at, c.updated_at,
                   u.username as owner_name
            FROM connections c
            LEFT JOIN users u ON c.owner_id = u.id
            ORDER BY c.name
        `).all();
    } else {
        // Operators and viewers: only connections assigned to them
        connections = db.prepare(`
            SELECT id, name, host, port, protocol, owner_id, shared_with, created_at, updated_at
            FROM connections
            ORDER BY name
        `).all().filter(c => {
            const shared = JSON.parse(c.shared_with || '[]');
            return shared.includes(req.user.id);
        });
    }

    // Never include password data in listings
    res.json(connections.map(c => ({
        id: c.id,
        name: c.name,
        host: c.host,
        port: c.port,
        protocol: c.protocol,
        ownerId: c.owner_id,
        ownerName: c.owner_name || undefined,
        sharedWith: JSON.parse(c.shared_with || '[]'),
        hasPassword: !!(c.encrypted_password),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
    })));
});

// POST /api/v1/connections
router.post('/', (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can create connections' });
    }

    const { name, host, port, protocol, password } = req.body;
    if (!name || !host || !port) {
        return res.status(400).json({ error: 'name, host, and port required' });
    }

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'Invalid port number' });
    }

    // Validate host format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/.test(host) || host.length > 255) {
        return res.status(400).json({ error: 'Invalid host format' });
    }

    if (name.length > 100) {
        return res.status(400).json({ error: 'Name too long' });
    }

    const { ciphertext, iv, tag } = encryptPassword(password || null);

    const db = getDb();
    const result = db.prepare(`
        INSERT INTO connections (name, host, port, protocol, encrypted_password, password_iv, password_tag, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, host, portNum, protocol || 'vnc', ciphertext, iv, tag, req.user.id);

    logAudit(req.user.id, 'connection_create', name, req.ip, { host, port: portNum });

    res.status(201).json({
        id: result.lastInsertRowid,
        name,
        host,
        port: portNum,
        protocol: protocol || 'vnc',
    });
});

// GET /api/v1/connections/:id
router.get('/:id', (req, res) => {
    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    if (!canAccess(req.user, conn)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
        id: conn.id,
        name: conn.name,
        host: conn.host,
        port: conn.port,
        protocol: conn.protocol,
        ownerId: conn.owner_id,
        sharedWith: JSON.parse(conn.shared_with || '[]'),
        hasPassword: !!conn.encrypted_password,
        createdAt: conn.created_at,
        updatedAt: conn.updated_at,
    });
});

// PUT /api/v1/connections/:id
router.put('/:id', (req, res) => {
    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    if (!canModify(req.user, conn)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const { name, host, port, protocol, password } = req.body;

    if (host && (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/.test(host) || host.length > 255)) {
        return res.status(400).json({ error: 'Invalid host format' });
    }
    if (name && name.length > 100) {
        return res.status(400).json({ error: 'Name too long' });
    }

    let passwordFields = {};
    if (password !== undefined) {
        const { ciphertext, iv, tag } = encryptPassword(password || null);
        passwordFields = { encrypted_password: ciphertext, password_iv: iv, password_tag: tag };
    }

    db.prepare(`
        UPDATE connections SET
            name = COALESCE(?, name),
            host = COALESCE(?, host),
            port = COALESCE(?, port),
            protocol = COALESCE(?, protocol),
            encrypted_password = COALESCE(?, encrypted_password),
            password_iv = COALESCE(?, password_iv),
            password_tag = COALESCE(?, password_tag),
            updated_at = datetime('now')
        WHERE id = ?
    `).run(
        name || null,
        host || null,
        port ? parseInt(port, 10) : null,
        protocol || null,
        passwordFields.encrypted_password !== undefined ? passwordFields.encrypted_password : null,
        passwordFields.password_iv !== undefined ? passwordFields.password_iv : null,
        passwordFields.password_tag !== undefined ? passwordFields.password_tag : null,
        req.params.id
    );

    logAudit(req.user.id, 'connection_update', conn.name, req.ip, null);

    res.json({ ok: true });
});

// DELETE /api/v1/connections/:id
router.delete('/:id', (req, res) => {
    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    if (!canModify(req.user, conn)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    db.prepare('DELETE FROM connections WHERE id = ?').run(req.params.id);
    logAudit(req.user.id, 'connection_delete', conn.name, req.ip, null);

    res.json({ ok: true });
});

// POST /api/v1/connections/:id/share
router.post('/:id/share', (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can share connections' });
    }

    const { userIds } = req.body;
    if (!Array.isArray(userIds)) {
        return res.status(400).json({ error: 'userIds must be an array' });
    }

    const db = getDb();
    const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    db.prepare("UPDATE connections SET shared_with = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(userIds), req.params.id);

    logAudit(req.user.id, 'connection_share', conn.name, req.ip, { userIds });

    res.json({ ok: true });
});

// Internal: get decrypted password for proxy use
function getConnectionPassword(connectionId) {
    const db = getDb();
    const conn = db.prepare('SELECT encrypted_password, password_iv, password_tag FROM connections WHERE id = ?').get(connectionId);
    if (!conn || !conn.encrypted_password) return null;
    return decryptPassword(conn.encrypted_password, conn.password_iv, conn.password_tag);
}

function canAccess(user, conn) {
    if (user.role === 'admin') return true;
    if (conn.owner_id === user.id) return true;
    const shared = JSON.parse(conn.shared_with || '[]');
    return shared.includes(user.id);
}

function canModify(user, conn) {
    return user.role === 'admin';
}

module.exports = router;
module.exports.getConnectionPassword = getConnectionPassword;
