import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

// GSC-style colors per metric
const METRIC_COLOR = {
  clicks:      '#1a73e8',
  impressions: '#5f6368',
  ctr:         '#1e8e3e',
  position:    '#f29900',
};

const METRIC_FILL = {
  clicks:      '#e8f0fe',
  impressions: '#f1f3f4',
  ctr:         '#e6f4ea',
  position:    '#fef7e0',
};

const METRIC_LABEL = {
  clicks:      'Total clicks',
  impressions: 'Total impressions',
  ctr:         'Average CTR',
  position:    'Average position',
};

function shortUrl(url) {
  return url
    .replace(/^sc-domain:/, '')          // strip sc-domain: prefix
    .replace(/^https?:\/\/(www\.)?/, '') // strip https://www.
    .replace(/\/$/, '');                 // strip trailing slash
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function getGroupKey(dateStr, granularity) {
  const d = new Date(dateStr);
  if (granularity === 'week') {
    // ISO week start (Monday)
    const day = d.getDay() || 7;
    const mon = new Date(d);
    mon.setDate(d.getDate() - day + 1);
    return mon.toISOString().slice(0, 10);
  }
  if (granularity === 'month') return dateStr.slice(0, 7);       // "2026-03"
  if (granularity === 'year')  return dateStr.slice(0, 4);       // "2026"
  return dateStr;                                                  // "2026-03-24"
}

function formatGroupKey(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return new Date(y, m - 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  }
  if (granularity === 'year') return key;
  return formatDate(key); // day or week — show as date
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

function formatVal(metric, v) {
  if (v == null) return '—';
  if (metric === 'ctr')      return `${v.toFixed(2)}%`;
  if (metric === 'position') return v.toFixed(1);
  return Number(v).toLocaleString();
}

// Stat pill shown above chart (like GSC header)
function StatPill({ label, value, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start px-4 py-3 rounded-lg border transition-all ${
        active
          ? 'border-b-2 bg-white shadow-sm'
          : 'border-transparent hover:bg-gray-50 text-gray-500'
      }`}
      style={{ borderBottomColor: active ? color : 'transparent' }}
    >
      <span className="text-xs text-gray-500 mb-1 whitespace-nowrap">{label}</span>
      <span className="text-lg font-semibold" style={{ color: active ? color : '#3c4043' }}>
        {value}
      </span>
    </button>
  );
}

// Custom tooltip — GSC-style
function GscTooltip({ active, payload, label, metric, granularity }) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="text-gray-500 mb-1">{formatGroupKey(label, granularity)}</p>
      <p className="font-semibold" style={{ color: METRIC_COLOR[metric] }}>
        {METRIC_LABEL[metric]}: {formatVal(metric, val)}
      </p>
    </div>
  );
}

export default function TrafficChart({ site, onDetailClick, granularity = 'day' }) {
  const [metric, setMetric] = useState('clicks');
  if (!site) return null;

  const hasData = site.data?.length > 0;

  const rows = aggregateData(site.data || [], granularity);
  const n    = rows.length || 1;

  // Aggregate stats
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
    clicks:      formatVal('clicks',      totals.clicks),
    impressions: formatVal('impressions', totals.impressions),
    ctr:         formatVal('ctr',         totals.ctr / n),
    position:    formatVal('position',    totals.position / n),
  };

  const color = METRIC_COLOR[metric];
  const fill  = METRIC_FILL[metric];

  // Chart data (already aggregated and sorted)
  const chartData = rows;
  const xFormatter = (key) => formatGroupKey(key, granularity);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Site header */}
      <div className="px-5 pt-4 pb-0 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-800 truncate">
            {shortUrl(site.siteUrl)}
            <span className="ml-2 text-xs font-normal text-gray-400">{site.accountEmail}</span>
          </p>
          {onDetailClick && (
            <button
              onClick={() => onDetailClick(site)}
              className="flex-shrink-0 ml-2 flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition"
              title="View details"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Details
            </button>
          )}
        </div>

        {/* GSC-style stat pills */}
        <div className="flex gap-1 overflow-x-auto">
          {['clicks', 'impressions', 'ctr', 'position'].map(m => (
            <StatPill
              key={m}
              label={METRIC_LABEL[m]}
              value={stats[m]}
              color={METRIC_COLOR[m]}
              active={metric === m}
              onClick={() => setMetric(m)}
            />
          ))}
        </div>
      </div>

      {/* No data message */}
      {!hasData && (
        <div className="flex items-center justify-center h-32 text-sm text-gray-400 gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
          No data for this period. Try expanding the date range.
        </div>
      )}

      {/* Chart */}
      {hasData && <div className="px-2 pt-4 pb-2">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={color} stopOpacity={0}    />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="" stroke="#f1f3f4" vertical={false} />

            <XAxis
              dataKey="date"
              tickFormatter={xFormatter}
              tick={{ fontSize: 11, fill: '#80868b' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#80868b' }}
              axisLine={false}
              tickLine={false}
              reversed={metric === 'position'}
              tickFormatter={v => metric === 'ctr' ? `${v}%` : v}
              width={40}
            />

            <Tooltip content={<GscTooltip metric={metric} granularity={granularity} />} />

            <Area
              type="monotone"
              dataKey={metric}
              stroke={color}
              strokeWidth={2}
              fill={`url(#fill-${metric})`}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>}
    </div>
  );
}
