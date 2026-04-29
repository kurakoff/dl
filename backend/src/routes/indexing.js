const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { getClientForAccount } = require('./accounts');

const router = express.Router();
router.use(requireAuth);

// POST /api/indexing/publish
router.post('/publish', async (req, res) => {
  const { accountId, url, type } = req.body;

  if (!accountId || !url) {
    return res.status(400).json({ error: 'accountId and url are required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  if (!account.has_indexing_scope) {
    return res.status(403).json({ error: 'scope_missing' });
  }

  try {
    const client = await getClientForAccount(account);
    const indexing = google.indexing({ version: 'v3', auth: client });

    await indexing.urlNotifications.publish({
      requestBody: {
        url,
        type: type || 'URL_UPDATED',
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Indexing API error:', err.message);
    res.status(500).json({ error: 'indexing_failed', details: err.message });
  }
});

// POST /api/indexing/publish-batch
router.post('/publish-batch', async (req, res) => {
  const { accountId, urls, type } = req.body;

  if (!accountId || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'accountId and urls[] are required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  if (!account.has_indexing_scope) {
    return res.status(403).json({ error: 'scope_missing' });
  }

  try {
    const client = await getClientForAccount(account);
    const indexing = google.indexing({ version: 'v3', auth: client });
    const notificationType = type || 'URL_UPDATED';

    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (const url of urls) {
      try {
        await indexing.urlNotifications.publish({
          requestBody: { url, type: notificationType },
        });
        succeeded++;
      } catch (err) {
        failed++;
        const detail = err.response?.data?.error?.message || err.message;
        errors.push({ url, error: detail });
        if (failed === 1) console.error('Indexing API error for', url, ':', detail);
      }
    }

    res.json({ success: true, total: urls.length, succeeded, failed, errors });
  } catch (err) {
    console.error('Batch indexing error:', err.message);
    res.status(500).json({ error: 'indexing_failed', details: err.message });
  }
});

// POST /api/indexing/inspect
router.post('/inspect', async (req, res) => {
  const { accountId, siteUrl, inspectionUrl } = req.body;

  if (!accountId || !siteUrl || !inspectionUrl) {
    return res.status(400).json({ error: 'accountId, siteUrl, and inspectionUrl are required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const client = await getClientForAccount(account);
    const sc = google.searchconsole({ version: 'v1', auth: client });

    const { data } = await sc.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl,
        siteUrl,
      },
    });

    const result = data.inspectionResult || {};
    const index = result.indexStatusResult || {};

    res.json({
      verdict: index.verdict,
      coverageState: index.coverageState,
      robotsTxtState: index.robotsTxtState,
      indexingState: index.indexingState,
      lastCrawlTime: index.lastCrawlTime,
      pageFetchState: index.pageFetchState,
      crawledAs: index.crawledAs,
      referringUrls: index.referringUrls,
      sitemap: index.sitemap,
      userCanonical: index.userCanonical,
      googleCanonical: index.googleCanonical,
    });
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error('URL Inspection error:', detail);
    res.status(500).json({ error: detail });
  }
});

// GET /api/indexing/canonicals?accountId=...&siteUrl=...
router.get('/canonicals', (req, res) => {
  const { accountId, siteUrl } = req.query;
  if (!accountId || !siteUrl) {
    return res.status(400).json({ error: 'accountId and siteUrl are required' });
  }

  const db = getDb();
  // Verify account belongs to user
  const account = db.prepare(
    'SELECT id FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const rows = db.prepare(
    'SELECT page_url, user_canonical, google_canonical, checked_at FROM canonicals_cache WHERE connected_account_id = ? AND site_url = ?'
  ).all(accountId, siteUrl);

  const data = {};
  let checkedAt = null;
  for (const row of rows) {
    data[row.page_url] = { userCanonical: row.user_canonical, googleCanonical: row.google_canonical };
    if (!checkedAt || row.checked_at > checkedAt) checkedAt = row.checked_at;
  }

  res.json({ canonicals: data, checkedAt });
});

// POST /api/indexing/canonicals — save single canonical result
router.post('/canonicals', (req, res) => {
  const { accountId, siteUrl, pageUrl, userCanonical, googleCanonical } = req.body;
  if (!accountId || !siteUrl || !pageUrl) {
    return res.status(400).json({ error: 'accountId, siteUrl, and pageUrl are required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT id FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.prepare(`
    INSERT INTO canonicals_cache (connected_account_id, site_url, page_url, user_canonical, google_canonical, checked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(connected_account_id, site_url, page_url)
    DO UPDATE SET user_canonical = excluded.user_canonical, google_canonical = excluded.google_canonical, checked_at = datetime('now')
  `).run(accountId, siteUrl, pageUrl, userCanonical || null, googleCanonical || null);

  res.json({ success: true });
});

module.exports = router;
