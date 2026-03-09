const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { getDb, close } = require('./db/database');
const { runMigrations } = require('./db/migrations/migrate');
const { WebSocketProxy } = require('./proxy');
const { requireAuth } = require('./auth/middleware');
const { ensureTLS, getCertInfo } = require('./tls/selfsigned');
const { requireLicense } = require('./license/middleware');
const { getLicense, isExpired, isInGracePeriod, isValid } = require('./license/license');
const { cleanExpiredSessions } = require('./auth/auth');

// Route modules
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const connectionRoutes = require('./routes/connection.routes');
const auditRoutes = require('./routes/audit.routes');
const licenseRoutes = require('./routes/license.routes');
const settingsRoutes = require('./routes/settings.routes');

const app = express();

// --- Database & Migrations ---
runMigrations();

// --- Security Middleware ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'", "wss:", "ws:"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
        }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Rate limiting on login
const loginLimiter = rateLimit({
    windowMs: config.rateLimitWindow,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again later.' },
});
app.use('/api/v1/auth/login', loginLimiter);

// General API rate limiting
const apiLimiter = rateLimit({
    windowMs: config.apiRateLimitWindow,
    max: config.apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', apiLimiter);

// --- Public Routes ---
// Serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'login.html'));
});
app.get('/login.html', (req, res) => {
    res.redirect('/login');
});

// Auth routes (login is public, others require auth)
app.use('/api/v1/auth', authRoutes);

// --- Authenticated Routes ---
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/connections', requireLicense, connectionRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/license', licenseRoutes);
app.use('/api/v1/settings', settingsRoutes);

// License status endpoint (for client to check free mode / cooldown)
app.get('/api/v1/license/status', requireAuth, (req, res) => {
    const { isFreeMode, FREE_SESSION_LIMIT_MS, FREE_COOLDOWN_MS } = require('./license/license');
    const free = isFreeMode();
    let cooldownRemaining = 0;
    if (free && proxy) {
        const cooldownUntil = proxy.cooldowns && proxy.cooldowns.get(req.user.id);
        if (cooldownUntil && Date.now() < cooldownUntil) {
            cooldownRemaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
        }
    }
    res.json({
        freeMode: free,
        sessionLimitMs: free ? FREE_SESSION_LIMIT_MS : 0,
        cooldownMs: free ? FREE_COOLDOWN_MS : 0,
        cooldownRemaining,
    });
});

// Serve noVNC library files (ESM source)
app.use('/novnc', express.static(path.join(__dirname, '..', 'node_modules', '@novnc', 'novnc')));

// Serve static client files — protected by auth check for index.html
app.use('/css', express.static(path.join(__dirname, '..', 'client', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'client', 'js')));

// Protected main page
app.get('/', (req, res) => {
    // Check for auth cookie — if missing, redirect to login
    const token = req.cookies && req.cookies.nxvnc_token;
    if (!token) {
        return res.redirect('/login');
    }
    // Token validity is checked client-side via /api/v1/auth/me
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// --- Server Creation (always HTTPS) ---
const tls = ensureTLS(config);
const tlsOptions = {
    cert: fs.readFileSync(tls.certPath),
    key: fs.readFileSync(tls.keyPath),
};
const server = https.createServer(tlsOptions, app);

const certInfo = getCertInfo(tls.certPath);
if (tls.selfSigned) {
    console.log('[server] TLS enabled (self-signed certificate)');
    console.log('[server] Browsers will show a security warning — this is expected for self-signed certs');
    console.log('[server] To use your own certificate, set tlsCert and tlsKey in config.json');
} else {
    console.log('[server] TLS enabled (user-provided certificate)');
}
if (certInfo) {
    console.log(`[server] Certificate expires: ${new Date(certInfo.validTo).toLocaleDateString()}`);
}

// --- WebSocket Proxy ---
const proxy = new WebSocketProxy(server);

// --- Periodic Cleanup ---
setInterval(() => {
    try {
        cleanExpiredSessions();
    } catch (e) {
        console.error('[cleanup] Session cleanup error:', e.message);
    }
}, 60 * 60 * 1000); // Every hour

// --- License Check ---
const license = getLicense();
if (license) {
    if (isValid(license)) {
        console.log(`[license] Licensed to: ${license.licensee} (${license.edition})`);
        if (isInGracePeriod(license)) {
            console.log('[license] WARNING: License has expired, running in grace period');
        }
    } else if (isExpired(license)) {
        console.log('[license] WARNING: License has expired');
    } else {
        console.log('[license] WARNING: License signature is invalid');
    }
} else {
    console.log('[license] No license installed — running in unlicensed mode');
}

// --- Start ---
server.listen(config.port, () => {
    console.log(`NXVNC server running on ${config.tlsCert ? 'https' : 'http'}://localhost:${config.port}`);
    console.log('WebSocket proxy ready for VNC connections');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[server] Shutting down...');
    server.close();
    close();
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('[server] Shutting down...');
    server.close();
    close();
    process.exit(0);
});
