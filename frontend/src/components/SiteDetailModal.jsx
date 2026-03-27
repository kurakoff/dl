import { useEffect, useState } from 'react';
import api from '../api/client';

const TABS = ['Queries', 'Pages', 'Countries', 'Devices'];
const DIM  = { Queries: 'query', Pages: 'page', Countries: 'country', Devices: 'device' };

// ISO 3166-1 alpha-3 → readable name
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

function countryName(code) {
  return COUNTRY[code?.toLowerCase()] || code?.toUpperCase() || '—';
}

function shortUrl(url) {
  return url.replace(/^sc-domain:/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

function shortPage(url) {
  try { const u = new URL(url); return u.pathname + (u.search || ''); } catch { return url; }
}

function fmtNum(v) { return v == null ? '—' : Number(v).toLocaleString(); }
function fmtCtr(v) { return v == null ? '—' : `${Number(v).toFixed(2)}%`; }
function fmtPos(v) { return v == null ? '—' : Number(v).toFixed(1); }

// ─── Sortable table for Queries / Pages ──────────────────────────────────────
function DataTable({ rows, isPage }) {
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
    <div className="overflow-auto" style={{ maxHeight: '420px' }}>
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-white dark:bg-gray-800 z-10">
          <tr className="border-b border-gray-100 dark:border-gray-700">
            <th className="px-3 py-2.5 text-xs text-gray-400 w-6 text-center">#</th>
            <Th id="key" label={isPage ? 'Page' : 'Query'} />
            <Th id="clicks"      label="Clicks"      right />
            <Th id="impressions" label="Impressions"  right />
            <Th id="ctr"         label="CTR"          right />
            <Th id="position"    label="Position"     right />
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Countries ───────────────────────────────────────────────────────────────
function CountriesView({ rows }) {
  const max = Math.max(...rows.map(r => r.clicks || 0), 1);
  return (
    <div className="space-y-2.5 overflow-auto" style={{ maxHeight: '420px' }}>
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

// ─── Devices ─────────────────────────────────────────────────────────────────
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

// ─── Modal ───────────────────────────────────────────────────────────────────
export default function SiteDetailModal({ site, startDate, endDate, onClose }) {
  const [tab,     setTab]     = useState('Queries');
  const [cache,   setCache]   = useState({});
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Reset cache when site changes
  useEffect(() => { setTab('Queries'); setCache({}); }, [site?.siteUrl]);

  useEffect(() => {
    if (!site) return;
    if (cache[tab] !== undefined) return;

    setLoading(true);
    setError('');
    api.get('/api/analytics/site-detail', {
      params: { accountId: site.accountId, siteUrl: site.siteUrl, startDate, endDate, dimension: DIM[tab] },
    })
      .then(res => setCache(c => ({ ...c, [tab]: res.data.rows || [] })))
      .catch(() => setError('Failed to load data.'))
      .finally(() => setLoading(false));
  }, [tab, site, startDate, endDate]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  if (!site) return null;

  const rows = cache[tab] || [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden"
           style={{ maxHeight: 'calc(100vh - 8rem)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-base">{shortUrl(site.siteUrl)}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{site.accountEmail}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-700 px-6 flex-shrink-0 gap-1">
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

        {/* Content */}
        <div className="flex-1 overflow-hidden px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center h-40 gap-2 text-gray-400 text-sm">
              <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Loading…
            </div>
          )}
          {!loading && error && <p className="text-sm text-red-400 text-center py-10">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-10">No data for this period.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              {tab === 'Queries'   && <DataTable rows={rows} isPage={false} />}
              {tab === 'Pages'     && <DataTable rows={rows} isPage={true}  />}
              {tab === 'Countries' && <CountriesView rows={rows} />}
              {tab === 'Devices'   && <DevicesView   rows={rows} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
