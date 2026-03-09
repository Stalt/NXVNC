const express = require('express');
const { requireAuth, requireRole } = require('../auth/middleware');
const { getLicense, storeLicense, isExpired, isInGracePeriod } = require('../license/license');
const { logAudit } = require('../audit/audit');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('admin'));

// GET /api/v1/license
router.get('/', (req, res) => {
    const license = getLicense();
    if (!license) {
        return res.json({ installed: false });
    }
    res.json({
        installed: true,
        ...license,
        expired: isExpired(license),
        gracePeriod: isInGracePeriod(license),
    });
});

// POST /api/v1/license
router.post('/', (req, res) => {
    const { licenseData } = req.body;
    if (!licenseData) {
        return res.status(400).json({ error: 'License data required' });
    }

    try {
        const result = storeLicense(licenseData);
        logAudit(req.user.id, 'license_update', null, req.ip, {
            licensee: result.payload.licensee,
            valid: result.valid,
        });

        if (!result.valid) {
            return res.status(400).json({ error: 'License signature verification failed' });
        }

        res.json({ ok: true, license: result.payload });
    } catch (err) {
        return res.status(400).json({ error: 'Invalid license file: ' + err.message });
    }
});

module.exports = router;
