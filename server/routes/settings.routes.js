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

// PUT /api/v1/settings/:key
router.put('/:key', (req, res) => {
    const { value } = req.body;
    if (value === undefined) {
        return res.status(400).json({ error: 'value required' });
    }

    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(req.params.key, String(value));

    logAudit(req.user.id, 'settings_change', req.params.key, req.ip, { value });

    res.json({ ok: true });
});

module.exports = router;
