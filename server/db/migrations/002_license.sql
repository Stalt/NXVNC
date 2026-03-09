CREATE TABLE license (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    license_data TEXT,
    validated_at TEXT,
    licensee TEXT,
    edition TEXT,
    max_users INTEGER,
    max_connections INTEGER,
    expires_at TEXT,
    signature_valid INTEGER DEFAULT 0
);
