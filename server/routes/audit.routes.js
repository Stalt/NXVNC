const express = require('express');
const { requireAuth, requireRole } = require('../auth/middleware');
const { getAuditLog } = require('../audit/audit');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('admin'));

// GET /api/v1/audit
router.get('/', (req, res) => {
    const { page, limit, action, userId, from, to } = req.query;
    const result = getAuditLog({
        page: parseInt(page) || 1,
        limit: Math.min(parseInt(limit) || 50, 200),
        action: action || undefined,
        userId: userId ? parseInt(userId) : undefined,
        from: from || undefined,
        to: to || undefined,
    });
    res.json(result);
});

module.exports = router;
