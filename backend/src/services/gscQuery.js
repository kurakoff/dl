// Throttled, retried and cached wrapper around searchanalytics.query.
//
// Why: the dashboard queries every site of every connected account. With
// thousands of sites, firing them all at once blows through the GSC quota
// (1,200 QPM per Google user + short-term load quota), and every rejected call
// used to come back as an empty series, i.e. a card showing zeros.

const MAX_CONCURRENCY_PER_ACCOUNT = 8;
const MAX_ATTEMPTS = 6;
const CACHE_MAX_ENTRIES = 50_000;

// ── Per-account concurrency limiter ─────────────────────────────────────────
const limiters = new Map(); // accountId -> { active, queue }

function withLimit(accountId, fn) {
  let l = limiters.get(accountId);
  if (!l) { l = { active: 0, queue: [] }; limiters.set(accountId, l); }
  return new Promise((resolve, reject) => {
    const run = async () => {
      l.active++;
      try { resolve(await fn()); }
      catch (err) { reject(err); }
      finally {
        l.active--;
        const next = l.queue.shift();
        if (next) next();
      }
    };
    if (l.active < MAX_CONCURRENCY_PER_ACCOUNT) run();
    else l.queue.push(run);
  });
}

// ── Retry on quota / transient errors ───────────────────────────────────────
function isRetryable(err) {
  const status = err.code || err.status || err.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('quota') || msg.includes('rate limit') || msg.includes('ratelimit')
    || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('socket hang up');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
      // 1s, 2s, 4s, 8s, 16s + jitter — the per-minute quota refills within that window
      await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 1000);
    }
  }
}

// ── Cache (successful responses only) ───────────────────────────────────────
const cache = new Map(); // key -> { expires, data }

function ttlFor(requestBody) {
  if (requestBody.dataState === 'hourly_all') return 5 * 60_000;
  // GSC finalizes data with a ~2-3 day lag; older ranges barely change
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  return requestBody.endDate < threeDaysAgo ? 6 * 3_600_000 : 10 * 60_000;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data, ttl) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map keeps insertion order: drop the oldest 10%
    let n = Math.ceil(CACHE_MAX_ENTRIES / 10);
    for (const k of cache.keys()) { cache.delete(k); if (--n <= 0) break; }
  }
  cache.set(key, { expires: Date.now() + ttl, data });
}

// ── Public API ──────────────────────────────────────────────────────────────
// Returns the raw `data` of searchanalytics.query ({ rows, ... }).
async function querySearchAnalytics(sc, accountId, siteUrl, requestBody) {
  const key = JSON.stringify([accountId, siteUrl, requestBody]);
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await withLimit(accountId, () =>
    withRetry(async () => (await sc.searchanalytics.query({ siteUrl, requestBody })).data)
  );
  cacheSet(key, data, ttlFor(requestBody));
  return data;
}

module.exports = { querySearchAnalytics, withLimit, withRetry, isRetryable };
