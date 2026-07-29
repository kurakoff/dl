import { useState, useRef, useEffect } from 'react';

const SERVICES = [
  { name: 'GSC Dashboard',      url: 'https://gsc.y2a.ru' },
  { name: 'Traffic Checker',    url: 'https://bulk-traffic.y2a.ru/' },
  { name: 'Schematic Detector', url: 'https://schematic-detector.y2a.ru/' },
  { name: 'PBN Maker',          url: 'https://pbn.zavod.guru/' },
  { name: 'Indexing',           url: 'https://indexing-dashboard.y2a.ru/' },
  { name: 'Abuz Detector',      url: 'https://abuz.y2a.ru/' },
  { name: 'YM Reports',         url: 'https://metrika-dashboard.y2a.ru/' },
];

const CURRENT = 'GSC Dashboard';

export default function ServicesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Services"
        className="flex items-center justify-center w-9 h-9 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Services
          </p>
          {SERVICES.map(s => (
            s.name === CURRENT ? (
              <div
                key={s.name}
                className="flex items-center justify-between px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-gray-700"
              >
                {s.name}
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              </div>
            ) : (
              <a
                key={s.name}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                {s.name}
              </a>
            )
          ))}
        </div>
      )}
    </div>
  );
}
