const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { getClientForAccount } = require('./accounts');

const router = express.Router();
router.use(requireAuth);

// GET /api/sitemaps?accountId=X&siteUrl=Y
router.get('/', async (req, res) => {
  const { accountId, siteUrl } = req.query;
  if (!accountId || !siteUrl) return res.status(400).json({ error: 'accountId and siteUrl are required' });

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const client = await getClientForAccount(account);
    const sc = google.searchconsole({ version: 'v1', auth: client });
    const { data } = await sc.sitemaps.list({ siteUrl });
    res.json(data.sitemap || []);
  } catch (err) {
    console.error('sitemaps list error:', err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/sitemaps/submit
router.post('/submit', async (req, res) => {
  const { accountId, siteUrl, feedpath } = req.body;
  if (!accountId || !siteUrl || !feedpath) {
    return res.status(400).json({ error: 'accountId, siteUrl and feedpath are required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const client = await getClientForAccount(account);
    const sc = google.searchconsole({ version: 'v1', auth: client });
    await sc.sitemaps.submit({ siteUrl, feedpath });
    res.json({ success: true });
  } catch (err) {
    console.error('sitemaps submit error:', err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/sitemaps?accountId=X&siteUrl=Y&feedpath=Z
router.delete('/', async (req, res) => {
  const { accountId, siteUrl, feedpath } = req.query;
  if (!accountId || !siteUrl || !feedpath) {
    return res.status(400).json({ error: 'accountId, siteUrl and feedpath are required' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const client = await getClientForAccount(account);
    const sc = google.searchconsole({ version: 'v1', auth: client });
    await sc.sitemaps.delete({ siteUrl, feedpath });
    res.json({ success: true });
  } catch (err) {
    console.error('sitemaps delete error:', err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
