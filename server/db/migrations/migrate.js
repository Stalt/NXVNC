const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { getDb } = require('../database');

function runMigrations() {
    const db = getDb();

    // Create migrations tracking table
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
        )
    `);

    const applied = new Set(
        db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
    );

    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        if (applied.has(file)) continue;

        console.log(`[migrate] Running ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

        db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
        })();

        console.log(`[migrate] Applied ${file}`);
    }

    // Create default admin user if no users exist
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0) {
        const hash = bcrypt.hashSync('admin', 12);
        db.prepare(`
            INSERT INTO users (username, password_hash, role, display_name, must_change_password)
            VALUES (?, ?, 'admin', 'Administrator', 1)
        `).run('admin', hash);
        console.log('[migrate] Created default admin user (admin/admin) — password change required on first login');
    }
}

module.exports = { runMigrations };
