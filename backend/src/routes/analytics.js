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

  // Fetch all accounts in parallel
  const accountResults = await Promise.all(accounts.map(async (account) => {
    let client;
    try {
      client = await getClientForAccount(account);
    } catch (err) {
      console.error(`Token refresh failed for account ${account.email}:`, err.message);
      return [];
    }

    const sc = google.searchconsole({ version: 'v1', auth: client });

    let allSites;
    try {
      const { data } = await sc.sites.list();
      allSites = (data.siteEntry || []).map(s => s.siteUrl);
    } catch (err) {
      console.error(`Failed to list sites for ${account.email}:`, err.message);
      return [];
    }

    if (!allSites.length) return [];

    // Fetch analytics for all sites of this account in parallel
    return Promise.all(allSites.map(async (siteUrl) => {
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

        return {
          accountId:    account.id,
          accountEmail: account.email,
          siteUrl,
          data: (data.rows || []).map(row => ({
            date:        row.keys[0],
            clicks:      row.clicks,
            impressions: row.impressions,
            ctr:         Math.round(row.ctr * 10000) / 100,
            position:    Math.round(row.position * 10) / 10,
          })),
        };
      } catch (err) {
        console.error(`Analytics error for ${siteUrl}:`, err.message);
        return {
          accountId:    account.id,
          accountEmail: account.email,
          siteUrl,
          error: err.message,
          data: [],
        };
      }
    }));
  }));

  const results = accountResults.flat();
  res.json({ results, startDate: start, endDate: end });
});

// GET /api/analytics/site-detail?accountId=&siteUrl=&startDate=&endDate=&dimension=
// dimension: query | page | country | device
router.get('/site-detail', async (req, res) => {
  const { accountId, siteUrl, startDate, endDate, dimension } = req.query;
  if (!accountId || !siteUrl || !dimension) return res.status(400).json({ error: 'Missing params' });

  const db      = getDb();
  const account = db.prepare(
    'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.userId);

  if (!account) return res.status(403).json({ error: 'Account not found' });

  let client;
  try {
    client = await getClientForAccount(account);
  } catch (err) {
    return res.status(401).json({ error: 'Token refresh failed' });
  }

  const sc = google.searchconsole({ version: 'v1', auth: client });

  const LIMITS = { query: 25, page: 25, country: 30, device: 10 };

  try {
    const { data } = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate:  startDate || new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10),
        endDate:    endDate   || new Date().toISOString().slice(0, 10),
        dimensions: [dimension],
        rowLimit:   LIMITS[dimension] || 25,
        orderBy:    [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
      },
    });

    const rows = (data.rows || []).map(row => ({
      key:         row.keys[0],
      clicks:      row.clicks,
      impressions: row.impressions,
      ctr:         Math.round(row.ctr * 10000) / 100,
      position:    Math.round(row.position * 10) / 10,
    }));

    res.json({ rows });
  } catch (err) {
    console.error(`site-detail error [${dimension}] ${siteUrl}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
