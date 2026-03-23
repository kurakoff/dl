const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { getClientForAccount } = require('./accounts');

const router = express.Router();
router.use(requireAuth);

// GET /api/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Returns search analytics for all selected sites across all connected accounts
router.get('/', async (req, res) => {
  const end   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const start = req.query.startDate || new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);

  const db       = getDb();
  const accounts = db.prepare(
    'SELECT * FROM connected_accounts WHERE user_id = ?'
  ).all(req.userId);

  const results = [];

  for (const account of accounts) {
    const selectedSites = db.prepare(
      'SELECT site_url FROM selected_sites WHERE connected_account_id = ?'
    ).all(account.id).map(r => r.site_url);

    if (!selectedSites.length) continue;

    let client;
    try {
      client = await getClientForAccount(account);
    } catch (err) {
      console.error(`Token refresh failed for account ${account.email}:`, err.message);
      continue;
    }

    const sc = google.searchconsole({ version: 'v1', auth: client });

    for (const siteUrl of selectedSites) {
      try {
        const { data } = await sc.searchanalytics.query({
          siteUrl,
          requestBody: {
            startDate: start,
            endDate:   end,
            dimensions: ['date'],
            rowLimit:   500,
          },
        });

        results.push({
          accountId:    account.id,
          accountEmail: account.email,
          siteUrl,
          data: (data.rows || []).map(row => ({
            date:        row.keys[0],
            clicks:      row.clicks,
            impressions: row.impressions,
            ctr:         Math.round(row.ctr * 10000) / 100,      // percent, 2dp
            position:    Math.round(row.position * 10) / 10,     // 1dp
          })),
        });
      } catch (err) {
        console.error(`Analytics error for ${siteUrl}:`, err.message);
        results.push({
          accountId:    account.id,
          accountEmail: account.email,
          siteUrl,
          error: err.message,
          data: [],
        });
      }
    }
  }

  res.json({ results, startDate: start, endDate: end });
});

module.exports = router;
