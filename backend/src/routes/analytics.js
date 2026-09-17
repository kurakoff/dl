const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { getClientForAccount } = require('./accounts');
const { querySearchAnalytics, withRetry, isRetryable } = require('../services/gscQuery');

const router = express.Router();
router.use(requireAuth);

function parseRange(q) {
  return {
    end:   q.endDate   || new Date().toISOString().slice(0, 10),
    start: q.startDate || new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10),
  };
}

function parseCountries(v) {
  if (Array.isArray(v)) return v.map(c => String(c).trim().toLowerCase()).filter(Boolean);
  return v ? String(v).split(',').map(c => c.trim().toLowerCase()).filter(Boolean) : [];
}

// Date (or hour) series for one site — same request the site detail chart makes,
// plus the dashboard's optional country / query filters.
async function fetchSiteSeries(sc, account, siteUrl, { start, end, hourly, countries, queryFilter }) {
  const requestBody = {
    startDate: start,
    endDate:   end,
    dimensions: hourly ? ['hour'] : ['date'],
    rowLimit:   hourly ? 2500 : 500,
  };
  if (hourly) requestBody.dataState = 'hourly_all';
  const filters = [];
  if (countries.length === 1) {
    filters.push({ dimension: 'country', operator: 'equals', expression: countries[0] });
  } else if (countries.length > 1) {
    filters.push({ dimension: 'country', operator: 'includingRegex', expression: countries.join('|') });
  }
  if (queryFilter) {
    filters.push({ dimension: 'query', operator: 'contains', expression: queryFilter });
  }
  if (filters.length) {
    requestBody.dimensionFilterGroups = [{ filters }];
  }

  const base = { accountId: account.id, accountEmail: account.email, siteUrl };
  try {
    const data = await querySearchAnalytics(sc, account.id, siteUrl, requestBody);
    return {
      ...base,
      data: (data.rows || []).map(row => ({
        date:        row.keys[0],
        clicks:      row.clicks,
        impressions: row.impressions,
        ctr:         Math.round(row.ctr * 10000) / 100,
        position:    Math.round(row.position * 10) / 10,
      })),
    };
  } catch (err) {
    // Never report a failed request as "no data" — the client retries these
    console.error(`Analytics error for ${siteUrl}:`, err.message);
    return { ...base, error: err.message, retryable: isRetryable(err), data: [] };
  }
}

// GET /api/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&hourly=true
// Returns search analytics for all sites across all connected accounts in one
// response. The dashboard uses /sites + /batch instead (progressive loading).
router.get('/', async (req, res) => {
  const { start, end } = parseRange(req.query);
  const opts = {
    start, end,
    hourly:      req.query.hourly === 'true',
    countries:   parseCountries(req.query.countries),
    queryFilter: req.query.query ? req.query.query.trim() : '',
  };

  const db       = getDb();
  const accounts = db.prepare(
    'SELECT * FROM connected_accounts WHERE user_id = ?'
  ).all(req.userId);

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
      const { data } = await withRetry(() => sc.sites.list());
      allSites = (data.siteEntry || []).map(s => s.siteUrl);
    } catch (err) {
      console.error(`Failed to list sites for ${account.email}:`, err.message);
      return [];
    }

    return Promise.all(allSites.map(siteUrl => fetchSiteSeries(sc, account, siteUrl, opts)));
  }));

  res.json({ results: accountResults.flat(), startDate: start, endDate: end, hourly: opts.hourly });
});

// GET /api/analytics/sites
// Site list only (no analytics) for all connected accounts — fast, so the
// dashboard can render cards immediately and then fill them via /batch.
router.get('/sites', async (req, res) => {
  const db       = getDb();
  const accounts = db.prepare(
    'SELECT * FROM connected_accounts WHERE user_id = ?'
  ).all(req.userId);

  const errors = [];
  const perAccount = await Promise.all(accounts.map(async (account) => {
    try {
      const client = await getClientForAccount(account);
      const sc = google.searchconsole({ version: 'v1', auth: client });
      const { data } = await withRetry(() => sc.sites.list());
      return (data.siteEntry || []).map(s => ({
        accountId:    account.id,
        accountEmail: account.email,
        siteUrl:      s.siteUrl,
      }));
    } catch (err) {
      console.error(`Failed to list sites for ${account.email}:`, err.message);
      errors.push({ accountId: account.id, accountEmail: account.email, error: err.message });
      return [];
    }
  }));

  res.json({ sites: perAccount.flat(), errors });
});

// POST /api/analytics/batch
// Body: { startDate, endDate, hourly, countries: [..], query, sites: [{accountId, siteUrl}] }
// Series for the given sites. Failed sites come back with `error` set.
router.post('/batch', async (req, res) => {
  const { sites } = req.body;
  if (!Array.isArray(sites) || !sites.length) return res.json({ results: [] });
  if (sites.length > 200) return res.status(400).json({ error: 'Too many sites (max 200)' });

  const { start, end } = parseRange(req.body);
  const opts = {
    start, end,
    hourly:      req.body.hourly === true || req.body.hourly === 'true',
    countries:   parseCountries(req.body.countries),
    queryFilter: req.body.query ? String(req.body.query).trim() : '',
  };

  const byAccount = new Map();
  for (const s of sites) {
    const key = String(s.accountId);
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(s.siteUrl);
  }

  const db = getDb();
  const accountResults = await Promise.all([...byAccount].map(async ([accountId, siteUrls]) => {
    const account = db.prepare(
      'SELECT * FROM connected_accounts WHERE id = ? AND user_id = ?'
    ).get(accountId, req.userId);
    const fail = (error, email, retryable = false) => siteUrls.map(siteUrl => ({
      accountId: Number(accountId), accountEmail: email, siteUrl, error, retryable, data: [],
    }));
    if (!account) return fail('Account not found');

    let client;
    try {
      client = await getClientForAccount(account);
    } catch (err) {
      console.error(`Token refresh failed for account ${account.email}:`, err.message);
      return fail(`Token refresh failed: ${err.message}`, account.email, isRetryable(err));
    }
    const sc = google.searchconsole({ version: 'v1', auth: client });
    return Promise.all(siteUrls.map(siteUrl => fetchSiteSeries(sc, account, siteUrl, opts)));
  }));

  res.json({ results: accountResults.flat() });
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

// GET /api/analytics/site-detail?accountId=&siteUrl=&startDate=&endDate=&dimension=&filters=JSON
// dimension: query | page | country | device
// filters: JSON object e.g. {"country":"deu","device":"MOBILE"}
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
    const requestBody = {
      startDate:  startDate || new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10),
      endDate:    endDate   || new Date().toISOString().slice(0, 10),
      dimensions: [dimension],
      rowLimit:   LIMITS[dimension] || 25,
      orderBy:    [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
    };

    // Parse multi-dimension filters
    let filters = {};
    try { if (req.query.filters) filters = JSON.parse(req.query.filters); } catch {}
    const filterEntries = Object.entries(filters);
    if (filterEntries.length > 0) {
      requestBody.dimensionFilterGroups = [{
        filters: filterEntries.map(([dim, val]) => ({ dimension: dim, operator: 'equals', expression: val })),
      }];
    }

    const { data } = await sc.searchanalytics.query({ siteUrl, requestBody });

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

// GET /api/analytics/site-chart?accountId=&siteUrl=&startDate=&endDate=&filters=JSON
// Returns date-series chart data for a single site, optionally filtered by dimensions
router.get('/site-chart', async (req, res) => {
  const { accountId, siteUrl, startDate, endDate } = req.query;
  const hourly = req.query.hourly === 'true';
  if (!accountId || !siteUrl) return res.status(400).json({ error: 'Missing params' });

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

  try {
    const requestBody = {
      startDate:  startDate || new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10),
      endDate:    endDate   || new Date().toISOString().slice(0, 10),
      dimensions: hourly ? ['hour'] : ['date'],
      rowLimit:   hourly ? 2500 : 500,
    };
    if (hourly) requestBody.dataState = 'hourly_all';

    // Parse multi-dimension filters
    let filters = {};
    try { if (req.query.filters) filters = JSON.parse(req.query.filters); } catch {}
    const filterEntries = Object.entries(filters);
    if (filterEntries.length > 0) {
      requestBody.dimensionFilterGroups = [{
        filters: filterEntries.map(([dim, val]) => ({ dimension: dim, operator: 'equals', expression: val })),
      }];
    }

    const { data } = await sc.searchanalytics.query({ siteUrl, requestBody });

    const rows = (data.rows || []).map(row => ({
      date:        row.keys[0],
      clicks:      row.clicks,
      impressions: row.impressions,
      ctr:         Math.round(row.ctr * 10000) / 100,
      position:    Math.round(row.position * 10) / 10,
    }));

    res.json({ data: rows });
  } catch (err) {
    console.error(`site-chart error ${siteUrl}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
