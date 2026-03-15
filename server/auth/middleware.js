const { verifyToken, updateSessionActivity } = require('./auth');

function requireAuth(req, res, next) {
    let token = null;

    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }

    // Fall back to cookie
    if (!token && req.cookies && req.cookies.webvnc_token) {
        token = req.cookies.webvnc_token;
    }

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const result = verifyToken(token);
        if (!result) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        req.user = result.user;
        req.tokenJti = result.jti;
        updateSessionActivity(result.jti);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

function csrfProtect(req, res, next) {
    // Skip for GET/HEAD/OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const cookieToken = req.cookies && req.cookies.webvnc_csrf;
    const headerToken = req.headers['x-webvnc-csrf'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'CSRF validation failed' });
    }

    next();
}

module.exports = { requireAuth, requireRole, csrfProtect };
