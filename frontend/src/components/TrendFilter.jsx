import { useEffect, useRef, useState } from 'react';

const METRICS = [
  { value: 'clicks',      label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'ctr',         label: 'CTR %' },
  { value: 'position',    label: 'Avg. Position' },
];

const TRENDS = [
  { value: 'growing',    label: 'Growing',    icon: '↑', color: 'text-green-600', bg: 'bg-green-50',  border: 'border-green-200' },
  { value: 'stagnating', label: 'Stagnating', icon: '→', color: 'text-gray-500',  bg: 'bg-gray-50',   border: 'border-gray-200'  },
  { value: 'declining',  label: 'Declining',  icon: '↓', color: 'text-red-500',   bg: 'bg-red-50',    border: 'border-red-200'   },
];

// ─── Math helpers ─────────────────────────────────────────────────────────────
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function linearRegression(values) {
  const n    = values.length;
  if (n < 3) return { tStat: 0, relChange: 0 };
  const meanX = (n - 1) / 2;
  const meanY = avg(values);
  let ssXX = 0, ssXY = 0;
  for (let i = 0; i < n; i++) { ssXX += (i - meanX) ** 2; ssXY += (i - meanX) * (values[i] - meanY); }
  if (ssXX === 0) return { tStat: 0, relChange: 0 };
  const slope = ssXY / ssXX;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (values[i] - (slope * i + meanY - slope * meanX)) ** 2;
  const se      = Math.sqrt(rss / Math.max(n - 2, 1)) / Math.sqrt(ssXX);
  const tStat   = se > 0 ? slope / se : 0;
  const relChange = meanY !== 0 ? (slope * (n - 1) / Math.abs(meanY)) * 100 : 0;
  return { tStat, relChange };
}

function mannKendall(values) {
  const n = values.length;
  if (n < 4) return { z: 0 };
  let S = 0;
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) { const d = values[j] - values[i]; S += d > 0 ? 1 : d < 0 ? -1 : 0; }
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z    = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  return { z };
}

function invertDir(d) {
  return d === 'growing' ? 'declining' : d === 'declining' ? 'growing' : 'stagnating';
}

export function computeTrend(siteData, metric) {
  if (!siteData || siteData.length < 2) return 'stagnating';

  const sorted = [...siteData]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(r => r[metric] ?? 0);

  const n = sorted.length;
  if (sorted.every(v => v === 0)) return 'stagnating';

  const useWeeklyWindow = n >= 14;
  const firstAvg = useWeeklyWindow
    ? avg(sorted.slice(0, 7))
    : avg(sorted.slice(0, Math.max(1, Math.floor(n / 3))));
  const lastAvg  = useWeeklyWindow
    ? avg(sorted.slice(n - 7))
    : avg(sorted.slice(n - Math.max(1, Math.floor(n / 3))));

  // When firstAvg is 0, use 1 as baseline to avoid auto-"growing" for tiny values
  const safeFirstAvg = firstAvg === 0 ? 1 : firstAvg;
  const relChange = (lastAvg - safeFirstAvg) / Math.abs(safeFirstAvg) * 100;

  let direction = 'stagnating';

  if (n < 5) {
    const T = 20;
    if (relChange >  T) direction = 'growing';
    if (relChange < -T) direction = 'declining';

  } else if (n < 10) {
    const T = 15;
    if (relChange >  T) direction = 'growing';
    if (relChange < -T) direction = 'declining';

  } else if (n < 21) {
    const { tStat } = linearRegression(sorted);
    const T = 10;
    if (Math.abs(tStat) > 1.75) {
      if (relChange >  T) direction = 'growing';
      if (relChange < -T) direction = 'declining';
    }

  } else {
    const { tStat } = linearRegression(sorted);
    const { z }     = mannKendall(sorted);
    const T = 5;
    if (Math.abs(tStat) > 2.0 || Math.abs(z) > 1.96) {
      if (relChange >  T) direction = 'growing';
      if (relChange < -T) direction = 'declining';
    }
  }

  return metric === 'position' ? invertDir(direction) : direction;
}

export function applyTrendFilter(analytics, trendFilter) {
  const { trends, metric } = trendFilter || {};
  if (!trends || trends.length === 0) return analytics;
  return analytics.filter(site => trends.includes(computeTrend(site.data, metric)));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TrendFilter({ value, onChange }) {
  const [open,        setOpen]        = useState(false);
  const [draftTrends, setDraftTrends] = useState(value?.trends || []);
  const [draftMetric, setDraftMetric] = useState(value?.metric || 'clicks');
  const ref = useRef(null);

  const handleOpen = () => {
    setDraftTrends(value?.trends || []);
    setDraftMetric(value?.metric || 'clicks');
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const toggleTrend = (t) =>
    setDraftTrends(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const apply = () => { onChange({ trends: draftTrends, metric: draftMetric }); setOpen(false); };
  const clear  = () => { onChange({ trends: [], metric: 'clicks' }); setOpen(false); };

  const hasActive  = value?.trends?.length > 0;
  const activeItems = TRENDS.filter(t => value?.trends?.includes(t.value));
  const metricLabel = METRICS.find(m => m.value === value?.metric)?.label ?? value?.metric;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {activeItems.map((t, i) => (
        <div key={t.value} className="flex items-center gap-1">
          {i > 0 && <span className="text-xs text-gray-400 font-medium px-1">OR</span>}
          <div className={`flex items-center gap-1 px-2.5 py-1.5 ${t.bg} border ${t.border} rounded-xl text-xs ${t.color} font-medium`}>
            <span>{t.icon} {t.label} · {metricLabel}</span>
            <button
              onClick={() => onChange({ ...value, trends: value.trends.filter(x => x !== t.value) })}
              className="ml-0.5 hover:opacity-70 leading-none"
            >×</button>
          </div>
        </div>
      ))}

      <div className="relative" ref={ref}>
        <button
          onClick={handleOpen}
          className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 shadow-sm transition"
        >
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          Trend
          {hasActive && (
            <span className="bg-blue-600 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center">
              {value.trends.length}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-1.5 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4"
               style={{ width: '260px' }}>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Trend filter</p>

            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5">Metric to analyze</p>
              <select
                value={draftMetric}
                onChange={e => setDraftMetric(e.target.value)}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
              >
                {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            <div className="mb-3">
              <p className="text-xs text-gray-400 mb-1.5">Show sites that are</p>
              <div className="flex flex-col gap-1.5">
                {TRENDS.map(t => {
                  const active = draftTrends.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      onClick={() => toggleTrend(t.value)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm font-medium transition text-left ${
                        active
                          ? `${t.bg} ${t.border} ${t.color}`
                          : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                      }`}
                    >
                      <span className="text-base w-4 text-center">{t.icon}</span>
                      {t.label}
                      {active && <span className="ml-auto text-xs opacity-60">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-3 leading-relaxed">
              Compares the start and end of the selected period with additional statistical validation.
            </p>

            <button
              onClick={apply}
              disabled={draftTrends.length === 0}
              className="w-full bg-blue-600 text-white text-sm rounded-xl py-2 font-medium hover:bg-blue-700 disabled:opacity-40 transition"
            >
              Apply
            </button>

            {hasActive && (
              <button onClick={clear} className="w-full mt-2 text-xs text-gray-400 hover:text-red-400 transition">
                Clear trend filter
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
