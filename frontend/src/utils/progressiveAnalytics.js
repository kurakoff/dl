import api from '../api/client';

// Loads per-site series through POST /api/analytics/batch in small batches, so
// cards fill in as data arrives. Sites whose request failed (GSC quota, network)
// are retried in later rounds — a failure is never shown as "no data".

const BATCH_SIZE = 25;
const PARALLEL   = 3;
const MAX_ROUNDS = 6;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const siteKey = (s) => `${s.accountId}:${s.siteUrl}`;

/**
 * @param sites        [{ accountId, siteUrl }]
 * @param params       { startDate, endDate, hourly, countries, query }
 * @param onResults    (loaded, failed) => void — `failed` only holds sites that
 *                     gave up for good (non-retryable or out of rounds)
 * @param isCancelled  () => boolean
 * @param getPriority  () => Set<siteKey> | null — loaded first (e.g. active dashboard)
 */
export async function loadSeriesProgressive({ sites, params, onResults, isCancelled, getPriority }) {
  let pending = sites.map(s => ({ accountId: s.accountId, siteUrl: s.siteUrl }));

  for (let round = 1; pending.length && round <= MAX_ROUNDS; round++) {
    if (round > 1) await sleep(Math.min(30_000, 3_000 * 2 ** (round - 2)));
    if (isCancelled()) return;

    const lastRound = round === MAX_ROUNDS;
    const queue = [...pending];
    const retry = [];

    const worker = async () => {
      while (queue.length) {
        if (isCancelled()) return;
        const prio = getPriority?.();
        if (prio?.size) queue.sort((a, b) => prio.has(siteKey(b)) - prio.has(siteKey(a)));
        const batch = queue.splice(0, BATCH_SIZE);

        let results;
        try {
          const { data } = await api.post('/api/analytics/batch', { ...params, sites: batch });
          results = data.results || [];
        } catch (err) {
          const error = err.response?.data?.error || err.message;
          results = batch.map(s => ({ ...s, error, retryable: true, data: [] }));
        }
        if (isCancelled()) return;

        const loaded = [], failed = [];
        for (const r of results) {
          if (!r.error) loaded.push(r);
          else if (r.retryable && !lastRound) retry.push({ accountId: r.accountId, siteUrl: r.siteUrl });
          else failed.push(r);
        }
        onResults(loaded, failed);
      }
    };

    await Promise.all(Array.from({ length: PARALLEL }, worker));
    pending = retry;
  }
}
