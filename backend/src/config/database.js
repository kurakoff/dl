const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/app.db');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id   TEXT UNIQUE,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT,
      picture     TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS connected_accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      google_id     TEXT NOT NULL,
      email         TEXT NOT NULL,
      name          TEXT,
      picture       TEXT,
      access_token  TEXT,
      refresh_token TEXT,
      token_expiry  INTEGER,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, google_id)
    );

    CREATE TABLE IF NOT EXISTS selected_sites (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      connected_account_id  INTEGER NOT NULL,
      site_url              TEXT NOT NULL,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connected_account_id) REFERENCES connected_accounts(id) ON DELETE CASCADE,
      UNIQUE(connected_account_id, site_url)
    );

    CREATE TABLE IF NOT EXISTS dashboards (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      name       TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dashboard_sites (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      dashboard_id         INTEGER NOT NULL,
      connected_account_id INTEGER NOT NULL,
      site_url             TEXT NOT NULL,
      FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
      UNIQUE(dashboard_id, connected_account_id, site_url)
    );

    CREATE TABLE IF NOT EXISTS email_otps (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL,
      code       TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invite_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL UNIQUE,
      token      TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migration: make google_id nullable and email unique in users table
  try {
    const cols = database.prepare('PRAGMA table_info(users)').all();
    const googleIdCol = cols.find(c => c.name === 'google_id');
    if (googleIdCol && googleIdCol.notnull === 1) {
      database.pragma('foreign_keys = OFF');
      database.exec(`
        CREATE TABLE users_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          google_id   TEXT UNIQUE,
          email       TEXT UNIQUE NOT NULL,
          name        TEXT,
          picture     TEXT,
          created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO users_new SELECT id, google_id, email, name, picture, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      database.pragma('foreign_keys = ON');
      console.log('Migration: users.google_id is now nullable, email is unique');
    }
  } catch (err) {
    console.error('Migration error:', err.message);
  }

  // Migration: add password_hash column to users
  try {
    const cols = database.prepare('PRAGMA table_info(users)').all();
    if (!cols.find(c => c.name === 'password_hash')) {
      database.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
      console.log('Migration: added password_hash column to users');
    }
  } catch (err) {
    console.error('Migration (password_hash) error:', err.message);
  }

  // Migration: add has_indexing_scope column to connected_accounts
  try {
    const cols = database.prepare('PRAGMA table_info(connected_accounts)').all();
    if (!cols.find(c => c.name === 'has_indexing_scope')) {
      database.exec('ALTER TABLE connected_accounts ADD COLUMN has_indexing_scope INTEGER DEFAULT 0');
      console.log('Migration: added has_indexing_scope column to connected_accounts');
    }
  } catch (err) {
    console.error('Migration (has_indexing_scope) error:', err.message);
  }

  // Create site_notes table
  database.exec(`
    CREATE TABLE IF NOT EXISTS site_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      site_url   TEXT NOT NULL,
      content    TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, account_id, site_url)
    )
  `);

  // Create safe_browsing_cache table
  database.exec(`
    CREATE TABLE IF NOT EXISTS safe_browsing_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      site_url TEXT NOT NULL,
      status TEXT DEFAULT 'clean',
      threat_types TEXT DEFAULT '',
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, account_id, site_url)
    )
  `);

  console.log('Database initialized at', DB_PATH);
}

module.exports = { getDb, initDb };
