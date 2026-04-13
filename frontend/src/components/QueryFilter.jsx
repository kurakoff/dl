import { useState } from 'react';
import api from '../api/client';

export default function QueryFilter({ startDate, endDate, sites, onFilterChange }) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);

  const handleSearch = async () => {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await api.post('/api/analytics/query-filter', {
        keyword: trimmed,
        startDate,
        endDate,
        sites: (sites || []).map(s => ({ accountId: s.accountId, siteUrl: s.siteUrl })),
      });
      const matchSet = new Set(
        (res.data.matches || []).map(m => `${m.accountId}:${m.siteUrl}`)
      );
      onFilterChange(matchSet);
      setActive(true);
    } catch {
      onFilterChange(null);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setKeyword('');
    setActive(false);
    onFilterChange(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="flex items-center gap-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 shadow-sm">
      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
      <input
        value={keyword}
        onChange={e => setKeyword(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Query filter…"
        className="text-sm text-gray-700 dark:text-gray-200 outline-none bg-transparent w-28 placeholder:text-gray-400"
      />
      {loading ? (
        <svg className="animate-spin h-3.5 w-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      ) : active ? (
        <button onClick={handleClear} className="text-gray-300 hover:text-gray-500 text-xs flex-shrink-0">×</button>
      ) : keyword.trim() ? (
        <button
          onClick={handleSearch}
          className="text-xs text-blue-500 hover:text-blue-700 font-medium flex-shrink-0"
        >
          Go
        </button>
      ) : null}
    </div>
  );
}
