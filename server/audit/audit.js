const { getDb } = require('../db/database');

function logAudit(userId, action, target, ipAddress, details) {
    const db = getDb();
    db.prepare(`
        INSERT INTO audit_log (user_id, action, target, ip_address, details)
        VALUES (?, ?, ?, ?, ?)
    `).run(
        userId || null,
        action,
        target || null,
        ipAddress || null,
        details ? JSON.stringify(details) : null
    );
}

function getAuditLog({ page = 1, limit = 50, action, userId, from, to } = {}) {
    const db = getDb();
    const conditions = [];
    const params = [];

    if (action) {
        conditions.push('a.action = ?');
        params.push(action);
    }
    if (userId) {
        conditions.push('a.user_id = ?');
        params.push(userId);
    }
    if (from) {
        conditions.push('a.created_at >= ?');
        params.push(from);
    }
    if (to) {
        conditions.push('a.created_at <= ?');
        params.push(to);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;

    const total = db.prepare(`SELECT COUNT(*) as count FROM audit_log a ${where}`).get(...params).count;

    const rows = db.prepare(`
        SELECT a.*, u.username
        FROM audit_log a
        LEFT JOIN users u ON a.user_id = u.id
        ${where}
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return { rows, total, page, limit, pages: Math.ceil(total / limit) };
}

module.exports = { logAudit, getAuditLog };
