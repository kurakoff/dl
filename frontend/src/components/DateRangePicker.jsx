import { useEffect, useRef, useState } from 'react';

const PRESETS = [
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 28 days', days: 28 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'Last 12 months', days: 365 },
];

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function fmt(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function DateRangePicker({ startDate, endDate, onChange }) {
  const [open, setOpen]     = useState(false);
  const [tempStart, setTempStart] = useState(startDate);
  const [tempEnd,   setTempEnd]   = useState(endDate);
  const ref = useRef(null);

  // sync temp when props change
  useEffect(() => { setTempStart(startDate); setTempEnd(endDate); }, [startDate, endDate]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const apply = (start, end) => {
    onChange(start, end);
    setOpen(false);
  };

  const applyPreset = (days) => {
    apply(daysAgo(days), daysAgo(1));
  };

  const applyCustom = () => {
    if (tempStart && tempEnd && tempStart <= tempEnd) apply(tempStart, tempEnd);
  };

  const today = daysAgo(1);

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm text-sm text-gray-700 hover:border-gray-300 transition"
      >
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{fmt(startDate)}</span>
        <span className="text-gray-300">–</span>
        <span>{fmt(endDate)}</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl w-64 overflow-hidden">
          {/* Custom range */}
          <div className="p-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Custom range</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8">From</span>
                <input
                  type="date"
                  value={tempStart}
                  max={tempEnd}
                  onChange={e => setTempStart(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8">To</span>
                <input
                  type="date"
                  value={tempEnd}
                  min={tempStart}
                  max={today}
                  onChange={e => setTempEnd(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-400"
                />
              </div>
              <button
                onClick={applyCustom}
                disabled={!tempStart || !tempEnd || tempStart > tempEnd}
                className="w-full mt-1 bg-blue-600 text-white text-sm rounded-xl py-2 font-medium hover:bg-blue-700 disabled:opacity-40 transition"
              >
                Apply
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100 mx-3" />

          {/* Presets */}
          <div className="p-2">
            {PRESETS.map(p => {
              const s = daysAgo(p.days);
              const active = s === startDate && daysAgo(1) === endDate;
              return (
                <button
                  key={p.days}
                  onClick={() => applyPreset(p.days)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm transition ${
                    active ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
