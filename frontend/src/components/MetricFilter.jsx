import { useEffect, useRef, useState } from 'react';

const METRICS = [
  { value: 'clicks',      label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'ctr',         label: 'CTR %' },
  { value: 'position',    label: 'Avg. Position' },
];

const OPS = [
  { value: '>',  label: '>' },
  { value: '>=', label: '≥' },
  { value: '<',  label: '<' },
  { value: '<=', label: '≤' },
  { value: '=',  label: '=' },
];

function newRow(connector = 'AND') {
  return { id: Date.now() + Math.random(), metric: 'clicks', op: '>', value: '', connector };
}

function checkFilter(f, agg) {
  const actual = agg[f.metric];
  const target = parseFloat(f.value);
  if (isNaN(target)) return true;
  switch (f.op) {
    case '>':  return actual >  target;
    case '>=': return actual >= target;
    case '<':  return actual <  target;
    case '<=': return actual <= target;
    case '=':  return Math.abs(actual - target) < 0.01;
    default:   return true;
  }
}

export function applyMetricFilters(analytics, filters) {
  if (!filters.length) return analytics;

  return analytics.filter(site => {
    const rows = site.data || [];
    if (!rows.length) return false;

    const agg = rows.reduce((a, r) => ({
      clicks:      a.clicks      + (r.clicks      || 0),
      impressions: a.impressions + (r.impressions  || 0),
      ctr:         a.ctr         + (r.ctr          || 0),
      position:    a.position    + (r.position     || 0),
    }), { clicks: 0, impressions: 0, ctr: 0, position: 0 });

    agg.ctr      = agg.ctr      / rows.length;
    agg.position = agg.position / rows.length;

    // Split into OR-separated groups; within each group all conditions are AND
    const groups = [];
    let current = [];
    for (const f of filters) {
      if (f.connector === 'OR' && current.length > 0) {
        groups.push(current);
        current = [];
      }
      current.push(f);
    }
    groups.push(current);

    return groups.some(group => group.every(f => checkFilter(f, agg)));
  });
}

export default function MetricFilter({ filters, onChange }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([newRow()]);
  const ref = useRef(null);

  const handleOpen = () => {
    setRows(filters.length ? filters.map(f => ({ ...f })) : [newRow()]);
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const updateRow = (id, field, val) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));

  const toggleConnector = (id) =>
    setRows(prev => prev.map(r => r.id === id
      ? { ...r, connector: r.connector === 'AND' ? 'OR' : 'AND' }
      : r));

  const removeRow = (id) =>
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : [newRow()]);

  const addRow = () => setRows(prev => [...prev, newRow('AND')]);

  const apply = () => {
    const valid = rows.filter(r => r.value !== '');
    onChange(valid);
    setOpen(false);
  };

  const clear = () => {
    onChange([]);
    setRows([newRow()]);
    setOpen(false);
  };

  const metricLabel = (m) => METRICS.find(x => x.value === m)?.label ?? m;
  const opLabel     = (o) => OPS.find(x => x.value === o)?.label ?? o;

  const hasActive = filters.length > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Active filter chips */}
      {filters.map((f, i) => (
        <div key={f.id} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
              {f.connector}
            </span>
          )}
          <div className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-300 font-medium">
            <span>{metricLabel(f.metric)} {opLabel(f.op)} {f.value}</span>
            <button
              onClick={() => onChange(filters.filter(x => x.id !== f.id))}
              className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-100 leading-none"
            >×</button>
          </div>
        </div>
      ))}

      {/* Filter button */}
      <div className="relative" ref={ref}>
        <button
          onClick={handleOpen}
          className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 shadow-sm transition"
        >
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          Filter
          {hasActive && (
            <span className="bg-blue-600 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center">
              {filters.length}
            </span>
          )}
        </button>

        {open && (
          <div
            className="absolute top-full left-0 mt-1.5 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-4"
            style={{ width: '300px' }}
          >
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Filters</p>

            <div className="flex flex-col gap-1">
              {rows.map((row, i) => (
                <div key={row.id}>
                  {/* AND / OR toggle between rows */}
                  {i > 0 && (
                    <div className="flex items-center gap-2 my-1.5">
                      <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700" />
                      <button
                        onClick={() => toggleConnector(row.id)}
                        className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs font-semibold"
                      >
                        <span className={`px-2 py-0.5 transition ${row.connector === 'AND' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                          AND
                        </span>
                        <span className={`px-2 py-0.5 transition ${row.connector === 'OR' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                          OR
                        </span>
                      </button>
                      <div className="flex-1 h-px bg-gray-100 dark:bg-gray-700" />
                    </div>
                  )}

                  {/* Filter row */}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={row.metric}
                      onChange={e => updateRow(row.id, 'metric', e.target.value)}
                      className="flex-1 min-w-0 text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                    >
                      {METRICS.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>

                    <select
                      value={row.op}
                      onChange={e => updateRow(row.id, 'op', e.target.value)}
                      className="w-14 text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-1.5 py-1.5 outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-center"
                    >
                      {OPS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>

                    <input
                      type="number"
                      value={row.value}
                      onChange={e => updateRow(row.id, 'value', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && apply()}
                      placeholder="0"
                      className="w-14 text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400 bg-white dark:bg-gray-700 dark:text-gray-200"
                    />

                    <button
                      onClick={() => removeRow(row.id)}
                      className="text-gray-300 hover:text-red-400 transition text-base leading-none px-0.5"
                    >×</button>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addRow}
              className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition font-medium"
            >
              <span className="text-base leading-none">+</span> Add condition
            </button>

            <button
              onClick={apply}
              disabled={rows.every(r => r.value === '')}
              className="w-full mt-3 bg-blue-600 text-white text-sm rounded-xl py-2 font-medium hover:bg-blue-700 disabled:opacity-40 transition"
            >
              Apply
            </button>

            {hasActive && (
              <button
                onClick={clear}
                className="w-full mt-2 text-xs text-gray-400 hover:text-red-400 transition"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
