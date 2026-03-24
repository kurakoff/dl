import { useEffect, useState } from 'react';
import api from '../api/client';

function shortUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

export default function SiteSelector({ accountId, initialSelected, onSelectionChange, activeDashboard, onDashboardSiteToggle, onDashboardBatchToggle }) {
  const [sites,    setSites]    = useState([]);
  const [selected, setSelected] = useState(new Set(initialSelected || []));
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/api/accounts/${accountId}/sites`)
      .then(res => {
        setSites(res.data.sites || []);
        setSelected(new Set(res.data.selectedSites || []));
      })
      .catch(() => setError('Failed to load sites.'))
      .finally(() => setLoading(false));
  }, [accountId]);

  const toggle = async (siteUrl) => {
    try {
      const res = await api.post(`/api/accounts/${accountId}/sites/toggle`, { siteUrl });
      const next = new Set(selected);
      if (res.data.selected) next.add(siteUrl);
      else next.delete(siteUrl);
      setSelected(next);
      onSelectionChange?.(accountId, [...next]);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="py-3 px-4 text-sm text-gray-400 flex items-center gap-2">
        <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        Loading sites…
      </div>
    );
  }

  if (error) {
    return <div className="py-2 px-4 text-sm text-gray-400">No sites available.</div>;
  }

  if (!sites.length) {
    return <div className="py-2 px-4 text-sm text-gray-400">No sites found in Search Console.</div>;
  }

  const isDashboardMode = !!activeDashboard;

  const isInDashboard = (siteUrl) =>
    activeDashboard?.sites.some(
      s => String(s.connected_account_id) === String(accountId) && s.site_url === siteUrl
    ) ?? false;

  const handleToggle = (siteUrl) => {
    if (isDashboardMode) {
      onDashboardSiteToggle?.(accountId, siteUrl);
    } else {
      toggle(siteUrl);
    }
  };

  const allInDashboard = isDashboardMode && sites.length > 0 && sites.every(s => isInDashboard(s.url));
  const allSelected    = !isDashboardMode && sites.length > 0 && sites.every(s => selected.has(s.url));

  const handleBatchToggle = async () => {
    if (isDashboardMode) {
      const allUrls = sites.map(s => s.url);
      onDashboardBatchToggle?.(accountId, allUrls, !allInDashboard);
    } else {
      const allUrls = sites.map(s => s.url);
      const shouldSelect = !allSelected;
      try {
        const res = await api.post(`/api/accounts/${accountId}/sites/batch-select`, { siteUrls: allUrls, selected: shouldSelect });
        const next = new Set(res.data.selectedSites || []);
        setSelected(next);
        onSelectionChange?.(accountId, [...next]);
      } catch { /* ignore */ }
    }
  };

  const filtered = sites.filter(s =>
    shortUrl(s.url).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Dashboard mode banner */}
      {isDashboardMode && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-1.5">
          <svg className="w-3 h-3 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h18" />
          </svg>
          <span className="text-xs text-blue-600 font-medium truncate flex-1">
            {activeDashboard.name}
          </span>
          <button
            onClick={handleBatchToggle}
            className={`text-xs font-medium px-2 py-0.5 rounded-full transition flex-shrink-0 ${
              allInDashboard
                ? 'text-blue-600 bg-blue-100 hover:bg-blue-200'
                : 'text-blue-600 bg-white border border-blue-200 hover:bg-blue-50'
            }`}
          >
            {allInDashboard ? 'Remove all' : 'Add all'}
          </button>
        </div>
      )}

      {/* All sites mode: Add all / Remove all */}
      {!isDashboardMode && (
        <div className="px-4 pt-2 pb-1 flex items-center justify-between gap-2">
          {sites.length > 4 && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sites…"
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            />
          )}
          <button
            onClick={handleBatchToggle}
            className={`text-xs font-medium px-2 py-1 rounded-full transition flex-shrink-0 ${
              allSelected
                ? 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                : 'text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100'
            }`}
          >
            {allSelected ? 'Remove all' : 'Add all'}
          </button>
        </div>
      )}

      {/* Dashboard mode: search only (batch button is in banner) */}
      {isDashboardMode && sites.length > 4 && (
        <div className="px-4 pt-2 pb-1">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sites…"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
          />
        </div>
      )}
      <ul className="py-1">
        {filtered.map(site => {
          const checked = isDashboardMode ? isInDashboard(site.url) : selected.has(site.url);
          return (
            <li key={site.url}>
              <label className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggle(site.url)}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 cursor-pointer"
                />
                <span className="text-sm text-gray-700 truncate flex-1" title={site.url}>
                  {shortUrl(site.url)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {search && filtered.length === 0 && (
        <p className="px-4 py-2 text-xs text-gray-400">No matches.</p>
      )}
    </div>
  );
}
