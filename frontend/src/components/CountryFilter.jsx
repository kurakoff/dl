import { useState, useRef, useEffect } from 'react';
import { COUNTRY } from '../utils/countries';

const ALL_COUNTRIES = Object.entries(COUNTRY)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export default function CountryFilter({ value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = search.trim()
    ? ALL_COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.toLowerCase().includes(search.toLowerCase())
      )
    : ALL_COUNTRIES;

  const toggle = (code) => {
    const next = value.includes(code) ? value.filter(c => c !== code) : [...value, code];
    onChange(next);
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition shadow-sm ${
          value.length > 0
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
            : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9h10M7 15h10M9 5c-1.5 2.3-2 5-2 7s.5 4.7 2 7M15 5c1.5 2.3 2 5 2 7s-.5 4.7-2 7" />
        </svg>
        GEO
        {value.length > 0 && (
          <>
            <span className="text-blue-600 dark:text-blue-300">
              {value.map(c => c.toUpperCase().slice(0, 2)).join(', ')}
            </span>
            <button onClick={clear} className="ml-0.5 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200">×</button>
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search countries…"
              className="w-full text-sm px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 outline-none border border-gray-200 dark:border-gray-600 placeholder:text-gray-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.map(c => (
              <label
                key={c.code}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-700 dark:text-gray-200"
              >
                <input
                  type="checkbox"
                  checked={value.includes(c.code)}
                  onChange={() => toggle(c.code)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-gray-400 dark:text-gray-500 w-8 text-xs uppercase">{c.code}</span>
                <span className="truncate">{c.name}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">No countries found</div>
            )}
          </div>
          {value.length > 0 && (
            <div className="p-2 border-t border-gray-100 dark:border-gray-700">
              <button onClick={clear} className="w-full text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                Clear all ({value.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
