import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import NotesButton from './NotesButton';

// GSC-style colors per metric (light / dark)
const METRIC_COLOR_LIGHT = {
  clicks:      '#4285f4',
  impressions: '#5e35b1',
  ctr:         '#0d904f',
  position:    '#e8710a',
};

const METRIC_COLOR_DARK = {
  clicks:      '#6ea8fe',
  impressions: '#9d7de8',
  ctr:         '#34d399',
  position:    '#f5a623',
};

// Default export for non-chart usage (pills, stat cards, global toggles)
const METRIC_COLOR = METRIC_COLOR_LIGHT;

const METRIC_LABEL = {
  clicks:      'Clicks',
  impressions: 'Impressions',
  ctr:         'CTR',
  position:    'Position',
};

const ALL_METRICS = ['clicks', 'impressions', 'ctr', 'position'];

function shortUrl(url) {
  return url
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/$/, '');
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
  if (granularity === 'year')  return dateStr.slice(0, 4);
  return dateStr;
}

function formatHour(ts) {
  if (!ts) return '';
  if (ts.includes('T')) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
  }
  return ts;
}

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 0) return null;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function formatGroupKey(key, granularity) {
  if (granularity === 'hour') return formatHour(key);
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  }
  if (granularity === 'year') return key;
  return formatDate(key);
}

function aggregateData(rows, granularity) {
  if (!granularity || granularity === 'day' || granularity === 'hour') return rows;
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

function formatVal(metric, v) {
  if (v == null) return '—';
  if (metric === 'ctr')      return `${v.toFixed(2)}%`;
  if (metric === 'position') return v.toFixed(1);
  return Number(v).toLocaleString();
}

function fmtCompact(v) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}

// Multi-metric tooltip
function MultiTooltip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  const displayLabel = granularity === 'hour' && label?.includes('T')
    ? new Date(label).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true })
    : formatGroupKey(label, granularity);
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="text-gray-500 dark:text-gray-400 mb-1">{displayLabel}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="font-medium" style={{ color: p.stroke }}>
          {METRIC_LABEL[p.dataKey]}: {formatVal(p.dataKey, p.value)}
        </p>
      ))}
    </div>
  );
}

export default function TrafficChart({ site, granularity = 'day', globalMetrics, globalMetricVer, darkMode, freshTimestamp, hasNote, onNoteChange }) {

  // Local metrics state — defaults to globalMetrics, resets when global changes
  const [localMetrics, setLocalMetrics] = useState(globalMetrics || ['clicks']);

  // When global metrics change (via globalMetricVer), reset local to match global
  useEffect(() => {
    setLocalMetrics(globalMetrics || ['clicks']);
  }, [globalMetricVer]);

  if (!site) return null;

  const activeMetrics = localMetrics.length > 0 ? localMetrics : ['clicks'];

  const hasData = site.data?.length > 0;
  const sortedData = granularity === 'hour'
    ? [...(site.data || [])].sort((a, b) => a.date.localeCompare(b.date))
    : site.data || [];
  const rows = aggregateData(sortedData, granularity);
  const n    = rows.length || 1;

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
    ctr:         formatVal('ctr',      totals.ctr / n),
    position:    formatVal('position', totals.position / n),
  };

  const toggleLocalMetric = (m) => {
    setLocalMetrics(prev => {
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

  // "Updated X ago" — always from hourly freshness timestamp
  const updatedAgo = timeAgo(freshTimestamp);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* Site header */}
      <div className="px-4 pt-3 pb-0 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
            {shortUrl(site.siteUrl)}
            <span className="ml-2 text-xs font-normal text-gray-400">{site.accountEmail}</span>
          </p>
          <div className="flex items-center gap-3 flex-shrink-0 ml-2">
            {updatedAgo && (
              <span className="text-[11px] text-gray-400">Updated {updatedAgo}</span>
            )}
            <a
              href={`/site/${site.accountId}/${encodeURIComponent(site.siteUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition"
              title="View details (opens in new tab)"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Details
            </a>
            <NotesButton accountId={site.accountId} siteUrl={site.siteUrl} hasNote={hasNote} onNoteChange={onNoteChange} />
          </div>
        </div>

        {/* Local metric toggle pills */}
        <div className="flex gap-1 pb-2 overflow-x-auto">
          {ALL_METRICS.map(m => {
            const active = activeMetrics.includes(m);
            const pillColor = darkMode ? METRIC_COLOR_DARK[m] : METRIC_COLOR[m];
            return (
              <button
                key={m}
                onClick={() => toggleLocalMetric(m)}
                className={`flex flex-col items-start px-2.5 py-1.5 rounded-lg transition-all text-left min-w-0 ${
                  active ? 'text-white shadow-sm' : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
                style={active ? { backgroundColor: pillColor } : {}}
              >
                <span className={`text-[10px] leading-tight whitespace-nowrap ${active ? 'text-white/80' : 'text-gray-400'}`}>
                  {METRIC_LABEL[m]}
                </span>
                <span className={`text-sm font-bold ${active ? 'text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                  {stats[m]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* No data */}
      {!hasData && (
        <div className="flex items-center justify-center h-32 text-sm text-gray-400 gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
          No data for this period.
        </div>
      )}

      {/* Multi-metric chart */}
      {hasData && (
        <div className="px-2 pt-4 pb-2">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                {activeMetrics.map(m => (
                  <linearGradient key={m} id={`fill-${m}-${site.siteUrl}`} x1="0" y1="0" x2="0" y2="1">
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

              {/* Left Y axis — for clicks, impressions, ctr */}
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
                  width={40}
                />
              )}

              {/* Right Y axis — for position (reversed) */}
              {hasPosition && (
                <YAxis
                  yAxisId="right"
                  orientation={onlyPosition ? 'left' : 'right'}
                  reversed
                  tick={{ fontSize: 11, fill: '#80868b' }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
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
                  fill={`url(#fill-${m}-${site.siteUrl})`}
                  dot={false}
                  activeDot={{ r: 4, fill: colors[m], stroke: darkMode ? '#1f2937' : '#fff', strokeWidth: 2 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export { METRIC_COLOR, METRIC_LABEL, ALL_METRICS };
