const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let db = null;

function getDb() {
    if (db) return db;

    // Ensure data directory exists
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    return db;
}

function close() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, close };
