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
  // Remove any path
  d = d.split('/')[0];
  return d;
}

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

    res.json({ token: tokenRes.data.token, domain });
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

    // Verify ownership
    await sv.webResource.insert({
      verificationMethod: 'DNS_TXT',
      requestBody: {
        site: { type: 'INET_DOMAIN', identifier: domain },
      },
    });

    // Add to Search Console as domain property
    const sc = google.searchconsole({ version: 'v1', auth: client });
    const siteUrl = 'sc-domain:' + domain;
    await sc.sites.add({ siteUrl });

    // Auto-add to selected_sites
    db.prepare(
      'INSERT OR IGNORE INTO selected_sites (connected_account_id, site_url) VALUES (?, ?)'
    ).run(account.id, siteUrl);

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
