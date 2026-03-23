import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import AccountCard from '../components/AccountCard';
import TrafficChart from '../components/TrafficChart';
import DateRangePicker from '../components/DateRangePicker';
import MetricFilter, { applyMetricFilters } from '../components/MetricFilter';
import TrendFilter, { applyTrendFilter } from '../components/TrendFilter';
import SiteDetailModal from '../components/SiteDetailModal';

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function shortUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').replace('sc-domain:', '');
}

export default function Dashboard() {
  const navigate = useNavigate();

  // ── Core state ────────────────────────────────────────────────────────────
  const [user,          setUser]          = useState(null);
  const [accounts,      setAccounts]      = useState([]);
  const [analytics,     setAnalytics]     = useState([]);
  const [startDate,     setStartDate]     = useState(daysAgo(28));
  const [endDate,       setEndDate]       = useState(daysAgo(1));
  const [loadingCharts, setLoadingCharts] = useState(false);
  const [toast,         setToast]         = useState('');

  // ── Dashboard state ───────────────────────────────────────────────────────
  const [dashboards,        setDashboards]        = useState([]);
  const [activeDashboardId, setActiveDashboardId] = useState(null);
  const [showForm,          setShowForm]          = useState(false);
  const [formMode,          setFormMode]          = useState('create');
  const [editingId,         setEditingId]         = useState(null);
  const [formName,          setFormName]          = useState('');
  const [formSites,         setFormSites]         = useState([]);
  const [formSiteSearch,    setFormSiteSearch]    = useState('');
  const [siteSearch,        setSiteSearch]        = useState('');
  const [metricFilters,     setMetricFilters]     = useState([]);
  const [trendFilter,       setTrendFilter]       = useState({ trends: [], metric: 'clicks' });
  const [detailSite,        setDetailSite]        = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Fetch data ────────────────────────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    const [userRes, accRes] = await Promise.all([
      api.get('/auth/me'),
      api.get('/api/accounts'),
    ]);
    setUser(userRes.data);
    setAccounts(accRes.data);
  }, []);

  const fetchDashboards = useCallback(async () => {
    const res = await api.get('/api/dashboards');
    setDashboards(res.data);
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setLoadingCharts(true);
    try {
      const res = await api.get('/api/analytics', { params: { startDate, endDate } });
      setAnalytics(res.data.results || []);
    } catch { /* ignore */ }
    finally { setLoadingCharts(false); }
  }, [startDate, endDate]);

  useEffect(() => { fetchAccounts(); fetchDashboards(); }, [fetchAccounts, fetchDashboards]);
  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  // ── Dashboard CRUD ────────────────────────────────────────────────────────
  const allSelectableSites = accounts.flatMap(acc =>
    (acc.selected_sites || []).map(url => ({
      siteUrl: url,
      connectedAccountId: acc.id,
      accountEmail: acc.email,
    }))
  );

  const openCreateForm = () => {
    setFormMode('create'); setFormName(''); setFormSites([]);
    setEditingId(null); setShowForm(true); setFormSiteSearch('');
  };

  const openEditForm = (d) => {
    setFormMode('edit'); setFormName(d.name);
    setFormSites(d.sites); setEditingId(d.id); setShowForm(true); setFormSiteSearch('');
  };

  const toggleFormSite = (connectedAccountId, siteUrl) => {
    const key = `${connectedAccountId}:${siteUrl}`;
    setFormSites(prev => {
      const exists = prev.some(s => `${s.connected_account_id}:${s.site_url}` === key);
      return exists
        ? prev.filter(s => `${s.connected_account_id}:${s.site_url}` !== key)
        : [...prev, { connected_account_id: connectedAccountId, site_url: siteUrl }];
    });
  };

  const handleSaveDashboard = async () => {
    if (!formName.trim()) return;
    const body = { name: formName.trim(), sites: formSites };
    try {
      if (formMode === 'create') {
        const res = await api.post('/api/dashboards', body);
        setDashboards(prev => [...prev, res.data]);
        setActiveDashboardId(res.data.id);
      } else {
        const res = await api.put(`/api/dashboards/${editingId}`, body);
        setDashboards(prev => prev.map(d => d.id === editingId ? res.data : d));
      }
      setShowForm(false);
    } catch { showToast('Error saving dashboard'); }
  };

  const handleDeleteDashboard = async (id) => {
    await api.delete(`/api/dashboards/${id}`);
    setDashboards(prev => prev.filter(d => d.id !== id));
    if (activeDashboardId === id) setActiveDashboardId(null);
  };

  // ── Accounts ──────────────────────────────────────────────────────────────
  const handleAddAccount = () => {
    const token = localStorage.getItem('auth_token');
    window.location.href = `${import.meta.env.VITE_API_URL}/auth/add-account?token=${token}&from=${window.location.origin}`;
  };

  const handleDisconnect = async (id) => {
    await api.delete(`/api/accounts/${id}`);
    await fetchAccounts();
    await fetchAnalytics();
    showToast('Account disconnected.');
  };

  const handleSelectionChange = useCallback(() => {
    setTimeout(fetchAnalytics, 300);
  }, [fetchAnalytics]);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    navigate('/', { replace: true });
  };

  // ── Filtered analytics ────────────────────────────────────────────────────
  const displayedAnalytics = activeDashboardId
    ? (() => {
        const db = dashboards.find(d => d.id === activeDashboardId);
        if (!db) return analytics;
        return analytics.filter(a =>
          db.sites.some(s => s.connected_account_id === a.accountId && s.site_url === a.siteUrl)
        );
      })()
    : analytics;

  const searchedAnalytics = applyTrendFilter(
    applyMetricFilters(
      siteSearch
        ? displayedAnalytics.filter(a => shortUrl(a.siteUrl).toLowerCase().includes(siteSearch.toLowerCase()))
        : displayedAnalytics,
      metricFilters
    ),
    trendFilter
  );

  const hasSelectedSites = searchedAnalytics.some(s => s.data?.length > 0);
  const totals = searchedAnalytics.reduce((acc, site) => {
    for (const row of site.data || []) {
      acc.clicks      += row.clicks      || 0;
      acc.impressions += row.impressions || 0;
    }
    return acc;
  }, { clicks: 0, impressions: 0 });

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-72 bg-white border-r border-gray-200 flex flex-col overflow-hidden">

        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-800">SEO Dashboard</span>
        </div>

        {/* User info */}
        {user && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0">
            {user.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-600">
                {user.email[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{user.name || user.email}</p>
              <p className="text-xs text-gray-400 truncate">{user.email}</p>
            </div>
            <button onClick={handleLogout} className="text-gray-300 hover:text-red-400 transition p-1" title="Logout">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}

        {/* Scrollable area */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Dashboards ──────────────────────────────────────────────── */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dashboards</h2>
              {!showForm && (
                <button
                  onClick={openCreateForm}
                  className="text-gray-400 hover:text-blue-500 transition p-0.5"
                  title="New dashboard"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              )}
            </div>

            {/* All */}
            <button
              onClick={() => { setActiveDashboardId(null); setShowForm(false); }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm mb-1 transition ${
                !activeDashboardId ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              All sites
            </button>

            {/* Dashboard list */}
            {dashboards.map(d => (
              <div key={d.id} className="flex items-center gap-0.5 group mb-0.5">
                <button
                  onClick={() => { setActiveDashboardId(d.id); setShowForm(false); }}
                  className={`flex-1 text-left px-2.5 py-1.5 rounded-lg text-sm truncate transition ${
                    activeDashboardId === d.id ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {d.name}
                  <span className="ml-1 text-xs opacity-50">{d.sites.length}</span>
                </button>
                <button
                  onClick={() => openEditForm(d)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-gray-500 transition flex-shrink-0"
                  title="Edit"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDeleteDashboard(d.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-400 transition flex-shrink-0"
                  title="Delete"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Create / Edit form */}
            {showForm && (
              <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-xs font-semibold text-gray-500 mb-2">
                  {formMode === 'create' ? 'New dashboard' : 'Edit dashboard'}
                </p>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveDashboard()}
                  placeholder="Name..."
                  autoFocus
                  className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 mb-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                />

                {allSelectableSites.length > 0 ? (
                  <div className="mb-2">
                    <input
                      value={formSiteSearch}
                      onChange={e => setFormSiteSearch(e.target.value)}
                      placeholder="Search sites…"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 mb-1.5 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                    />
                  {allSelectableSites.filter(s =>
                    shortUrl(s.siteUrl).toLowerCase().includes(formSiteSearch.toLowerCase())
                  ).length === 0 && formSiteSearch && (
                    <p className="text-xs text-gray-400 py-1">No sites found.</p>
                  )}
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {allSelectableSites.filter(s =>
                      shortUrl(s.siteUrl).toLowerCase().includes(formSiteSearch.toLowerCase())
                    ).map(site => {
                      const key = `${site.connectedAccountId}:${site.siteUrl}`;
                      const checked = formSites.some(
                        s => `${s.connected_account_id}:${s.site_url}` === key
                      );
                      return (
                        <label key={key} className="flex items-center gap-2 cursor-pointer py-0.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFormSite(site.connectedAccountId, site.siteUrl)}
                            className="accent-blue-600 flex-shrink-0"
                          />
                          <span className="text-xs text-gray-600 truncate" title={site.siteUrl}>
                            {shortUrl(site.siteUrl)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mb-2 leading-snug">
                    Select sites from accounts below first.
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleSaveDashboard}
                    disabled={!formName.trim()}
                    className="flex-1 text-xs bg-blue-600 text-white rounded-lg py-1.5 font-medium hover:bg-blue-700 disabled:opacity-40 transition"
                  >
                    {formMode === 'create' ? 'Create' : 'Save'}
                  </button>
                  <button
                    onClick={() => setShowForm(false)}
                    className="flex-1 text-xs border border-gray-200 text-gray-600 rounded-lg py-1.5 hover:bg-gray-100 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Connected Accounts ──────────────────────────────────────── */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Connected Accounts</h2>
              <span className="text-xs text-gray-400">{accounts.length}</span>
            </div>

            <button
              onClick={handleAddAccount}
              className="w-full flex items-center justify-center gap-2 mb-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Google Account
            </button>

            {accounts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">No accounts connected yet.</p>
            )}

            {accounts.map(acc => (
              <AccountCard
                key={acc.id}
                account={acc}
                onDisconnect={handleDisconnect}
                onSelectionChange={handleSelectionChange}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
          />

          {/* Site search */}
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              value={siteSearch}
              onChange={e => setSiteSearch(e.target.value)}
              placeholder="Filter sites…"
              className="text-sm text-gray-700 outline-none bg-transparent w-28"
            />
            {siteSearch && (
              <button onClick={() => setSiteSearch('')} className="text-gray-300 hover:text-gray-500 text-xs">×</button>
            )}
          </div>

          <MetricFilter filters={metricFilters} onChange={setMetricFilters} />
          <TrendFilter value={trendFilter} onChange={setTrendFilter} />

          {/* Active dashboard badge */}
          {activeDashboardId && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 font-medium">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 7h18M3 12h18M3 17h18" />
              </svg>
              {dashboards.find(d => d.id === activeDashboardId)?.name}
              <button onClick={() => setActiveDashboardId(null)} className="ml-1 hover:text-blue-900">×</button>
            </div>
          )}
        </div>

        {/* Summary cards */}
        {hasSelectedSites && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Clicks"      value={totals.clicks.toLocaleString()} />
            <StatCard label="Total Impressions" value={totals.impressions.toLocaleString()} />
            <StatCard label="Sites tracked"     value={searchedAnalytics.filter(s => s.data?.length).length} />
            <StatCard label="Accounts"          value={accounts.length} />
          </div>
        )}

        {/* Charts */}
        {loadingCharts ? (
          <div className="flex items-center justify-center h-48 gap-2 text-gray-400">
            <svg className="animate-spin h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            Loading data…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {searchedAnalytics.map(site => (
              <TrafficChart
                key={site.siteUrl + site.accountId}
                site={site}
                onDetailClick={setDetailSite}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loadingCharts && !hasSelectedSites && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4 text-3xl">📊</div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No data yet</h3>
            <p className="text-gray-400 text-sm max-w-xs">
              {accounts.length === 0
                ? 'Connect a Google account from the sidebar to get started.'
                : activeDashboardId
                  ? 'No sites in this dashboard. Click the edit icon to add sites.'
                  : 'Expand an account in the sidebar and select sites to track.'}
            </p>
          </div>
        )}
      </main>

      {/* Site detail modal */}
      {detailSite && (
        <SiteDetailModal
          site={detailSite}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setDetailSite(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}
