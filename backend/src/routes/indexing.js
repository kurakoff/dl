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

module.exports = router;
