const express = require('express');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/notes/list — returns all accountId:siteUrl pairs that have non-empty notes
router.get('/list', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    "SELECT account_id, site_url FROM site_notes WHERE user_id = ? AND content != ''"
  ).all(req.userId);
  res.json(rows.map(r => ({ accountId: r.account_id, siteUrl: r.site_url })));
});

// GET /api/notes/:accountId/:siteUrl
router.get('/:accountId/:siteUrl', (req, res) => {
  const db = getDb();
  const accountId = Number(req.params.accountId);
  const siteUrl = decodeURIComponent(req.params.siteUrl);

  // Verify account belongs to user
  const account = db.prepare(
    'SELECT id FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);
  if (!account) return res.status(403).json({ error: 'Account not found' });

  const note = db.prepare(
    'SELECT content, updated_at FROM site_notes WHERE user_id = ? AND account_id = ? AND site_url = ?'
  ).get(req.userId, accountId, siteUrl);

  res.json({ content: note?.content || '', updatedAt: note?.updated_at || null });
});

// PUT /api/notes/:accountId/:siteUrl
router.put('/:accountId/:siteUrl', (req, res) => {
  const db = getDb();
  const accountId = Number(req.params.accountId);
  const siteUrl = decodeURIComponent(req.params.siteUrl);
  const { content } = req.body;

  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });

  // Verify account belongs to user
  const account = db.prepare(
    'SELECT id FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);
  if (!account) return res.status(403).json({ error: 'Account not found' });

  db.prepare(`
    INSERT INTO site_notes (user_id, account_id, site_url, content, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, account_id, site_url)
    DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `).run(req.userId, accountId, siteUrl, content);

  res.json({ ok: true });
});

module.exports = router;
