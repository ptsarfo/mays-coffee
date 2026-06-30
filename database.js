const { Pool } = require('@neondatabase/serverless');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
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
      id       SERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      name     TEXT NOT NULL,
      price    REAL NOT NULL,
      qty      INTEGER NOT NULL
    );
  `);

  console.log('Database tables ready.');
}

module.exports = { pool, init };
