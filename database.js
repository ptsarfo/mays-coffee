const Database = require('better-sqlite3');
const path     = require('path');

// DATA_DIR is set on Railway to point at a persistent volume; falls back to local
const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, 'mays_coffee.db'));

// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    subscribed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    phone      TEXT DEFAULT '',
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    guests     INTEGER NOT NULL,
    notes      TEXT DEFAULT '',
    status     TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id            TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    email         TEXT NOT NULL,
    total         TEXT NOT NULL,
    status        TEXT DEFAULT 'received',
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    price    REAL NOT NULL,
    qty      INTEGER NOT NULL
  );
`);

module.exports = db;
