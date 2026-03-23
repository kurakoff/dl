import { useEffect, useState } from 'react';
import api from '../api/client';

function shortUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

export default function SiteSelector({ accountId, initialSelected, onSelectionChange }) {
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

  const filtered = sites.filter(s =>
    shortUrl(s.url).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {sites.length > 4 && (
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
      {filtered.map(site => (
        <li key={site.url}>
          <label className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer group">
            <input
              type="checkbox"
              checked={selected.has(site.url)}
              onChange={() => toggle(site.url)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 cursor-pointer"
            />
            <span className="text-sm text-gray-700 truncate flex-1" title={site.url}>
              {shortUrl(site.url)}
            </span>
            <span className="text-xs text-gray-400 hidden group-hover:inline">
              {site.permissionLevel?.replace('s', '')}
            </span>
          </label>
        </li>
      ))}
    </ul>
    {search && filtered.length === 0 && (
      <p className="px-4 py-2 text-xs text-gray-400">No matches.</p>
    )}
    </div>
  );
}
