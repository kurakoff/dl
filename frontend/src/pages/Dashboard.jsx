import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import TrafficChart, { METRIC_COLOR, METRIC_LABEL, ALL_METRICS } from '../components/TrafficChart';
import DateRangePicker from '../components/DateRangePicker';
import MetricFilter, { applyMetricFilters } from '../components/MetricFilter';
import TrendFilter, { applyTrendFilter } from '../components/TrendFilter';
import QueryFilter from '../components/QueryFilter';
import UserMenu from '../components/UserMenu';
import SettingsModal from '../components/SettingsModal';
import AccountsModal from '../components/AccountsModal';
import SitePickerModal from '../components/SitePickerModal';

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function shortUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').replace('sc-domain:', '');
}

function getGroupKey(dateStr, granularity) {
  const d = new Date(dateStr);
  if (granularity === 'week') {
    const day = d.getDay() || 7;
    const mon = new Date(d);
    mon.setDate(d.getDate() - day + 1);
    return mon.toISOString().slice(0, 10);
  }
  if (granularity === 'month') return dateStr.slice(0, 7);
  return dateStr;
}

function aggregateForExport(rows, granularity) {
  if (!granularity || granularity === 'day') return rows;
  const groups = new Map();
  for (const r of rows) {
    const key = getGroupKey(r.date, granularity);
    if (!groups.has(key)) groups.set(key, { date: key, clicks: 0, impressions: 0, position: 0, _days: 0 });
    const g = groups.get(key);
    g.clicks      += r.clicks      || 0;
    g.impressions += r.impressions || 0;
    g.position    += r.position    || 0;
    g._days       += 1;
  }
  return [...groups.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(g => ({
      date:        g.date,
      clicks:      g.clicks,
      impressions: g.impressions,
      ctr:         g.impressions > 0 ? g.clicks / g.impressions : 0,
      position:    g._days > 0 ? Math.round(g.position / g._days * 10) / 10 : 0,
    }));
}

function makeSheetName(name, used) {
  let base = name.slice(0, 28).replace(/[\\\/\*\?\[\]:]/g, '_');
  if (!used.has(base)) { used.add(base); return base; }
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, 25)}(${i})`;
    if (!used.has(n)) { used.add(n); return n; }
  }
}

export default function Dashboard() {
  const navigate = useNavigate();

  // ── Core state ────────────────────────────────────────────────────────────
  const [user,          setUser]          = useState(null);
  const [accounts,      setAccounts]      = useState([]);
  const [analytics,     setAnalytics]     = useState([]);
  const [startDate,     setStartDate]     = useState(daysAgo(28));
  const [endDate,       setEndDate]       = useState(daysAgo(0));
  const [loadingCharts, setLoadingCharts] = useState(false);
  const [toast,         setToast]         = useState('');
  const [freshness,     setFreshness]     = useState({}); // { siteUrl: lastHourlyTimestamp }

  // ── Dashboard state ───────────────────────────────────────────────────────
  const [dashboards,        setDashboards]        = useState([]);
  const [activeDashboardId, setActiveDashboardId] = useState(null);
  const [showForm,          setShowForm]          = useState(false);
  const [formName,          setFormName]          = useState('');
  const [siteSearch,        setSiteSearch]        = useState('');
  const [metricFilters,     setMetricFilters]     = useState([]);
  const [trendFilter,       setTrendFilter]       = useState({ trends: [], metric: 'clicks' });
  const [queryFilterMatches, setQueryFilterMatches] = useState(null);
  const [sidebarCollapsed,  setSidebarCollapsed]  = useState(false);
  const [granularity,       setGranularity]       = useState('day');
  const [inviteUrl,         setInviteUrl]         = useState('');

  // ── Modal state ─────────────────────────────────────────────────────────
  const [showSettings,   setShowSettings]   = useState(false);
  const [showAccounts,   setShowAccounts]   = useState(false);
  const [showSitePicker, setShowSitePicker] = useState(false);
  const [globalMetrics,  setGlobalMetrics]  = useState(['clicks']);
  const [darkMode,       setDarkMode]       = useState(() => localStorage.getItem('theme') === 'dark');

  // Apply dark class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

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

  const daysDiff = Math.round((new Date(endDate) - new Date(startDate)) / 86_400_000);
  const isHourly = daysDiff <= 1;

  const fetchAnalytics = useCallback(async () => {
    setLoadingCharts(true);
    try {
      const params = { startDate, endDate };
      if (isHourly) params.hourly = 'true';
      const res = await api.get('/api/analytics', { params });
      setAnalytics(res.data.results || []);
    } catch { /* ignore */ }
    finally { setLoadingCharts(false); }
  }, [startDate, endDate, isHourly]);

  useEffect(() => { fetchAccounts(); fetchDashboards(); }, [fetchAccounts, fetchDashboards]);
  useEffect(() => {
    api.post('/auth/invite-token').then(r => setInviteUrl(r.data.url)).catch(() => {});
  }, []);

  // Fetch hourly freshness data once on mount (for "Updated X ago")
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    api.get('/api/analytics', { params: { startDate: yesterday, endDate: today, hourly: 'true' } })
      .then(res => {
        const fresh = {};
        for (const site of res.data.results || []) {
          if (site.data?.length > 0) {
            const sorted = [...site.data].sort((a, b) => b.date.localeCompare(a.date));
            fresh[`${site.accountId}:${site.siteUrl}`] = sorted[0].date;
          }
        }
        setFreshness(fresh);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  // ── Dashboard CRUD ────────────────────────────────────────────────────────
  const openCreateForm = () => {
    setFormName(''); setShowForm(true);
    setSidebarCollapsed(false);
  };

  const openEditDashboard = (d) => {
    setActiveDashboardId(d.id);
    setShowSitePicker(true);
  };

  const handleSaveDashboard = async () => {
    if (!formName.trim()) return;
    try {
      const res = await api.post('/api/dashboards', { name: formName.trim(), sites: [] });
      setDashboards(prev => [...prev, res.data]);
      setActiveDashboardId(res.data.id);
      setShowForm(false);
      // Auto-open site picker so user can immediately add sites
      setTimeout(() => setShowSitePicker(true), 100);
    } catch { showToast('Error saving dashboard'); }
  };

  const handleSitePickerSave = async (dashboardId, name, sites) => {
    try {
      const res = await api.put(`/api/dashboards/${dashboardId}`, { name, sites });
      setDashboards(prev => prev.map(d => d.id === dashboardId ? res.data : d));
      fetchAnalytics();
    } catch { showToast('Error updating dashboard'); }
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

  const handleReconnect = (email) => {
    const token = localStorage.getItem('auth_token');
    window.location.href = `${import.meta.env.VITE_API_URL}/auth/add-account?token=${token}&from=${window.location.origin}&hint=${encodeURIComponent(email)}`;
  };

  const handleDisconnect = async (id) => {
    await api.delete(`/api/accounts/${id}`);
    await fetchAccounts();
    await fetchAnalytics();
    showToast('Account disconnected.');
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    navigate('/', { replace: true });
  };

  // ── Filtered analytics ────────────────────────────────────────────────────
  // "All Sites" (null) = show everything from all accounts, no filter
  // Custom dashboard = filter to dashboard's site list
  const displayedAnalytics = activeDashboardId
    ? (() => {
        const db = dashboards.find(d => d.id === activeDashboardId);
        if (!db) return [];
        return analytics.filter(a =>
          db.sites.some(s => String(s.connected_account_id) === String(a.accountId) && s.site_url === a.siteUrl)
        );
      })()
    : analytics;

  const queryFiltered = queryFilterMatches
    ? displayedAnalytics.filter(a => queryFilterMatches.has(`${a.accountId}:${a.siteUrl}`))
    : displayedAnalytics;

  const searchedAnalytics = applyTrendFilter(
    applyMetricFilters(
      siteSearch
        ? queryFiltered.filter(a => shortUrl(a.siteUrl).toLowerCase().includes(siteSearch.toLowerCase()))
        : queryFiltered,
      metricFilters
    ),
    trendFilter
  );

  const hasSelectedSites = searchedAnalytics.some(s => s.data?.length > 0);
  const sitesWithData = searchedAnalytics.filter(s => s.data?.length > 0);

  // Aggregate totals across all visible sites
  const totals = searchedAnalytics.reduce((acc, site) => {
    for (const row of site.data || []) {
      acc.clicks      += row.clicks      || 0;
      acc.impressions += row.impressions || 0;
      acc.ctr         += row.ctr         || 0;
      acc.position    += row.position    || 0;
      acc._rows++;
    }
    return acc;
  }, { clicks: 0, impressions: 0, ctr: 0, position: 0, _rows: 0 });

  const totalStats = {
    clicks:      totals.clicks.toLocaleString(),
    impressions: totals.impressions.toLocaleString(),
    ctr:         totals._rows > 0 ? `${(totals.ctr / totals._rows).toFixed(2)}%` : '0%',
    position:    totals._rows > 0 ? (totals.position / totals._rows).toFixed(1) : '0',
  };

  // Global metric version — incremented on each global toggle to signal TrafficChart to reset local overrides
  const [globalMetricVer, setGlobalMetricVer] = useState(0);

  const toggleGlobalMetric = (m) => {
    setGlobalMetrics(prev => {
      if (prev.includes(m)) {
        if (prev.length === 1) return prev;
        return prev.filter(x => x !== m);
      }
      return [...prev, m];
    });
    setGlobalMetricVer(v => v + 1);
  };

  const activeDashboard = activeDashboardId ? dashboards.find(d => d.id === activeDashboardId) : null;

  // ── Export ─────────────────────────────────────────────────────────────
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    if (!showExportMenu) return;
    const h = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setShowExportMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showExportMenu]);

  const handleExportExcel = async () => {
    setShowExportMenu(false);
    if (!searchedAnalytics.length) { showToast('No data to export'); return; }

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const usedNames = new Set();

    for (const site of searchedAnalytics) {
      const rows = aggregateForExport(site.data || [], granularity);
      if (!rows.length) continue;

      const sheetData = rows.map(r => ({
        'Date':        r.date,
        'Clicks':      r.clicks,
        'Impressions': r.impressions,
        'CTR':         r.ctr,
        'Position':    r.position,
      }));

      const ws = XLSX.utils.json_to_sheet(sheetData);

      // Column widths
      ws['!cols'] = [
        { wch: 12 }, // Date
        { wch: 10 }, // Clicks
        { wch: 14 }, // Impressions
        { wch: 10 }, // CTR
        { wch: 10 }, // Position
      ];

      // Format CTR as percentage
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let R = range.s.r + 1; R <= range.e.r; R++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: 3 })];
        if (cell) cell.z = '0.00%';
      }

      const name = makeSheetName(shortUrl(site.siteUrl), usedNames);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }

    // Filters sheet
    const filtersData = [
      ['Filter', 'Value'],
      ['Date range', `${startDate} – ${endDate}`],
      ['Granularity', granularity === 'day' ? 'Day' : granularity === 'week' ? 'Week' : 'Month'],
      ['Sites', String(searchedAnalytics.length)],
    ];
    if (activeDashboard) filtersData.push(['Dashboard', activeDashboard.name]);
    if (siteSearch) filtersData.push(['Search filter', siteSearch]);

    const filtersWs = XLSX.utils.aoa_to_sheet(filtersData);
    filtersWs['!cols'] = [{ wch: 16 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, filtersWs, 'Filters');

    XLSX.writeFile(wb, `Performance-on-Search-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('Excel exported');
  };

  const handleExportCsv = () => {
    setShowExportMenu(false);
    if (!searchedAnalytics.length) { showToast('No data to export'); return; }
    const header = 'Site,Account,Date,Clicks,Impressions,CTR,Position';
    const rows = [];
    for (const site of searchedAnalytics) {
      for (const row of (aggregateForExport(site.data || [], granularity))) {
        rows.push([
          `"${shortUrl(site.siteUrl)}"`,
          `"${site.accountEmail}"`,
          row.date,
          row.clicks,
          row.impressions,
          `${(row.ctr * 100).toFixed(2)}%`,  // ctr is decimal (0.07 = 7%)
          row.position,
        ].join(','));
      }
    }
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Performance-on-Search-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">

      {/* ── Sidebar (dashboards only) ─────────────────────────────────────────── */}
      <aside className={`${sidebarCollapsed ? 'w-14' : 'w-64'} bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden flex-shrink-0 transition-all duration-200`}>

        {/* Logo + collapse toggle */}
        <div className={`flex items-center border-b border-gray-100 dark:border-gray-700 flex-shrink-0 ${sidebarCollapsed ? 'justify-center py-3.5 px-0' : 'gap-2 px-4 py-3.5 justify-between'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            {!sidebarCollapsed && <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">SEO Dashboard</span>}
          </div>
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className={`text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 transition flex-shrink-0 ${sidebarCollapsed ? 'mt-1' : ''}`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={sidebarCollapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} />
            </svg>
          </button>
        </div>

        {sidebarCollapsed ? (
          /* ── Collapsed mode ──────────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1 px-1.5">
            {/* All sites */}
            <button onClick={() => setActiveDashboardId(null)} title="All sites"
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${!activeDashboardId ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-300' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
            {/* Dashboard buttons */}
            {dashboards.map(d => (
              <button key={d.id} onClick={() => { setActiveDashboardId(d.id); setShowForm(false); }} title={d.name}
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition ${activeDashboardId === d.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              >
                {d.name.slice(0, 2).toUpperCase()}
              </button>
            ))}
            {/* Add dashboard */}
            <button onClick={openCreateForm} title="New dashboard"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition text-xl font-light"
            >+</button>
          </div>
        ) : (
          /* ── Expanded mode ───────────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Dashboards</h2>
                {!showForm && (
                  <button onClick={openCreateForm} className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition p-0.5" title="New dashboard">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                )}
              </div>

              {/* All sites */}
              <button
                onClick={() => { setActiveDashboardId(null); setShowForm(false); }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm mb-1 transition ${!activeDashboardId ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              >
                <span>All sites</span>
                <span className="text-xs opacity-40">{analytics.length}</span>
              </button>

              {/* Dashboard list */}
              {dashboards.map(d => (
                <div key={d.id} className="flex items-center gap-0.5 group mb-0.5" >
                  <button
                    onClick={() => { setActiveDashboardId(d.id); setShowForm(false); }}
                    className={`flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition min-w-0 text-left ${activeDashboardId === d.id ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                  >
                    <span className="truncate flex-1">{d.name}</span>
                    <span className="text-xs opacity-40 flex-shrink-0 ml-2">{d.sites.length}</span>
                  </button>
                  <button onClick={() => openEditDashboard(d)} title="Edit"
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300 transition flex-shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => handleDeleteDashboard(d.id)} title="Delete"
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 dark:text-gray-500 hover:text-red-400 transition flex-shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Create form */}
              {showForm && (
                <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">New dashboard</p>
                  <input
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveDashboard()}
                    placeholder="Name…"
                    autoFocus
                    className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1.5 mb-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-900 bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveDashboard} disabled={!formName.trim()}
                      className="flex-1 text-xs bg-blue-600 text-white rounded-lg py-1.5 font-medium hover:bg-blue-700 disabled:opacity-40 transition">
                      Create
                    </button>
                    <button onClick={() => setShowForm(false)}
                      className="flex-1 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg py-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 transition">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* ── Header bar ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={(s, e) => { setStartDate(s); setEndDate(e); }}
            />

            {/* Granularity picker (hidden for hourly) */}
            {!isHourly && (
            <div className="flex items-center bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl shadow-sm overflow-hidden">
              {[['D','day'],['W','week'],['M','month']].map(([label, val]) => (
                <button
                  key={val}
                  onClick={() => setGranularity(val)}
                  className={`px-3 py-2 text-sm font-medium transition ${
                    granularity === val
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            )}

            {/* Site search */}
            <div className="flex items-center gap-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 shadow-sm">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                value={siteSearch}
                onChange={e => setSiteSearch(e.target.value)}
                placeholder="Filter sites…"
                className="text-sm text-gray-700 dark:text-gray-200 outline-none bg-transparent w-28 placeholder:text-gray-400"
              />
              {siteSearch && (
                <button onClick={() => setSiteSearch('')} className="text-gray-300 hover:text-gray-500 text-xs">×</button>
              )}
            </div>

            <MetricFilter filters={metricFilters} onChange={setMetricFilters} />
            <TrendFilter value={trendFilter} onChange={setTrendFilter} />
            <QueryFilter startDate={startDate} endDate={endDate} sites={displayedAnalytics} onFilterChange={setQueryFilterMatches} />

            {/* Active dashboard badge */}
            {activeDashboardId && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-300 font-medium">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 7h18M3 12h18M3 17h18" />
                </svg>
                {activeDashboard?.name}
                <button onClick={() => setActiveDashboardId(null)} className="ml-1 hover:text-blue-900">×</button>
              </div>
            )}

          </div>

          {/* UserMenu on the right */}
          <UserMenu
            user={user}
            accountsCount={accounts.length}
            onOpenSettings={() => setShowSettings(true)}
            onOpenAccounts={() => setShowAccounts(true)}
            onLogout={handleLogout}

            darkMode={darkMode}
            onToggleDark={() => setDarkMode(d => !d)}
          />
        </div>

        {/* ── Content area ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 dark:text-gray-200">
          {/* Summary stat cards (non-clickable) */}
          {hasSelectedSites && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              {ALL_METRICS.map(m => (
                <div key={m} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-50">{totalStats[m]}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{METRIC_LABEL[m]}</div>
                </div>
              ))}
            </div>
          )}

          {/* Global metric toggle buttons + sites count */}
          {hasSelectedSites && (
            <div className="flex items-center gap-1.5 mb-4">
              <span className="text-xs text-gray-400 dark:text-gray-500 mr-1.5">Show:</span>
              {ALL_METRICS.map(m => {
                const active = globalMetrics.includes(m);
                const color = METRIC_COLOR[m];
                return (
                  <button
                    key={m}
                    onClick={() => toggleGlobalMetric(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                      active ? 'text-white border-transparent shadow-sm' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                    style={active ? { backgroundColor: color } : {}}
                  >
                    {METRIC_LABEL[m]}
                  </button>
                );
              })}
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{sitesWithData.length} sites</span>
              <div className="relative" ref={exportRef}>
                <button
                  onClick={() => setShowExportMenu(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export
                  <svg className={`w-3 h-3 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 z-50">
                    <button
                      onClick={handleExportExcel}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                    >
                      <span className="w-5 h-5 bg-green-600 rounded text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">X</span>
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={handleExportCsv}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                    >
                      <span className="w-5 h-5 bg-gray-500 rounded text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">csv</span>
                      CSV (.csv)
                    </button>
                  </div>
                )}
              </div>
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
                  granularity={isHourly ? 'hour' : granularity}
                  globalMetrics={globalMetrics}
                  globalMetricVer={globalMetricVer}
                  darkMode={darkMode}
                  freshTimestamp={freshness[`${site.accountId}:${site.siteUrl}`]}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loadingCharts && !hasSelectedSites && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">
                {accounts.length === 0 ? 'No data yet' : activeDashboardId ? 'Dashboard is empty' : 'No data yet'}
              </h3>
              <p className="text-gray-400 dark:text-gray-500 text-sm max-w-xs mb-4">
                {accounts.length === 0
                  ? 'Connect a Google account to get started.'
                  : activeDashboardId
                    ? 'Add sites to this dashboard to see their analytics.'
                    : 'Your connected accounts have no sites with data yet.'}
              </p>
              {accounts.length === 0 ? (
                <button
                  onClick={() => setShowAccounts(true)}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Connect Google Account
                </button>
              ) : activeDashboardId ? (
                <button
                  onClick={() => setShowSitePicker(true)}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Sites
                </button>
              ) : null}
            </div>
          )}
        </div>
      </main>

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}

      {showSettings && (
        <SettingsModal
          inviteUrl={inviteUrl}
          hasPassword={user?.hasPassword}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showAccounts && (
        <AccountsModal
          accounts={accounts}
          onAddAccount={handleAddAccount}
          onDisconnect={handleDisconnect}
          onReconnect={handleReconnect}
          onClose={() => setShowAccounts(false)}
        />
      )}

      {showSitePicker && activeDashboard && (
        <SitePickerModal
          dashboard={activeDashboard}
          accounts={accounts}
          onSave={handleSitePickerSave}
          onClose={() => setShowSitePicker(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

