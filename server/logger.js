const { getDb } = require('./db/database');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel = LEVELS.info;

// Try to load log level from database settings
try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'logLevel'").get();
    if (row && LEVELS[row.value] !== undefined) {
        currentLevel = LEVELS[row.value];
    }
} catch (e) {
    // Database not ready or settings table doesn't exist yet — use default
}

function setLevel(levelName) {
    if (LEVELS[levelName] !== undefined) {
        currentLevel = LEVELS[levelName];
    }
}

function formatMessage(level, tag, args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${tag}]`;
    return [prefix, ...args];
}

const logger = {
    debug(tag, ...args) {
        if (currentLevel <= LEVELS.debug) {
            console.debug(...formatMessage('debug', tag, args));
        }
    },
    info(tag, ...args) {
        if (currentLevel <= LEVELS.info) {
            console.info(...formatMessage('info', tag, args));
        }
    },
    warn(tag, ...args) {
        if (currentLevel <= LEVELS.warn) {
            console.warn(...formatMessage('warn', tag, args));
        }
    },
    error(tag, ...args) {
        if (currentLevel <= LEVELS.error) {
            console.error(...formatMessage('error', tag, args));
        }
    },
};

module.exports = { logger, setLevel };
