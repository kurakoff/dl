const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { getClientForAccount } = require('./accounts');

const router = express.Router();
router.use(requireAuth);

function cleanDomain(input) {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.replace(/\/+$/, '');
  d = d.split('/')[0];
  return d;
}

// GET /api/site-verification/pending
router.get('/pending', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT pv.id, pv.connected_account_id as accountId, pv.domain, pv.token, pv.created_at,
           ca.email as accountEmail
    FROM pending_verifications pv
    JOIN connected_accounts ca ON ca.id = pv.connected_account_id
    WHERE pv.user_id = ?
    ORDER BY pv.created_at DESC
  `).all(req.userId);
  res.json(rows);
});

// DELETE /api/site-verification/pending/:id
router.delete('/pending/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id FROM pending_verifications WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM pending_verifications WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/site-verification/get-token
router.post('/get-token', async (req, res) => {
  const { accountId, domain: rawDomain } = req.body;
  if (!accountId || !rawDomain) return res.status(400).json({ error: 'accountId and domain are required' });

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (!account.has_siteverification_scope) {
    return res.status(403).json({ error: 'Account missing siteverification scope. Please reconnect.' });
  }

  const domain = cleanDomain(rawDomain);

  try {
    const client = await getClientForAccount(account);
    const sv = google.siteVerification({ version: 'v1', auth: client });

    const tokenRes = await sv.webResource.getToken({
      requestBody: {
        site: { type: 'INET_DOMAIN', identifier: domain },
        verificationMethod: 'DNS_TXT',
      },
    });

    const token = tokenRes.data.token;

    // Save to pending_verifications
    db.prepare(`
      INSERT INTO pending_verifications (user_id, connected_account_id, domain, token)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, connected_account_id, domain) DO UPDATE SET
        token = excluded.token,
        created_at = CURRENT_TIMESTAMP
    `).run(req.userId, accountId, domain, token);

    res.json({ token, domain });
  } catch (err) {
    console.error('getToken error:', err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/site-verification/verify
router.post('/verify', async (req, res) => {
  const { accountId, domain: rawDomain } = req.body;
  if (!accountId || !rawDomain) return res.status(400).json({ error: 'accountId and domain are required' });

  const db = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  const domain = cleanDomain(rawDomain);

  try {
    const client = await getClientForAccount(account);
    const sv = google.siteVerification({ version: 'v1', auth: client });

    await sv.webResource.insert({
      verificationMethod: 'DNS_TXT',
      requestBody: {
        site: { type: 'INET_DOMAIN', identifier: domain },
      },
    });

    const sc = google.searchconsole({ version: 'v1', auth: client });
    const siteUrl = 'sc-domain:' + domain;
    await sc.sites.add({ siteUrl });

    db.prepare(
      'INSERT OR IGNORE INTO selected_sites (connected_account_id, site_url) VALUES (?, ?)'
    ).run(account.id, siteUrl);

    // Remove from pending
    db.prepare(
      'DELETE FROM pending_verifications WHERE user_id = ? AND connected_account_id = ? AND domain = ?'
    ).run(req.userId, accountId, domain);

    res.json({ success: true, siteUrl, domain });
  } catch (err) {
    console.error('verify error:', err.message, err.response?.data);
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;

    if (status === 403 || (msg && (msg.toLowerCase().includes('dns') || msg.toLowerCase().includes('verification token') || msg.toLowerCase().includes('could not be found')))) {
      return res.status(422).json({ error: 'DNS record not found yet. Please wait a few minutes for DNS propagation and try again.' });
    }
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
