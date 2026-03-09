const { getLicense, isExpired, isInGracePeriod, isValid } = require('./license');

function requireLicense(req, res, next) {
    const license = getLicense();

    // If no license installed, allow access (unlicensed mode)
    if (!license) return next();

    if (!license.signatureValid) {
        return res.status(403).json({ error: 'Invalid license signature' });
    }

    if (isExpired(license) && !isInGracePeriod(license)) {
        return res.status(403).json({ error: 'License has expired. Please renew your license.' });
    }

    if (isInGracePeriod(license)) {
        const daysLeft = Math.ceil((new Date(license.expiresAt).getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000));
        res.set('X-NXVNC-License-Warning', `License expired. Grace period: ${daysLeft} day(s) remaining.`);
    }

    next();
}

module.exports = { requireLicense };
