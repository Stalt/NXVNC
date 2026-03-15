const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// When compiled with pkg, __dirname is inside the virtual snapshot.
// Use the real exe directory for disk-based file access.
const appRoot = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

const defaultConfig = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'config', 'default.json'), 'utf8')
);

let userConfig = {};
const userConfigPath = path.join(appRoot, 'config.json');
if (fs.existsSync(userConfigPath)) {
    userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
}

const config = { ...defaultConfig, ...userConfig };

// Environment variable overrides
const envMap = {
    PORT: 'port',
    NXVNC_DB_PATH: 'dbPath',
    NXVNC_JWT_SECRET: 'jwtSecret',
    NXVNC_JWT_EXPIRY: 'jwtExpiry',
    NXVNC_MASTER_KEY: 'masterKey',
    NXVNC_TLS_CERT: 'tlsCert',
    NXVNC_TLS_KEY: 'tlsKey',
    NXVNC_LOG_LEVEL: 'logLevel',
    NXVNC_SERVICE_LOG: 'serviceLogPath',
};

for (const [env, key] of Object.entries(envMap)) {
    if (process.env[env]) {
        config[key] = process.env[env];
    }
}

// Numeric coercion
config.port = parseInt(config.port, 10) || 6080;
config.rateLimitWindow = parseInt(config.rateLimitWindow, 10) || 900000;
config.rateLimitMax = parseInt(config.rateLimitMax, 10) || 10;
config.apiRateLimitMax = parseInt(config.apiRateLimitMax, 10) || 100;
config.apiRateLimitWindow = parseInt(config.apiRateLimitWindow, 10) || 60000;

// Auto-generate secrets if missing (runtime only, not persisted to disk)
if (!config.jwtSecret) {
    config.jwtSecret = crypto.randomBytes(48).toString('hex');
    console.warn('[config] WARNING: No JWT secret configured. Using random secret (sessions will not persist across restarts).');
    console.warn('[config] Set NXVNC_JWT_SECRET environment variable for persistence.');
}

if (!config.masterKey) {
    config.masterKey = crypto.randomBytes(32).toString('hex');
    console.warn('[config] WARNING: No master key configured. Using random key (encrypted passwords will be unrecoverable after restart).');
    console.warn('[config] Set NXVNC_MASTER_KEY environment variable for persistence.');
}

// Resolve paths relative to project root
if (!path.isAbsolute(config.dbPath)) {
    config.dbPath = path.join(appRoot, config.dbPath);
}

if (!path.isAbsolute(config.serviceLogPath)) {
    config.serviceLogPath = path.join(appRoot, config.serviceLogPath);
}

// Export appRoot for other modules that need disk-based paths
config.appRoot = appRoot;

module.exports = config;
