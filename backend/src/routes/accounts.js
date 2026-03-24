const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── OAuth client helper ──────────────────────────────────────────────────────

async function getClientForAccount(account) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.BACKEND_URL + '/auth/callback'
  );

  client.setCredentials({
    access_token:  account.access_token,
    refresh_token: account.refresh_token,
    expiry_date:   account.token_expiry,
  });

  // Refresh proactively if token expires in < 60 s
  if (account.refresh_token && account.token_expiry && Date.now() > account.token_expiry - 60_000) {
    const { credentials } = await client.refreshAccessToken();
    getDb().prepare(
      'UPDATE connected_accounts SET access_token = ?, token_expiry = ? WHERE id = ?'
    ).run(credentials.access_token, credentials.expiry_date, account.id);
    client.setCredentials(credentials);
  }

  return client;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/accounts
router.get('/', (req, res) => {
  const db = getDb();

  const accounts = db.prepare(`
    SELECT id, google_id, email, name, picture, created_at
    FROM connected_accounts
    WHERE user_id = ?
    ORDER BY created_at ASC
  `).all(req.userId);

  const result = accounts.map(acc => ({
    ...acc,
    selected_sites: db.prepare(
      'SELECT site_url FROM selected_sites WHERE connected_account_id = ?'
    ).all(acc.id).map(r => r.site_url),
  }));

  res.json(result);
});

// DELETE /api/accounts/:id  — disconnect account (cascade deletes selected sites)
router.delete('/:id', (req, res) => {
  const db = getDb();

  const account = db.prepare(
    'SELECT id FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.prepare('DELETE FROM dashboard_sites WHERE connected_account_id = ?').run(req.params.id);
  db.prepare('DELETE FROM connected_accounts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/accounts/:id/sites  — list all sites from Search Console + which are selected
router.get('/:id/sites', async (req, res) => {
  const db = getDb();

  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const client = await getClientForAccount(account);
    const sc = google.searchconsole({ version: 'v1', auth: client });
    const { data } = await sc.sites.list();

    const sites = (data.siteEntry || []).map(s => ({
      url:             s.siteUrl,
      permissionLevel: s.permissionLevel,
    }));

    const selectedSites = db.prepare(
      'SELECT site_url FROM selected_sites WHERE connected_account_id = ?'
    ).all(account.id).map(r => r.site_url);

    res.json({ sites, selectedSites });
  } catch (err) {
    console.error('Error fetching sites:', err.message);
    res.status(500).json({ error: 'Failed to fetch sites', details: err.message });
  }
});

// POST /api/accounts/:id/sites/toggle  — select or deselect a site
router.post('/:id/sites/toggle', (req, res) => {
  const { siteUrl } = req.body;
  if (!siteUrl) return res.status(400).json({ error: 'siteUrl is required' });

  const db = getDb();

  const account = db.prepare(
    'SELECT id FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  const existing = db.prepare(
    'SELECT id FROM selected_sites WHERE connected_account_id = ? AND site_url = ?'
  ).get(account.id, siteUrl);

  if (existing) {
    db.prepare('DELETE FROM selected_sites WHERE id = ?').run(existing.id);
    res.json({ selected: false });
  } else {
    db.prepare(
      'INSERT INTO selected_sites (connected_account_id, site_url) VALUES (?, ?)'
    ).run(account.id, siteUrl);
    res.json({ selected: true });
  }
});

// POST /api/accounts/:id/sites/batch-select  — add or remove multiple sites at once
router.post('/:id/sites/batch-select', (req, res) => {
  const { siteUrls, selected } = req.body;
  if (!Array.isArray(siteUrls)) return res.status(400).json({ error: 'siteUrls must be an array' });

  const db = getDb();
  const account = db.prepare(
    'SELECT id FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.userId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  if (selected) {
    const ins = db.prepare('INSERT OR IGNORE INTO selected_sites (connected_account_id, site_url) VALUES (?, ?)');
    for (const url of siteUrls) ins.run(account.id, url);
  } else {
    const del = db.prepare('DELETE FROM selected_sites WHERE connected_account_id = ? AND site_url = ?');
    for (const url of siteUrls) del.run(account.id, url);
  }

  const newSelected = db.prepare(
    'SELECT site_url FROM selected_sites WHERE connected_account_id = ?'
  ).all(account.id).map(r => r.site_url);

  res.json({ selectedSites: newSelected });
});

module.exports = { router, getClientForAccount };
