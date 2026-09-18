// Machine API for zavod.guru (domain manager): impressions and clicks per domain.
//
// zavod shows search traffic next to every domain of its projects. It knows
// domains, not Google accounts, so this endpoint finds the Search Console
// property for each domain across ALL connected accounts of ALL dashboard users
// and returns the same numbers the dashboard shows for "Last 24 hours".
//
// Protected by a shared service token (env INTEGRATION_TOKEN) instead of a user
// JWT: the lookup is intentionally not scoped to one user. Without the token set
// every call answers 503, so the endpoint is inert until configured.

const crypto  = require('crypto');
const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { getClientForAccount } = require('./accounts');
const { querySearchAnalytics, withRetry, isRetryable } = require('../services/gscQuery');

const router = express.Router();

const MAX_DOMAINS = 500;
const INDEX_TTL   = 30 * 60_000;   // property lists change rarely

function requireServiceToken(req, res, next) {
  const expected = process.env.INTEGRATION_TOKEN || '';
  if (!expected) return res.status(503).json({ error: 'Integration is not configured (INTEGRATION_TOKEN)' });
  const header = req.headers.authorization || '';
  const given  = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid service token' });
  }
  next();
}
router.use(requireServiceToken);

// ── domain helpers ──────────────────────────────────────────────────────────
function normalizeDomain(value) {
  let s = String(value || '').trim().toLowerCase();
  s = s.replace(/^sc-domain:/, '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  if (s.startsWith('www.')) s = s.slice(4);
  return s.replace(/\.+$/, '');
}

// Domain property covers every protocol and subdomain, so it wins; then the
// bare https host, then www, then plain http.
function propertyRank(siteUrl) {
  const u = siteUrl.toLowerCase();
  if (u.startsWith('sc-domain:')) return 0;
  if (u.startsWith('https://www.')) return 2;
  if (u.startsWith('https://')) return 1;
  if (u.startsWith('http://www.')) return 4;
  return 3;
}

// ── index: domain -> candidate properties across every connected account ────
let index = null;          // { builtAt, map: Map<domain, [{account, siteUrl}]>, errors }
let building = null;

async function buildIndex() {
  const accounts = getDb().prepare('SELECT * FROM connected_accounts').all();
  const map = new Map();
  const errors = [];
  await Promise.all(accounts.map(async (account) => {
    try {
      const client = await getClientForAccount(account);
      const sc = google.searchconsole({ version: 'v1', auth: client });
      const { data } = await withRetry(() => sc.sites.list());
      for (const s of data.siteEntry || []) {
        // an unverified user cannot read the data of the property
        if (s.permissionLevel === 'siteUnverifiedUser') continue;
        const domain = normalizeDomain(s.siteUrl);
        if (!domain) continue;
        if (!map.has(domain)) map.set(domain, []);
        map.get(domain).push({ account, siteUrl: s.siteUrl });
      }
    } catch (err) {
      errors.push({ account: account.email, error: err.message });
    }
  }));
  for (const list of map.values()) list.sort((a, b) => propertyRank(a.siteUrl) - propertyRank(b.siteUrl));
  return { builtAt: Date.now(), map, errors };
}

async function getIndex() {
  if (index && Date.now() - index.builtAt < INDEX_TTL) return index;
  if (!building) {
    building = buildIndex()
      .then((fresh) => { index = fresh; return fresh; })
      .finally(() => { building = null; });
  }
  // a stale index is better than waiting for all accounts again
  return index || building;
}

// ── "Last 24 hours" exactly as the dashboard computes it ────────────────────
// Dashboard preset: startDate = a day ago, endDate = today, hourly data
// (dataState hourly_all), and the card total is the plain sum of the rows.
function last24hBody() {
  const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  return {
    startDate:  day(1),
    endDate:    day(0),
    dimensions: ['hour'],
    rowLimit:   2500,
    dataState:  'hourly_all',
  };
}

async function statsFor(candidates) {
  let lastError = null;
  // several accounts may see the same property: if one fails, try the next
  for (const { account, siteUrl } of candidates) {
    try {
      const client = await getClientForAccount(account);
      const sc = google.searchconsole({ version: 'v1', auth: client });
      const data = await querySearchAnalytics(sc, account.id, siteUrl, last24hBody());
      const rows = data.rows || [];
      return {
        connected:   true,
        // id нужен для ссылки на карточку сайта в дашборде: /site/<accountId>/<property>
        accountId:   account.id,
        account:     account.email,
        property:    siteUrl,
        clicks:      rows.reduce((s, r) => s + (r.clicks || 0), 0),
        impressions: rows.reduce((s, r) => s + (r.impressions || 0), 0),
      };
    } catch (err) {
      lastError = { message: err.message, retryable: isRetryable(err), account: account.email, property: siteUrl };
    }
  }
  return { connected: true, error: lastError?.message || 'no data', retryable: !!lastError?.retryable,
           account: lastError?.account, property: lastError?.property };
}

// POST /api/integration/stats-24h
// Body: { domains: ["example.com", ...] }
// Response: { results: { "example.com": { connected, account, property, clicks, impressions } | { connected: false } } }
router.post('/stats-24h', async (req, res) => {
  const input = Array.isArray(req.body?.domains) ? req.body.domains : [];
  const domains = [...new Set(input.map(normalizeDomain).filter(Boolean))];
  if (domains.length > MAX_DOMAINS) return res.status(400).json({ error: `Too many domains (max ${MAX_DOMAINS})` });

  let idx;
  try {
    idx = await getIndex();
  } catch (err) {
    return res.status(502).json({ error: `Failed to list Search Console properties: ${err.message}` });
  }

  const results = {};
  await Promise.all(domains.map(async (domain) => {
    const candidates = idx.map.get(domain);
    results[domain] = candidates?.length ? await statsFor(candidates) : { connected: false };
  }));

  res.json({
    results,
    period: last24hBody(),
    index: {
      builtAt: new Date(idx.builtAt).toISOString(),
      domains: idx.map.size,
      accountErrors: idx.errors.length,
      // какие аккаунты не отдали список ресурсов: их домены выглядят как
      // «не подключены», хотя на деле просто протух токен
      failedAccounts: idx.errors.map(e => ({ account: e.account, error: String(e.error || '').slice(0, 200) })),
    },
  });
});

module.exports = router;
