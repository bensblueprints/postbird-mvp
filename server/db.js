const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  // Under Electron the Node-ABI binding won't load; use the vendored Electron prebuild.
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

function openDb(dataDir, dbPath) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const file = dbPath || path.join(dataDir, 'postbird.db');
  const nativeBinding = nativeBindingPath();
  const db = new Database(file, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      double_opt_in INTEGER NOT NULL DEFAULT 1,
      from_name TEXT DEFAULT '',
      from_email TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      name TEXT DEFAULT '',
      fields_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', -- pending|subscribed|unsubscribed|bounced|complained
      consent_at TEXT DEFAULT NULL,
      consent_ip TEXT DEFAULT NULL,
      unsub_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(list_id, email)
    );
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      rules_json TEXT NOT NULL DEFAULT '{"op":"AND","rules":[]}'
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      blocks_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      segment_id INTEGER DEFAULT NULL,
      template_id INTEGER NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      from_name TEXT DEFAULT '',
      from_email TEXT DEFAULT '',
      reply_to TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|sending|paused|sent|canceled
      scheduled_at TEXT DEFAULT NULL,
      started_at TEXT DEFAULT NULL,
      finished_at TEXT DEFAULT NULL,
      throttle_per_min INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      subscriber_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', -- queued|sent|failed|bounced
      token TEXT NOT NULL DEFAULT '',
      error TEXT DEFAULT NULL,
      sent_at TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      subscriber_id INTEGER,
      type TEXT NOT NULL, -- open|click|unsub|bounce|complaint
      url TEXT DEFAULT NULL,
      ua TEXT DEFAULT NULL,
      ip TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_subscribers_list ON subscribers(list_id, status);
    CREATE INDEX IF NOT EXISTS idx_outbox_campaign ON outbox(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id, type);
    CREATE INDEX IF NOT EXISTS idx_events_subscriber ON events(subscriber_id);
  `);

  return db;
}

const DEFAULT_SETTINGS = {
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_pass: '',
  smtp_pool_size: '2',
  physical_address: '',
  base_url: '',
  default_from_name: '',
  default_from_email: ''
};

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out;
}

function setSettings(db, obj) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) {
      if (k in DEFAULT_SETTINGS) stmt.run(k, String(v ?? ''));
    }
  });
  tx(Object.entries(obj));
}

// HMAC secret: env SECRET, or auto-generated once into the data dir.
function loadSecret(dataDir) {
  if (process.env.SECRET) return process.env.SECRET;
  const p = path.join(dataDir, 'secret.key');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(p, s);
  return s;
}

module.exports = { openDb, getSettings, setSettings, DEFAULT_SETTINGS, loadSecret };
