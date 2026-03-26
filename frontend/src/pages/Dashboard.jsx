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
  const [siteSearch,        setSiteSearch]        = useState('');
  const [metricFilters,     setMetricFilters]     = useState([]);
  const [trendFilter,       setTrendFilter]       = useState({ trends: [], metric: 'clicks' });
  const [detailSite,        setDetailSite]        = useState(null);
  const [sidebarCollapsed,  setSidebarCollapsed]  = useState(false);
  const [granularity,       setGranularity]       = useState('day');
  const [inviteUrl,         setInviteUrl]         = useState('');
  const [inviteCopied,      setInviteCopied]      = useState(false);

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
  useEffect(() => {
    api.post('/auth/invite-token').then(r => setInviteUrl(r.data.url)).catch(() => {});
  }, []);
  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  // ── Dashboard CRUD ────────────────────────────────────────────────────────
  const openCreateForm = () => {
    setFormMode('create'); setFormName('');
    setEditingId(null); setShowForm(true);
    setSidebarCollapsed(false);
  };

  const openEditForm = (d) => {
    setFormMode('edit'); setFormName(d.name);
    setEditingId(d.id); setShowForm(true);
  };

  const handleSaveDashboard = async () => {
    if (!formName.trim()) return;
    try {
      if (formMode === 'create') {
        const res = await api.post('/api/dashboards', { name: formName.trim(), sites: [] });
        setDashboards(prev => [...prev, res.data]);
        setActiveDashboardId(res.data.id);
      } else {
        const db = dashboards.find(d => d.id === editingId);
        const res = await api.put(`/api/dashboards/${editingId}`, { name: formName.trim(), sites: db?.sites || [] });
        setDashboards(prev => prev.map(d => d.id === editingId ? res.data : d));
      }
      setShowForm(false);
    } catch { showToast('Error saving dashboard'); }
  };

  // Batch add/remove all sites of an account to/from the active dashboard
  const handleDashboardBatchToggle = useCallback(async (connectedAccountId, siteUrls, shouldBeIn) => {
    if (!activeDashboardId) return;
    const db = dashboards.find(d => d.id === activeDashboardId);
    if (!db) return;
    let newSites = [...db.sites];
    for (const siteUrl of siteUrls) {
      const key = `${connectedAccountId}:${siteUrl}`;
      const isIn = newSites.some(s => `${s.connected_account_id}:${s.site_url}` === key);
      if (shouldBeIn && !isIn)  newSites.push({ connected_account_id: connectedAccountId, site_url: siteUrl });
      if (!shouldBeIn && isIn)  newSites = newSites.filter(s => `${s.connected_account_id}:${s.site_url}` !== key);
    }
    try {
      const res = await api.put(`/api/dashboards/${activeDashboardId}`, { name: db.name, sites: newSites });
      setDashboards(prev => prev.map(d => d.id === activeDashboardId ? res.data : d));
      fetchAnalytics();
    } catch { showToast('Error updating dashboard'); }
  }, [activeDashboardId, dashboards, fetchAnalytics]);

  // Toggle a site in/out of the active dashboard (called from SiteSelector)
  const handleDashboardSiteToggle = useCallback(async (connectedAccountId, siteUrl) => {
    if (!activeDashboardId) return;
    const db = dashboards.find(d => d.id === activeDashboardId);
    if (!db) return;
    const key = `${connectedAccountId}:${siteUrl}`;
    const isIn = db.sites.some(s => `${s.connected_account_id}:${s.site_url}` === key);
    const newSites = isIn
      ? db.sites.filter(s => `${s.connected_account_id}:${s.site_url}` !== key)
      : [...db.sites, { connected_account_id: connectedAccountId, site_url: siteUrl }];
    try {
      const res = await api.put(`/api/dashboards/${activeDashboardId}`, { name: db.name, sites: newSites });
      setDashboards(prev => prev.map(d => d.id === activeDashboardId ? res.data : d));
      fetchAnalytics();
    } catch { showToast('Error updating dashboard'); }
  }, [activeDashboardId, dashboards, fetchAnalytics]);

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
    setTimeout(() => {
      fetchAccounts();
      fetchAnalytics();
    }, 300);
  }, [fetchAccounts, fetchAnalytics]);

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
          db.sites.some(s => String(s.connected_account_id) === String(a.accountId) && s.site_url === a.siteUrl)
        );
      })()
    : analytics.filter(a => {
        const acc = accounts.find(ac => String(ac.id) === String(a.accountId));
        return acc?.selected_sites?.includes(a.siteUrl) ?? false;
      });

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
      <aside className={`${sidebarCollapsed ? 'w-14' : 'w-72'} bg-white border-r border-gray-200 flex flex-col overflow-hidden flex-shrink-0 transition-all duration-200`}>

        {/* ── Logo + collapse toggle ─────────────────────────────────────── */}
        <div className={`flex items-center border-b border-gray-100 flex-shrink-0 ${sidebarCollapsed ? 'justify-center py-3.5 px-0' : 'gap-2 px-4 py-3.5 justify-between'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            {!sidebarCollapsed && <span className="font-semibold text-gray-800 truncate">SEO Dashboard</span>}
          </div>
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className={`text-gray-300 hover:text-gray-600 transition flex-shrink-0 ${sidebarCollapsed ? 'mt-1' : ''}`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={sidebarCollapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
            </svg>
          </button>
        </div>

        {sidebarCollapsed ? (
          /* ── Collapsed mode ────────────────────────────────────────────── */
          <>
            <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1 px-1.5">
              {/* User avatar */}
              {user && (
                <div title={user.email} className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 mb-1">
                  {user.picture
                    ? <img src={user.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    : <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-600">{user.email[0].toUpperCase()}</div>
                  }
                </div>
              )}
              <div className="w-6 h-px bg-gray-100" />
              {/* All sites */}
              <button onClick={() => setActiveDashboardId(null)} title="All sites"
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${!activeDashboardId ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-50'}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </button>
              {/* Dashboard buttons */}
              {dashboards.map(d => (
                <button key={d.id} onClick={() => { setActiveDashboardId(d.id); setShowForm(false); }} title={d.name}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition ${activeDashboardId === d.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {d.name.slice(0, 2).toUpperCase()}
                </button>
              ))}
              {/* Add dashboard */}
              <button onClick={openCreateForm} title="New dashboard"
                className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-50 transition text-xl font-light"
              >+</button>
              <div className="w-6 h-px bg-gray-100 my-0.5" />
              {/* Account avatars */}
              {accounts.map(acc => (
                <div key={acc.id} title={acc.email} className="w-9 h-9 rounded-full flex-shrink-0 overflow-hidden">
                  {acc.picture
                    ? <img src={acc.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    : <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-600">{acc.email[0].toUpperCase()}</div>
                  }
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 py-2 flex justify-center">
              <button onClick={handleLogout} title="Logout" className="p-2 text-gray-300 hover:text-red-400 transition">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          /* ── Expanded mode ─────────────────────────────────────────────── */
          <>
            {/* User info */}
            {user && (
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 flex-shrink-0">
                {user.picture
                  ? <img src={user.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                  : <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-600">{user.email[0].toUpperCase()}</div>
                }
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

              {/* ── Invite Link ───────────────────────────────────────── */}
              {inviteUrl && (
                <div className="px-4 pt-3 pb-2 border-b border-gray-100">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Invite Link</h2>
                  <div className="flex gap-1">
                    <input
                      readOnly
                      value={inviteUrl}
                      className="flex-1 min-w-0 text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 outline-none"
                      onFocus={e => e.target.select()}
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(inviteUrl);
                        setInviteCopied(true);
                        setTimeout(() => setInviteCopied(false), 2000);
                      }}
                      className="px-2 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex-shrink-0"
                    >
                      {inviteCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-300 mt-1.5">Share to connect a Google account to your profile.</p>
                </div>
              )}

              {/* ── Dashboards ────────────────────────────────────────── */}
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dashboards</h2>
                  {!showForm && (
                    <button onClick={openCreateForm} className="text-gray-400 hover:text-blue-500 transition p-0.5" title="New dashboard">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* All sites */}
                <button
                  onClick={() => { setActiveDashboardId(null); setShowForm(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm mb-1 transition ${!activeDashboardId ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  All sites
                </button>

                {/* Dashboard list */}
                {dashboards.map(d => (
                  <div key={d.id} className="flex items-center gap-0.5 group mb-0.5">
                    <button
                      onClick={() => { setActiveDashboardId(d.id); setShowForm(false); }}
                      className={`flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition min-w-0 text-left ${activeDashboardId === d.id ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      <span className="truncate flex-1">{d.name}</span>
                      <span className="text-xs opacity-40 flex-shrink-0 ml-2">{d.sites.length}</span>
                    </button>
                    <button onClick={() => openEditForm(d)} title="Rename"
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-gray-500 transition flex-shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDeleteDashboard(d.id)} title="Delete"
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-400 transition flex-shrink-0">
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
                      {formMode === 'create' ? 'New dashboard' : 'Rename dashboard'}
                    </p>
                    <input
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSaveDashboard()}
                      placeholder="Name…"
                      autoFocus
                      className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 mb-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleSaveDashboard} disabled={!formName.trim()}
                        className="flex-1 text-xs bg-blue-600 text-white rounded-lg py-1.5 font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                        {formMode === 'create' ? 'Create' : 'Save'}
                      </button>
                      <button onClick={() => setShowForm(false)}
                        className="flex-1 text-xs border border-gray-200 text-gray-600 rounded-lg py-1.5 hover:bg-gray-100 transition">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Connected Accounts ────────────────────────────────── */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Connected Accounts</h2>
                  <span className="text-xs text-gray-400">{accounts.length}</span>
                </div>
                <button onClick={handleAddAccount}
                  className="w-full flex items-center justify-center gap-2 mb-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition">
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
                    activeDashboard={activeDashboardId ? dashboards.find(d => d.id === activeDashboardId) : null}
                    onDashboardSiteToggle={handleDashboardSiteToggle}
                    onDashboardBatchToggle={handleDashboardBatchToggle}
                  />
                ))}
              </div>
            </div>
          </>
        )}
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

          {/* Granularity picker */}
          <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {[['D','day'],['W','week'],['M','month']].map(([label, val]) => (
              <button
                key={val}
                onClick={() => setGranularity(val)}
                className={`px-3 py-2 text-sm font-medium transition ${
                  granularity === val
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

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
                granularity={granularity}
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
