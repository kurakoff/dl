import { useEffect, useState } from 'react';
import api from '../api/client';

function shortUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').replace('sc-domain:', '');
}

export default function SitePickerModal({ dashboard, accounts, onSave, onClose }) {
  const [accountSites, setAccountSites] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(dashboard.name);

  // Build initial selected set from dashboard.sites
  useEffect(() => {
    const initial = new Set(
      (dashboard.sites || []).map(s => `${s.connected_account_id}:${s.site_url}`)
    );
    setSelected(initial);
    setName(dashboard.name);
  }, [dashboard]);

  // Load sites for each account
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all(
      accounts.map(acc =>
        api.get(`/api/accounts/${acc.id}/sites`)
          .then(res => ({ id: acc.id, sites: res.data.sites || [] }))
          .catch(() => ({ id: acc.id, sites: [] }))
      )
    ).then(results => {
      if (cancelled) return;
      const map = {};
      for (const r of results) map[r.id] = r.sites;
      setAccountSites(map);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [accounts]);

  const toggleSite = (accountId, siteUrl) => {
    const key = `${accountId}:${siteUrl}`;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllForAccount = (accountId) => {
    const sites = accountSites[accountId] || [];
    const allKeys = sites.map(s => `${accountId}:${s.url}`);
    const allSelected = allKeys.every(k => selected.has(k));

    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) {
        for (const k of allKeys) next.delete(k);
      } else {
        for (const k of allKeys) next.add(k);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const sites = [...selected].map(key => {
      const [connectedAccountId, ...rest] = key.split(':');
      return { connected_account_id: Number(connectedAccountId), site_url: rest.join(':') };
    });
    await onSave(dashboard.id, name.trim() || dashboard.name, sites);
    setSaving(false);
    onClose();
  };

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Filter accounts that have sites matching search
  const filteredAccounts = accounts.filter(acc => {
    const sites = accountSites[acc.id] || [];
    if (!search) return sites.length > 0;
    return sites.some(s => shortUrl(s.url).toLowerCase().includes(search.toLowerCase()));
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header with editable name */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex-1 min-w-0 mr-3">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Dashboard name..."
              className="text-lg font-semibold text-gray-900 dark:text-gray-100 outline-none w-full bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-400 transition pb-0.5"
            />
            <p className="text-xs text-gray-400 mt-1">{selected.size} site{selected.size !== 1 ? 's' : ''} selected</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sites..."
              className="flex-1 text-sm text-gray-700 dark:text-gray-200 outline-none bg-transparent placeholder:text-gray-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 text-sm">×</button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
              <svg className="animate-spin h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Loading sites...
            </div>
          ) : filteredAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No sites found.</p>
          ) : (
            <div className="space-y-4">
              {filteredAccounts.map(acc => {
                const sites = (accountSites[acc.id] || []).filter(s =>
                  !search || shortUrl(s.url).toLowerCase().includes(search.toLowerCase())
                );
                if (sites.length === 0) return null;

                const allKeys = sites.map(s => `${acc.id}:${s.url}`);
                const allChecked = allKeys.every(k => selected.has(k));
                const someChecked = !allChecked && allKeys.some(k => selected.has(k));

                return (
                  <div key={acc.id}>
                    {/* Account header with Select All */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {acc.picture ? (
                          <img src={acc.picture} alt="" className="w-5 h-5 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-xs font-semibold text-blue-600 dark:text-blue-300 flex-shrink-0">
                            {acc.email[0].toUpperCase()}
                          </div>
                        )}
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">{acc.email}</span>
                      </div>
                      <button
                        onClick={() => toggleAllForAccount(acc.id)}
                        className={`text-xs font-medium px-2 py-0.5 rounded-full transition flex-shrink-0 ${
                          allChecked
                            ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60'
                            : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {allChecked ? 'Deselect all' : someChecked ? 'Select all' : 'Select all'}
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {sites.map(site => {
                        const key = `${acc.id}:${site.url}`;
                        const checked = selected.has(key);
                        return (
                          <label key={site.url} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSite(acc.id, site.url)}
                              className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 cursor-pointer"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-200 truncate" title={site.url}>
                              {shortUrl(site.url)}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
