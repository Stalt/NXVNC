CREATE TABLE IF NOT EXISTS password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
