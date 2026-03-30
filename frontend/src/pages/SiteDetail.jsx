import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../api/client';
import DateRangePicker from '../components/DateRangePicker';

// ── Constants ────────────────────────────────────────────────────────────────

const METRIC_COLOR_LIGHT = {
  clicks: '#4285f4', impressions: '#5e35b1', ctr: '#0d904f', position: '#e8710a',
};
const METRIC_COLOR_DARK = {
  clicks: '#6ea8fe', impressions: '#9d7de8', ctr: '#34d399', position: '#f5a623',
};
const METRIC_COLOR = METRIC_COLOR_LIGHT;
const METRIC_LABEL = { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR', position: 'Position' };
const ALL_METRICS = ['clicks', 'impressions', 'ctr', 'position'];

const TABS = ['Queries', 'Pages', 'Countries', 'Devices'];
const DIM  = { Queries: 'query', Pages: 'page', Countries: 'country', Devices: 'device' };

const COUNTRY = {
  usa:'United States', gbr:'United Kingdom', ind:'India', can:'Canada',
  aus:'Australia', deu:'Germany', fra:'France', rus:'Russia', bra:'Brazil',
  jpn:'Japan', kor:'South Korea', chn:'China', esp:'Spain', ita:'Italy',
  nld:'Netherlands', pol:'Poland', tur:'Turkey', mex:'Mexico', idn:'Indonesia',
  tha:'Thailand', ukr:'Ukraine', arg:'Argentina', zaf:'South Africa',
  phl:'Philippines', vnm:'Vietnam', pak:'Pakistan', bgd:'Bangladesh',
  egy:'Egypt', nga:'Nigeria', prt:'Portugal', swe:'Sweden', nor:'Norway',
  dnk:'Denmark', fin:'Finland', bel:'Belgium', che:'Switzerland', aut:'Austria',
  cze:'Czech Republic', svk:'Slovakia', hun:'Hungary', rou:'Romania',
  hrv:'Croatia', sgp:'Singapore', mys:'Malaysia', hkg:'Hong Kong',
  twn:'Taiwan', nzl:'New Zealand', isr:'Israel', sau:'Saudi Arabia',
  are:'United Arab Emirates', irn:'Iran', kaz:'Kazakhstan', uzb:'Uzbekistan',
  blr:'Belarus', ltu:'Lithuania', lva:'Latvia', est:'Estonia', geo:'Georgia',
  arm:'Armenia', aze:'Azerbaijan',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function shortUrl(url) {
  return url.replace(/^sc-domain:/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

function shortPage(url) {
  try { const u = new URL(url); return u.pathname + (u.search || ''); } catch { return url; }
}

function countryName(code) {
  return COUNTRY[code?.toLowerCase()] || code?.toUpperCase() || '—';
}

function fmtNum(v) { return v == null ? '—' : Number(v).toLocaleString(); }
function fmtCtr(v) { return v == null ? '—' : `${Number(v).toFixed(2)}%`; }
function fmtPos(v) { return v == null ? '—' : Number(v).toFixed(1); }

function formatVal(metric, v) {
  if (v == null) return '—';
  if (metric === 'ctr') return `${v.toFixed(2)}%`;
  if (metric === 'position') return v.toFixed(1);
  return Number(v).toLocaleString();
}

function fmtCompact(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function getGroupKey(dateStr, granularity) {
  const d = new Date(dateStr);
  if (granularity === 'week') {
    const day = d.getDay() || 7;
    const mon = new Date(d);
    mon.setDate(d.getDate() - day + 1);
    return mon.toISOString().slice(0, 10);
  }
  if (granularity === 'month') return dateStr.slice(0, 7);
  if (granularity === 'year') return dateStr.slice(0, 4);
  return dateStr;
}

function formatGroupKey(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  }
  if (granularity === 'year') return key;
  return formatDate(key);
}

function aggregateData(rows, granularity) {
  if (!granularity || granularity === 'day') return rows;
  const groups = new Map();
  for (const r of rows) {
    const key = getGroupKey(r.date, granularity);
    if (!groups.has(key)) groups.set(key, { date: key, clicks: 0, impressions: 0, position: 0, _days: 0 });
    const g = groups.get(key);
    g.clicks      += r.clicks      || 0;
    g.impressions += r.impressions || 0;
    g.position    += r.position    || 0;
    g._days       += 1;
  }
  return [...groups.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(g => ({
      date:        g.date,
      clicks:      g.clicks,
      impressions: g.impressions,
      ctr:         g.impressions > 0 ? Math.round(g.clicks / g.impressions * 10000) / 100 : 0,
      position:    g._days > 0 ? Math.round(g.position / g._days * 10) / 10 : 0,
    }));
}

// ── Chart tooltip ────────────────────────────────────────────────────────────

function MultiTooltip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="text-gray-500 dark:text-gray-400 mb-1">{formatGroupKey(label, granularity)}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="font-medium" style={{ color: p.stroke }}>
          {METRIC_LABEL[p.dataKey]}: {formatVal(p.dataKey, p.value)}
        </p>
      ))}
    </div>
  );
}

// ── IndexButton ─────────────────────────────────────────────────────────────

function IndexButton({ url, onRequest }) {
  const [state, setState] = useState('idle'); // idle | loading | success | error

  const handleClick = async () => {
    if (state === 'loading' || state === 'success') return;
    setState('loading');
    const result = await onRequest(url);
    if (result.ok) {
      setState('success');
      setTimeout(() => setState('idle'), 3000);
    } else {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  if (state === 'loading') {
    return (
      <svg className="animate-spin h-4 w-4 text-blue-500 mx-auto" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
    );
  }

  if (state === 'success') {
    return (
      <svg className="h-4 w-4 text-green-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (state === 'error') {
    return (
      <svg className="h-4 w-4 text-red-400 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
      </svg>
    );
  }

  return (
    <button
      onClick={handleClick}
      title="Request re-indexing"
      className="text-gray-400 hover:text-blue-500 transition"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  );
}

// ── DataTable (Queries / Pages) ──────────────────────────────────────────────

function DataTable({ rows, isPage, onRequestIndexing }) {
  const [col, setCol] = useState('clicks');
  const [asc, setAsc] = useState(false);

  const sorted = [...rows].sort((a, b) => {
    const va = col === 'key' ? (a.key || '').localeCompare(b.key || '') : ((a[col] ?? 0) - (b[col] ?? 0));
    return asc ? va : -va;
  });

  const Th = ({ id, label, right }) => (
    <th
      onClick={() => { col === id ? setAsc(x => !x) : (setCol(id), setAsc(false)); }}
      className={`px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
    >
      {label}{col === id && <span className="ml-1 opacity-50">{asc ? '↑' : '↓'}</span>}
    </th>
  );

  return (
    <div className="overflow-auto" style={{ maxHeight: '520px' }}>
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-white dark:bg-gray-800 z-10">
          <tr className="border-b border-gray-100 dark:border-gray-700">
            <th className="px-3 py-2.5 text-xs text-gray-400 w-6 text-center">#</th>
            <Th id="key" label={isPage ? 'Page' : 'Query'} />
            <Th id="clicks"      label="Clicks"      right />
            <Th id="impressions" label="Impressions"  right />
            <Th id="ctr"         label="CTR"          right />
            <Th id="position"    label="Position"     right />
            {isPage && <th className="px-2 py-2.5 w-8" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/80 dark:hover:bg-gray-700/30">
              <td className="px-3 py-2 text-xs text-gray-300 dark:text-gray-600 text-center">{i + 1}</td>
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200 max-w-xs">
                <span className="block truncate" title={row.key}>
                  {isPage ? shortPage(row.key) : row.key}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-200">{fmtNum(row.clicks)}</td>
              <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{fmtNum(row.impressions)}</td>
              <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{fmtCtr(row.ctr)}</td>
              <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{fmtPos(row.position)}</td>
              {isPage && (
                <td className="px-2 py-2 text-center">
                  <IndexButton url={row.key} onRequest={onRequestIndexing} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Countries ────────────────────────────────────────────────────────────────

function CountriesView({ rows }) {
  const max = Math.max(...rows.map(r => r.clicks || 0), 1);
  return (
    <div className="space-y-2.5 overflow-auto" style={{ maxHeight: '520px' }}>
      {rows.map((row, i) => {
        const pct = ((row.clicks || 0) / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3 pr-1">
            <span className="text-xs text-gray-300 dark:text-gray-600 w-5 text-right flex-shrink-0">{i + 1}</span>
            <span className="text-sm text-gray-700 dark:text-gray-200 w-36 truncate flex-shrink-0">{countryName(row.key)}</span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex gap-3 text-xs text-right flex-shrink-0">
              <span className="font-medium text-gray-700 dark:text-gray-200 w-14">{fmtNum(row.clicks)}</span>
              <span className="text-gray-400 w-16 hidden sm:block">{fmtCtr(row.ctr)}</span>
              <span className="text-gray-400 w-8 hidden sm:block">{fmtPos(row.position)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Devices ──────────────────────────────────────────────────────────────────

const DEV_COLOR = { DESKTOP: '#1a73e8', MOBILE: '#1e8e3e', TABLET: '#f29900' };
const DEV_LABEL = { DESKTOP: 'Desktop', MOBILE: 'Mobile', TABLET: 'Tablet' };

function DevicesView({ rows }) {
  const total = rows.reduce((s, r) => s + (r.clicks || 0), 0) || 1;
  return (
    <div className="space-y-5 py-2">
      {rows.map((row, i) => {
        const key   = row.key?.toUpperCase();
        const pct   = ((row.clicks || 0) / total) * 100;
        const color = DEV_COLOR[key] || '#9aa0a6';
        return (
          <div key={i}>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{DEV_LABEL[key] || row.key}</span>
              <div className="flex gap-4 text-sm text-gray-500 dark:text-gray-400">
                <span>{fmtNum(row.clicks)} clicks</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">{pct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
              <div className="h-3 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <div className="flex gap-5 mt-1.5 text-xs text-gray-400">
              <span>Impressions: {fmtNum(row.impressions)}</span>
              <span>CTR: {fmtCtr(row.ctr)}</span>
              <span>Avg. position: {fmtPos(row.position)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SiteDetail Page ──────────────────────────────────────────────────────────

export default function SiteDetail() {
  const { accountId, encodedSiteUrl } = useParams();
  const navigate = useNavigate();
  const siteUrl = decodeURIComponent(encodedSiteUrl);

  const [darkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  // Date range
  const [startDate, setStartDate] = useState(daysAgo(28));
  const [endDate, setEndDate]     = useState(daysAgo(1));
  const [granularity, setGranularity] = useState('day');

  // Traffic data
  const [siteData, setSiteData]       = useState(null);
  const [loadingChart, setLoadingChart] = useState(true);

  // Metrics toggle
  const [activeMetrics, setActiveMetrics] = useState(['clicks']);

  // Tabs
  const [tab, setTab]       = useState('Queries');
  const [cache, setCache]   = useState({});
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError]     = useState('');

  // Toast
  const [toast, setToast] = useState(null); // { message, type: 'success' | 'error' }

  // Batch re-index
  const [batchIndexing, setBatchIndexing] = useState(false);

  // Fetch traffic data
  const fetchTraffic = useCallback(async () => {
    setLoadingChart(true);
    try {
      const res = await api.get('/api/analytics', { params: { startDate, endDate } });
      const results = res.data.results || [];
      const match = results.find(
        r => String(r.accountId) === String(accountId) && r.siteUrl === siteUrl
      );
      setSiteData(match || null);
    } catch { /* ignore */ }
    finally { setLoadingChart(false); }
  }, [startDate, endDate, accountId, siteUrl]);

  useEffect(() => { fetchTraffic(); }, [fetchTraffic]);

  // Request re-indexing
  const handleRequestIndexing = useCallback(async (url) => {
    try {
      await api.post('/api/indexing/publish', {
        accountId,
        url,
        type: 'URL_UPDATED',
      });
      setToast({ message: 'Submitted for re-indexing', type: 'success' });
      setTimeout(() => setToast(null), 3000);
      return { ok: true };
    } catch (err) {
      const errCode = err.response?.data?.error;
      if (errCode === 'scope_missing') {
        setToast({ message: 'Disconnect and reconnect this account to enable indexing.', type: 'error' });
      } else {
        setToast({ message: 'Indexing request failed', type: 'error' });
      }
      setTimeout(() => setToast(null), 4000);
      return { ok: false };
    }
  }, [accountId]);

  // Batch re-index all pages
  const handleBatchReindex = useCallback(async () => {
    setBatchIndexing(true);
    try {
      // Auto-load pages if not cached
      let pages = cache['Pages'];
      if (!pages) {
        const res = await api.get('/api/analytics/site-detail', {
          params: { accountId, siteUrl, startDate, endDate, dimension: 'page' },
        });
        pages = res.data.rows || [];
        setCache(c => ({ ...c, Pages: pages }));
      }
      if (pages.length === 0) {
        setToast({ message: 'No pages found', type: 'error' });
        setTimeout(() => setToast(null), 3000);
        return;
      }
      const urls = pages.map(r => r.key);
      const res = await api.post('/api/indexing/publish-batch', {
        accountId,
        urls,
        type: 'URL_UPDATED',
      });
      const { succeeded, failed } = res.data;
      setToast({
        message: `Re-indexed: ${succeeded} ok${failed ? `, ${failed} failed` : ''}`,
        type: failed ? 'error' : 'success',
      });
    } catch (err) {
      const errCode = err.response?.data?.error;
      if (errCode === 'scope_missing') {
        setToast({ message: 'Disconnect and reconnect this account to enable indexing.', type: 'error' });
      } else {
        setToast({ message: 'Batch indexing failed', type: 'error' });
      }
    } finally {
      setBatchIndexing(false);
      setTimeout(() => setToast(null), 4000);
    }
  }, [accountId, siteUrl, startDate, endDate, cache]);

  // Fetch tab data
  useEffect(() => {
    if (cache[tab] !== undefined) return;
    setTabLoading(true);
    setTabError('');
    api.get('/api/analytics/site-detail', {
      params: { accountId, siteUrl, startDate, endDate, dimension: DIM[tab] },
    })
      .then(res => setCache(c => ({ ...c, [tab]: res.data.rows || [] })))
      .catch(() => setTabError('Failed to load data.'))
      .finally(() => setTabLoading(false));
  }, [tab, accountId, siteUrl, startDate, endDate]);

  // Reset tab cache when dates change
  useEffect(() => { setCache({}); }, [startDate, endDate]);

  // Chart data
  const rows = aggregateData(siteData?.data || [], granularity);
  const hasData = rows.length > 0;
  const n = rows.length || 1;

  const totals = rows.reduce(
    (a, r) => ({
      clicks:      a.clicks      + (r.clicks      || 0),
      impressions: a.impressions + (r.impressions || 0),
      ctr:         a.ctr         + (r.ctr         || 0),
      position:    a.position    + (r.position    || 0),
    }),
    { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  );

  const stats = {
    clicks:      fmtCompact(totals.clicks),
    impressions: fmtCompact(totals.impressions),
    ctr:         formatVal('ctr', totals.ctr / n),
    position:    formatVal('position', totals.position / n),
  };

  const toggleMetric = (m) => {
    setActiveMetrics(prev => {
      if (prev.includes(m)) {
        if (prev.length === 1) return prev;
        return prev.filter(x => x !== m);
      }
      return [...prev, m];
    });
  };

  const hasPosition = activeMetrics.includes('position');
  const onlyPosition = activeMetrics.length === 1 && activeMetrics[0] === 'position';
  const hasLeftAxis = activeMetrics.some(m => m !== 'position');
  const colors = darkMode ? METRIC_COLOR_DARK : METRIC_COLOR_LIGHT;

  const tabRows = cache[tab] || [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Dashboard
            </button>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {shortUrl(siteUrl)}
              </h1>
              {siteData?.accountEmail && (
                <p className="text-xs text-gray-400 mt-0.5">{siteData.accountEmail}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 py-4 flex flex-wrap items-center gap-3">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
        />

        {/* Granularity picker */}
        {/* Re-index All Pages */}
        <button
          onClick={handleBatchReindex}
          disabled={batchIndexing}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl shadow-sm hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition disabled:opacity-50"
        >
          {batchIndexing ? (
            <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Re-index All Pages
        </button>
        <div className="flex items-center bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl shadow-sm overflow-hidden">
          {[['D', 'day'], ['W', 'week'], ['M', 'month']].map(([label, val]) => (
            <button
              key={val}
              onClick={() => setGranularity(val)}
              className={`px-3 py-2 text-sm font-medium transition ${
                granularity === val
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric pills */}
      <div className="px-6 pb-4">
        <div className="flex gap-2 flex-wrap">
          {ALL_METRICS.map(m => {
            const active = activeMetrics.includes(m);
            const pillColor = darkMode ? METRIC_COLOR_DARK[m] : METRIC_COLOR[m];
            return (
              <button
                key={m}
                onClick={() => toggleMetric(m)}
                className={`flex flex-col items-start px-4 py-2.5 rounded-xl transition-all text-left ${
                  active ? 'text-white shadow-sm' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
                style={active ? { backgroundColor: pillColor } : {}}
              >
                <span className={`text-xs leading-tight ${active ? 'text-white/80' : 'text-gray-400'}`}>
                  {METRIC_LABEL[m]}
                </span>
                <span className={`text-lg font-bold ${active ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                  {stats[m]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="px-6 pb-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
          {loadingChart ? (
            <div className="flex items-center justify-center h-[350px] gap-2 text-gray-400">
              <svg className="animate-spin h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Loading chart…
            </div>
          ) : !hasData ? (
            <div className="flex items-center justify-center h-[350px] text-sm text-gray-400 gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              </svg>
              No data for this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  {activeMetrics.map(m => (
                    <linearGradient key={m} id={`fill-detail-${m}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={colors[m]} stopOpacity={darkMode ? 0.2 : 0.12} />
                      <stop offset="95%" stopColor={colors[m]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid strokeDasharray="" stroke={darkMode ? '#374151' : '#f1f3f4'} vertical={false} />

                <XAxis
                  dataKey="date"
                  tickFormatter={(key) => formatGroupKey(key, granularity)}
                  tick={{ fontSize: 11, fill: '#80868b' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />

                {hasLeftAxis && (
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#80868b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => {
                      if (activeMetrics.includes('ctr') && !activeMetrics.includes('clicks') && !activeMetrics.includes('impressions')) return `${v}%`;
                      return fmtCompact(v);
                    }}
                    width={50}
                  />
                )}

                {hasPosition && (
                  <YAxis
                    yAxisId="right"
                    orientation={onlyPosition ? 'left' : 'right'}
                    reversed
                    tick={{ fontSize: 11, fill: '#80868b' }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                    domain={['auto', 'auto']}
                  />
                )}

                <Tooltip content={<MultiTooltip granularity={granularity} />} />

                {activeMetrics.map(m => (
                  <Area
                    key={m}
                    yAxisId={m === 'position' ? 'right' : 'left'}
                    type="monotone"
                    dataKey={m}
                    stroke={colors[m]}
                    strokeWidth={2}
                    fill={`url(#fill-detail-${m})`}
                    dot={false}
                    activeDot={{ r: 4, fill: colors[m], stroke: darkMode ? '#1f2937' : '#fff', strokeWidth: 2 }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pb-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {/* Tab headers */}
          <div className="flex border-b border-gray-100 dark:border-gray-700 px-6 gap-1">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-3 px-3 text-sm font-medium border-b-2 -mb-px transition ${
                  tab === t
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t}
                {cache[t] !== undefined && (
                  <span className="ml-1.5 text-xs opacity-50">{cache[t].length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="px-6 py-4">
            {tabLoading && (
              <div className="flex items-center justify-center h-40 gap-2 text-gray-400 text-sm">
                <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Loading…
              </div>
            )}
            {!tabLoading && tabError && <p className="text-sm text-red-400 text-center py-10">{tabError}</p>}
            {!tabLoading && !tabError && tabRows.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-10">No data for this period.</p>
            )}
            {!tabLoading && !tabError && tabRows.length > 0 && (
              <>
                {tab === 'Queries'   && <DataTable rows={tabRows} isPage={false} />}
                {tab === 'Pages'     && <DataTable rows={tabRows} isPage={true} onRequestIndexing={handleRequestIndexing} />}
                {tab === 'Countries' && <CountriesView rows={tabRows} />}
                {tab === 'Devices'   && <DevicesView   rows={tabRows} />}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
          <div className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}>
            {toast.type === 'success' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
              </svg>
            )}
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
