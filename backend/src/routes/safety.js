const express = require('express');
const { google } = require('googleapis');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Normalize GSC site URL to a fetchable URL for Safe Browsing
function normalizeSiteUrl(siteUrl) {
  if (siteUrl.startsWith('sc-domain:')) {
    return 'https://' + siteUrl.replace('sc-domain:', '') + '/';
  }
  // Already an http(s) URL — ensure trailing slash
  return siteUrl.endsWith('/') ? siteUrl : siteUrl + '/';
}

// GET /api/safety/status — return cached safety status for all user's sites
router.get('/status', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT account_id, site_url, status, threat_types, checked_at FROM safe_browsing_cache WHERE user_id = ?'
  ).all(req.userId);

  const result = {};
  for (const r of rows) {
    result[`${r.account_id}:${r.site_url}`] = {
      status: r.status,
      threatTypes: r.threat_types,
      checkedAt: r.checked_at,
    };
  }
  res.json(result);
});

// POST /api/safety/check — run Safe Browsing check for given sites
router.post('/check', async (req, res) => {
  const apiKey = process.env.SAFE_BROWSING_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'SAFE_BROWSING_API_KEY not configured' });
  }

  const { sites } = req.body; // [{ accountId, siteUrl }]
  if (!Array.isArray(sites) || sites.length === 0) {
    return res.status(400).json({ error: 'sites array required' });
  }

  // Build unique normalized URLs
  const siteMap = new Map(); // normalizedUrl → [{ accountId, siteUrl }]
  for (const s of sites) {
    const normalized = normalizeSiteUrl(s.siteUrl);
    if (!siteMap.has(normalized)) siteMap.set(normalized, []);
    siteMap.get(normalized).push({ accountId: s.accountId, siteUrl: s.siteUrl });
  }

  const urls = [...siteMap.keys()];

  try {
    const safebrowsing = google.safebrowsing({ version: 'v4' });
    const { data } = await safebrowsing.threatMatches.find({
      auth: apiKey,
      requestBody: {
        client: { clientId: 'seo-dashboard', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map(url => ({ url })),
        },
      },
    });

    // Build threat map: normalizedUrl → Set of threat types
    const threatMap = new Map();
    if (data.matches) {
      for (const match of data.matches) {
        const url = match.threat?.url;
        if (!url) continue;
        if (!threatMap.has(url)) threatMap.set(url, new Set());
        threatMap.get(url).add(match.threatType);
      }
    }

    // UPSERT results into cache
    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO safe_browsing_cache (user_id, account_id, site_url, status, threat_types, checked_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, account_id, site_url)
      DO UPDATE SET status = excluded.status, threat_types = excluded.threat_types, checked_at = CURRENT_TIMESTAMP
    `);

    const upsertMany = db.transaction((entries) => {
      for (const entry of entries) {
        upsert.run(entry.userId, entry.accountId, entry.siteUrl, entry.status, entry.threatTypes);
      }
    });

    const entries = [];
    for (const [normalized, siteEntries] of siteMap) {
      const threats = threatMap.get(normalized);
      const status = threats ? 'threat' : 'clean';
      const threatTypes = threats ? [...threats].join(',') : '';
      for (const s of siteEntries) {
        entries.push({
          userId: req.userId,
          accountId: s.accountId,
          siteUrl: s.siteUrl,
          status,
          threatTypes,
        });
      }
    }

    upsertMany(entries);

    // Return updated status
    const result = {};
    for (const e of entries) {
      result[`${e.accountId}:${e.siteUrl}`] = {
        status: e.status,
        threatTypes: e.threatTypes,
        checkedAt: new Date().toISOString(),
      };
    }

    res.json(result);
  } catch (err) {
    console.error('Safe Browsing API error:', err.message);
    res.status(500).json({ error: 'Safe Browsing check failed' });
  }
});

module.exports = router;
