const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../auth/middleware');
const { logAudit } = require('../audit/audit');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('admin'));

// GET /api/v1/settings
router.get('/', (req, res) => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    res.json(settings);
});

// GET /api/v1/settings/logging/stats
router.get('/logging/stats', async (req, res) => {
    try {
        const { getAuditStats } = require('../audit/audit');
        const stats = getAuditStats();

        const db = getDb();
        const retentionRow = db.prepare("SELECT value FROM settings WHERE key = 'auditRetentionDays'").get();
        const logLevelRow = db.prepare("SELECT value FROM settings WHERE key = 'logLevel'").get();

        res.json({
            auditRetentionDays: parseInt(retentionRow?.value) || 90,
            logLevel: logLevelRow?.value || 'info',
            auditStats: stats
        });
    } catch (e) {
        console.error('Logging stats error:', e.message);
        res.status(500).json({ error: 'Failed to retrieve logging stats' });
    }
});

// POST /api/v1/settings/logging/purge
router.post('/logging/purge', async (req, res) => {
    try {
        const { purgeOldAuditLogs } = require('../audit/audit');
        const { logAudit } = require('../audit/audit');

        const db = getDb();
        const row = db.prepare("SELECT value FROM settings WHERE key = 'auditRetentionDays'").get();
        const days = parseInt(row?.value) || 90;

        const deleted = purgeOldAuditLogs(days);
        logAudit(req.user.id, 'audit_purge', null, req.ip, { deleted, retentionDays: days });

        res.json({ deleted, retentionDays: days });
    } catch (e) {
        console.error('Audit purge error:', e.message);
        res.status(500).json({ error: 'Failed to purge audit logs' });
    }
});

// GET /api/v1/settings/logging/service-log
router.get('/logging/service-log', async (req, res) => {
    try {
        const config = require('../config');
        const fs = require('fs');
        const logPath = config.serviceLogPath;

        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Service log file not found', path: logPath });
        }

        const stat = fs.statSync(logPath);
        const MAX_SIZE = 1 * 1024 * 1024; // 1MB

        if (stat.size <= MAX_SIZE) {
            return res.download(logPath, 'service.log');
        }

        // Stream last 1MB
        const stream = fs.createReadStream(logPath, { start: stat.size - MAX_SIZE });
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename="service.log"');
        stream.pipe(res);
    } catch (e) {
        console.error('Service log download error:', e.message);
        res.status(500).json({ error: 'Failed to download service log' });
    }
});

// PUT /api/v1/settings/:key
router.put('/:key', (req, res) => {
    const { value } = req.body;
    if (value === undefined) {
        return res.status(400).json({ error: 'value required' });
    }

    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(req.params.key, String(value));

    if (req.params.key === 'logLevel') {
        try {
            const { setLevel } = require('../logger');
            setLevel(value);
        } catch(e) { /* logger not yet initialized */ }
    }

    logAudit(req.user.id, 'settings_change', req.params.key, req.ip, { value });

    res.json({ ok: true });
});

module.exports = router;
