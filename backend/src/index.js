require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const { initDb }       = require('./config/database');
const authRoutes       = require('./routes/auth');
const { router: accountsRouter } = require('./routes/accounts');
const analyticsRoutes  = require('./routes/analytics');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Init DB ──────────────────────────────────────────────────────────────────
initDb();

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, Postman) and whitelisted origins
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',          authRoutes);
app.use('/auth/email',      require('./routes/emailAuth'));
app.use('/api/accounts',   accountsRouter);
app.use('/api/analytics',  analyticsRoutes);
app.use('/api/dashboards', require('./routes/dashboards'));
app.use('/api/indexing',   require('./routes/indexing'));
app.use('/api/notes',      require('./routes/notes'));
app.use('/api/safety',     require('./routes/safety'));
app.use('/api/site-verification', require('./routes/siteVerification'));
app.use('/api/sitemaps',          require('./routes/sitemaps'));

// Temporary: serve DB file for migration (remove after Coolify migration)
app.get('/admin/db-export/migrate-2026-04', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { getDb } = require('./config/database');
  const dbPath = path.resolve(process.env.DB_PATH || path.join(__dirname, '../data/app.db'));
  getDb().pragma('wal_checkpoint(PASSIVE)');
  const data = fs.readFileSync(dbPath);
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Length', data.length);
  res.send(data);
});

// Temporary: read-only account diagnostics, guarded by DIAG_KEY env. Remove after use.
// Mounted under /api/ so the frontend nginx proxy forwards it to the backend.
app.get('/api/diag', (req, res) => {
  if (!process.env.DIAG_KEY || req.query.key !== process.env.DIAG_KEY) {
    return res.status(404).end();
  }
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const emails = (req.query.emails
      ? String(req.query.emails).split(',')
      : ['linkbuilding.learn@gmail.com', 'saloncascabel@gmail.com', 'unctadcompalorg@gmail.com']
    ).map(e => e.trim().toLowerCase()).filter(Boolean);
    const ph = emails.map(() => '?').join(',');

    const users = db.prepare(
      `SELECT id, email, google_id, created_at, (password_hash IS NOT NULL) AS has_password
       FROM users WHERE lower(email) IN (${ph})`
    ).all(...emails);

    const accounts = db.prepare(
      `SELECT ca.id, ca.user_id, ca.email, ca.google_id, ca.created_at, ca.has_indexing_scope,
              u.email AS owner_email,
              (SELECT COUNT(*) FROM selected_sites s WHERE s.connected_account_id = ca.id) AS sites_count
       FROM connected_accounts ca
       LEFT JOIN users u ON u.id = ca.user_id
       WHERE lower(ca.email) IN (${ph})`
    ).all(...emails);

    const userIds = [...new Set([...users.map(u => u.id), ...accounts.map(a => a.user_id)])];
    const grouping = userIds.map(uid => ({
      user_id: uid,
      owner_email: (db.prepare('SELECT email FROM users WHERE id = ?').get(uid) || {}).email,
      invite_token: (db.prepare('SELECT token FROM invite_tokens WHERE user_id = ?').get(uid) || {}).token || null,
      connected: db.prepare(
        `SELECT email, google_id,
                (SELECT COUNT(*) FROM selected_sites s WHERE s.connected_account_id = connected_accounts.id) AS sites
         FROM connected_accounts WHERE user_id = ?`
      ).all(uid),
    }));

    res.json({ emails, users, accounts, grouping });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (_req, res) => {
  try {
    const { getDb } = require('./config/database');
    const db = getDb();
    const users = db.prepare('SELECT count(*) as c FROM users').get().c;
    const accounts = db.prepare('SELECT count(*) as c FROM connected_accounts').get().c;
    const sites = db.prepare('SELECT count(*) as c FROM selected_sites').get().c;
    res.json({ status: 'ok', ts: Date.now(), db: { users, accounts, sites } });
  } catch (e) {
    res.json({ status: 'ok', ts: Date.now(), dbError: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SEO Dashboard backend running on port ${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`Backend URL:  ${process.env.BACKEND_URL}`);
});

module.exports = app;
