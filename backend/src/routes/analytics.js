const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { getClientForAccount } = require('./accounts');

const router = express.Router();
router.use(requireAuth);

// GET /api/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&hourly=true
// Returns search analytics for all selected sites across all connected accounts
router.get('/', async (req, res) => {
  const end   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const start = req.query.startDate || new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const hourly = req.query.hourly === 'true';

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
        const requestBody = {
            startDate: start,
            endDate:   end,
            dimensions: hourly ? ['hour'] : ['date'],
            rowLimit:   hourly ? 2500 : 500,
          };
        if (hourly) requestBody.dataState = 'hourly_all';

        const { data } = await sc.searchanalytics.query({
          siteUrl,
          requestBody,
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
  res.json({ results, startDate: start, endDate: end, hourly });
});

// POST /api/analytics/query-filter
// Body: { keyword, startDate, endDate, sites: [{accountId, siteUrl}] }
// Checks only the provided sites for keyword via GSC dimensionFilterGroups
router.post('/query-filter', async (req, res) => {
  const { keyword, startDate, endDate, sites } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });
  if (!sites?.length) return res.json({ matches: [] });

  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const start = startDate || new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);

  const db = getDb();

  // Group sites by accountId
  const byAccount = new Map();
  for (const s of sites) {
    const key = String(s.accountId);
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(s.siteUrl);
  }

  // Process each account
  const matches = [];
  const BATCH = 10;

  for (const [accountId, siteUrls] of byAccount) {
    const account = db.prepare(
      'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
    ).get(accountId, req.userId);
    if (!account) continue;

    let client;
    try { client = await getClientForAccount(account); } catch { continue; }
    const sc = google.searchconsole({ version: 'v1', auth: client });

    // Process in batches of BATCH
    for (let i = 0; i < siteUrls.length; i += BATCH) {
      const batch = siteUrls.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (siteUrl) => {
        try {
          const { data } = await sc.searchanalytics.query({
            siteUrl,
            requestBody: {
              startDate: start,
              endDate:   end,
              dimensions: ['query'],
              dimensionFilterGroups: [{
                filters: [{
                  dimension: 'query',
                  operator:  'contains',
                  expression: keyword,
                }],
              }],
              rowLimit: 1,
            },
          });
          return data.rows?.length > 0 ? { accountId: Number(accountId), siteUrl } : null;
        } catch {
          return null;
        }
      }));
      matches.push(...results.filter(Boolean));
    }
  }

  res.json({ matches });
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
