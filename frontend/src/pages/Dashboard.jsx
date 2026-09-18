import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { addAccount, removeAccount, switchAccount, removeAllAccounts, getOtherAccounts } from '../utils/accountManager';
import TrafficChart, { METRIC_COLOR, METRIC_LABEL, ALL_METRICS } from '../components/TrafficChart';
import DateRangePicker from '../components/DateRangePicker';
import useDateRangeParams from '../utils/useDateRangeParams';
import { loadSeriesProgressive, siteKey } from '../utils/progressiveAnalytics';
import MetricFilter, { applyMetricFilters } from '../components/MetricFilter';
import TrendFilter, { applyTrendFilter } from '../components/TrendFilter';
import QueryFilter from '../components/QueryFilter';
import CountryFilter from '../components/CountryFilter';
import UserMenu from '../components/UserMenu';
import ServicesMenu from '../components/ServicesMenu';
import SettingsModal from '../components/SettingsModal';
import AccountsModal from '../components/AccountsModal';
import SitePickerModal from '../components/SitePickerModal';
import SafetyBanner from '../components/SafetyBanner';
import SafetyAlertModal from '../components/SafetyAlertModal';
import AddSiteModal from '../components/AddSiteModal';
import LoginModal from '../components/LoginModal';
import ConfirmModal from '../components/ConfirmModal';

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
  const [startDate, endDate, setDateRange] = useDateRangeParams(28);
  const [loadingCharts, setLoadingCharts] = useState(false);
  const [analyticsLoadedOnce, setAnalyticsLoadedOnce] = useState(false);
  const analyticsRef = useRef(analytics);
  analyticsRef.current = analytics;
  const [toast,         setToast]         = useState('');
  const [freshness,     setFreshness]     = useState({}); // { siteUrl: lastHourlyTimestamp }
  const [siteNotes,     setSiteNotes]     = useState(new Set()); // "accountId:siteUrl" with notes

  // ── Dashboard state ───────────────────────────────────────────────────────
  const [dashboards,        setDashboards]        = useState([]);
  const [activeDashboardId, setActiveDashboardId] = useState(null);
  const [showForm,          setShowForm]          = useState(false);
  const [formName,          setFormName]          = useState('');
  const [siteSearch,        setSiteSearch]        = useState('');
  const [metricFilters,     setMetricFilters]     = useState([]);
  const [trendFilter,       setTrendFilter]       = useState({ trends: [], metric: 'clicks' });
  const [queryFilterMatches, setQueryFilterMatches] = useState(null);
  const [queryKeyword,       setQueryKeyword]       = useState(null);
  const [geoFilter,          setGeoFilter]          = useState([]);
  const [sidebarCollapsed,  setSidebarCollapsed]  = useState(false);
  const [granularity,       setGranularity]       = useState('day');
  const [inviteUrl,         setInviteUrl]         = useState('');

  // ── Modal state ─────────────────────────────────────────────────────────
  const [showSettings,   setShowSettings]   = useState(false);
  const [showAccounts,   setShowAccounts]   = useState(false);
  const [showSitePicker, setShowSitePicker] = useState(false);
  const [showAddSite,    setShowAddSite]    = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [deleteTarget,   setDeleteTarget]   = useState(null); // dashboard pending deletion
  const [globalMetrics,  setGlobalMetrics]  = useState(['clicks']);
  const [sortBy,         setSortBy]         = useState({ metric: null, dir: 'desc' });
  const [darkMode,       setDarkMode]       = useState(() => localStorage.getItem('theme') === 'dark');

  // ── Safety state ──────────────────────────────────────────────────────────
  const [safetyStatus, setSafetyStatus] = useState({});
  const [safetyChecking, setSafetyChecking] = useState(false);
  const [safetyFilter, setSafetyFilter] = useState('all');
  const [safetyAlertDismissed, setSafetyAlertDismissed] = useState(() =>
    sessionStorage.getItem('safety_alert_dismissed') === 'true'
  );
  const [safetyBannerDismissed, setSafetyBannerDismissed] = useState(() =>
    sessionStorage.getItem('safety_banner_dismissed') === 'true'
  );

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
    const me = userRes.data;
    setUser(me);
    setAccounts(accRes.data);
    // Auto-register current session into multi-account storage
    const token = localStorage.getItem('auth_token');
    if (token && me) {
      addAccount({ userId: me.id, email: me.email, name: me.name, picture: me.picture, token });
    }
    sessionStorage.removeItem('pending_account_register');
  }, []);

  const fetchDashboards = useCallback(async () => {
    const res = await api.get('/api/dashboards');
    setDashboards(res.data);
  }, []);

  const daysDiff = Math.round((new Date(endDate) - new Date(startDate)) / 86_400_000);
  const isHourly = daysDiff <= 1;

  // Only the latest request may update the charts: a slow response for an
  // older range (e.g. 28 days) must not overwrite a newer one (e.g. 24 hours).
  const analyticsRequestId = useRef(0);
  // Sites of the active dashboard load first
  const priorityRef = useRef(null);
  const loadedParamsKey = useRef(null);

  // Batch results are buffered and applied at most every 400 ms: re-rendering
  // thousands of cards for every small batch made the page sluggish.
  const pendingSeries = useRef(new Map());
  const flushTimer = useRef(null);
  const flushSeries = useCallback(() => {
    flushTimer.current = null;
    const updates = pendingSeries.current;
    if (!updates.size) return;
    pendingSeries.current = new Map();
    setAnalytics(prev => prev.map(a => {
      const u = updates.get(siteKey(a));
      return u ? { ...a, ...u } : a;
    }));
  }, []);
  const mergeSeries = useCallback((loaded, failed) => {
    if (!loaded.length && !failed.length) return;
    for (const r of loaded) pendingSeries.current.set(siteKey(r), { data: r.data, loading: false, error: undefined });
    for (const r of failed) pendingSeries.current.set(siteKey(r), { data: [], loading: false, error: r.error });
    if (!flushTimer.current) flushTimer.current = setTimeout(flushSeries, 400);
  }, [flushSeries]);
  useEffect(() => () => clearTimeout(flushTimer.current), []);

  // Details opens the site with the same period (and country) as the dashboard,
  // so switching between sites keeps the filter that is being analysed.
  const detailQuery = useMemo(() => {
    const q = new URLSearchParams({ from: startDate, to: endDate });
    if (geoFilter.length === 1) q.set('country', geoFilter[0]);
    return q.toString();
  }, [startDate, endDate, geoFilter]);

  const analyticsParams = useMemo(() => {
    const params = { startDate, endDate };
    if (isHourly) params.hourly = true;
    if (geoFilter.length) params.countries = geoFilter;
    if (queryKeyword) params.query = queryKeyword;
    return params;
  }, [startDate, endDate, isHourly, geoFilter, queryKeyword]);

  // The site list (one GSC sites.list call per account) only changes when sites
  // or accounts do — changing the date range or filters reuses it.
  const siteListCache = useRef(null);
  const fetchAnalytics = useCallback(async ({ refreshSites = false } = {}) => {
    const requestId = ++analyticsRequestId.current;
    const isLatest = () => requestId === analyticsRequestId.current;

    let sites;
    try {
      if (siteListCache.current && !refreshSites) {
        sites = siteListCache.current;
      } else {
        setLoadingCharts(true);
        const res = await api.get('/api/analytics/sites');
        if (!isLatest()) return;
        sites = res.data.sites || [];
        siteListCache.current = sites;
        if (res.data.errors?.length) {
          showToast(`Failed to load sites for ${res.data.errors.map(e => e.accountEmail).join(', ')}`);
        }
      }
    } catch (err) {
      if (!isLatest()) return;
      // Don't keep showing data for the previous range as if it were current
      setAnalytics([]);
      setLoadingCharts(false);
      showToast(err.response?.data?.error || 'Failed to load analytics');
      return;
    }

    // Same filters as the data already on screen (e.g. a refetch after saving a
    // dashboard): keep what loaded successfully, fetch only the rest.
    const paramsKey = JSON.stringify(analyticsParams);
    const keep = new Map();
    if (loadedParamsKey.current === paramsKey) {
      for (const a of analyticsRef.current) {
        if (!a.loading && !a.error) keep.set(siteKey(a), a);
      }
    }
    loadedParamsKey.current = paramsKey;

    // Render every card right away (loading state), then fill them in
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    pendingSeries.current = new Map();
    setAnalytics(sites.map(s => keep.get(siteKey(s)) || { ...s, data: [], loading: true }));
    setLoadingCharts(false);

    loadSeriesProgressive({
      sites:       sites.filter(s => !keep.has(siteKey(s))),
      params:      analyticsParams,
      onResults:   mergeSeries,
      isCancelled: () => !isLatest(),
      getPriority: () => priorityRef.current,
    }).then(() => {
      if (!isLatest()) return;
      flushSeries();
      setAnalyticsLoadedOnce(true);
    });

    return sites;
  }, [analyticsParams, mergeSeries, flushSeries]);

  // Manual retry for a card whose data failed to load
  const retrySite = useCallback((site) => {
    const requestId = analyticsRequestId.current;
    setAnalytics(prev => prev.map(a =>
      siteKey(a) === siteKey(site) ? { ...a, loading: true, error: undefined } : a
    ));
    loadSeriesProgressive({
      sites:       [site],
      params:      analyticsParams,
      onResults:   mergeSeries,
      isCancelled: () => requestId !== analyticsRequestId.current,
    });
  }, [analyticsParams, mergeSeries]);

  useEffect(() => { fetchAccounts(); fetchDashboards(); }, [fetchAccounts, fetchDashboards]);
  useEffect(() => {
    api.post('/auth/invite-token').then(r => setInviteUrl(r.data.url)).catch(() => {});
  }, []);

  // Re-fetch accounts when the tab regains focus — e.g. after connecting an
  // account via the invite/add-account flow in another tab (which doesn't
  // notify this tab). Keeps the account list in sync without a manual reload.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        fetchAccounts();
        fetchDashboards();
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchAccounts, fetchDashboards]);

  // Fetch which sites have notes (for indicator)
  const fetchNotesList = useCallback(() => {
    api.get('/api/notes/list')
      .then(r => setSiteNotes(new Set(r.data.map(n => `${n.accountId}:${n.siteUrl}`))))
      .catch(() => {});
  }, []);
  useEffect(() => { fetchNotesList(); }, [fetchNotesList]);

  // Fetch hourly freshness data once (for "Updated X ago") — only after the
  // first analytics load finished, so both don't compete for the GSC quota.
  const freshnessRequested = useRef(false);
  useEffect(() => {
    if (!analyticsLoadedOnce || freshnessRequested.current) return;
    freshnessRequested.current = true;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const sites = analyticsRef.current.map(({ accountId, siteUrl }) => ({ accountId, siteUrl }));
    // Buffered like the analytics updates to avoid a re-render per batch
    let fresh = {};
    let timer = null;
    const flush = () => {
      clearTimeout(timer);
      timer = null;
      if (!Object.keys(fresh).length) return;
      const update = fresh;
      fresh = {};
      setFreshness(prev => ({ ...prev, ...update }));
    };
    loadSeriesProgressive({
      sites,
      params:      { startDate: yesterday, endDate: today, hourly: true },
      isCancelled: () => false,
      getPriority: () => priorityRef.current,
      onResults:   (loaded) => {
        for (const site of loaded) {
          if (site.data?.length > 0) {
            const sorted = [...site.data].sort((a, b) => b.date.localeCompare(a.date));
            fresh[siteKey(site)] = sorted[0].date;
          }
        }
        if (!timer) timer = setTimeout(flush, 1000);
      },
    }).then(flush);
  }, [analyticsLoadedOnce]);
  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  // ── Safety: load cached status, then auto-recheck if stale ──────────────
  const runSafetyCheck = useCallback(async (sitesList) => {
    if (!sitesList || sitesList.length === 0) return;
    setSafetyChecking(true);
    try {
      const { data } = await api.post('/api/safety/check', {
        sites: sitesList.map(s => ({ accountId: s.accountId, siteUrl: s.siteUrl })),
      });
      setSafetyStatus(prev => ({ ...prev, ...data }));
    } catch { /* ignore */ }
    finally { setSafetyChecking(false); }
  }, []);

  useEffect(() => {
    // Load cached safety status
    api.get('/api/safety/status')
      .then(r => {
        setSafetyStatus(r.data);
        // Auto-recheck if any entry is older than 6 hours, or if no cache yet
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        const now = Date.now();
        const hasStale = Object.values(r.data).some(v => !v.checkedAt || (now - new Date(v.checkedAt).getTime()) > SIX_HOURS);
        const noCacheYet = Object.keys(r.data).length === 0;
        if (hasStale || noCacheYet) {
          // Wait for analytics to be loaded before checking
          // We'll trigger via the analytics dependency below
        }
      })
      .catch(() => {});
  }, []);

  // Auto-recheck: on load if stale, and whenever new (unchecked) sites appear.
  // Depends on the site list only — not on series data, which arrives in many
  // small updates and would otherwise re-trigger the check each time.
  const safetyAutoChecked = useRef(false);
  const siteListKey = useMemo(() => analytics.map(siteKey).join('\n'), [analytics]);
  useEffect(() => {
    const analytics = analyticsRef.current;
    if (analytics.length === 0) return;
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const now = Date.now();

    // Find sites that have no cached status at all
    const unchecked = analytics.filter(s => !safetyStatus[`${s.accountId}:${s.siteUrl}`]);

    if (unchecked.length > 0) {
      // New sites appeared — check only them
      runSafetyCheck(unchecked);
      return;
    }

    // Initial full check if cache is stale
    if (!safetyAutoChecked.current) {
      const values = Object.values(safetyStatus);
      const hasStale = values.length === 0 || values.some(v => !v.checkedAt || (now - new Date(v.checkedAt).getTime()) > SIX_HOURS);
      if (hasStale) {
        safetyAutoChecked.current = true;
        runSafetyCheck(analytics);
      }
    }
  }, [siteListKey, safetyStatus, runSafetyCheck]);

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
    } catch (err) { showToast(err.response?.data?.error || 'Error saving dashboard'); }
  };

  const handleSitePickerSave = async (dashboardId, name, sites) => {
    try {
      const res = await api.put(`/api/dashboards/${dashboardId}`, { name, sites });
      setDashboards(prev => prev.map(d => d.id === dashboardId ? res.data : d));
      fetchAnalytics();
    } catch { showToast('Error updating dashboard'); }
  };

  const handleDeleteDashboard = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await api.delete(`/api/dashboards/${target.id}`);
      setDashboards(prev => prev.filter(d => d.id !== target.id));
      if (activeDashboardId === target.id) setActiveDashboardId(null);
      showToast(`Dashboard "${target.name}" deleted.`);
    } catch { showToast('Error deleting dashboard'); }
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
    await fetchAnalytics({ refreshSites: true });
    showToast('Account disconnected.');
  };

  const handleLogout = () => {
    if (!user) {
      localStorage.removeItem('auth_token');
      navigate('/', { replace: true });
      return;
    }
    const action = removeAccount(user.id);
    if (action === 'switched') {
      window.location.reload();
    } else {
      navigate('/', { replace: true });
    }
  };

  const handleSwitchAccount = (userId) => {
    switchAccount(userId);
    window.location.reload();
  };

  const handleAddAnotherAccount = () => {
    setShowLoginModal(true);
  };

  const handleLoginModalSuccess = ({ token, user }) => {
    addAccount({ userId: user.id, email: user.email, name: user.name, picture: user.picture, token });
    setShowLoginModal(false);
    window.location.reload();
  };

  const handleLogoutAll = () => {
    removeAllAccounts();
    navigate('/', { replace: true });
  };

  useEffect(() => {
    const db = dashboards.find(d => d.id === activeDashboardId);
    priorityRef.current = db ? new Set(db.sites.map(s => `${s.connected_account_id}:${s.site_url}`)) : null;
  }, [dashboards, activeDashboardId]);

  // ── Filtered analytics ────────────────────────────────────────────────────
  // "All Sites" (null) = show everything from all accounts, no filter
  // Custom dashboard = filter to dashboard's site list
  // Detect duplicate domains across different accounts.
  // Depends on the site list only, so the arrays stay stable while data loads.
  const duplicateDomains = useMemo(() => {
    const analytics = analyticsRef.current;
    const byDomain = new Map(); // normalized domain → sites
    for (const a of analytics) {
      const domain = shortUrl(a.siteUrl);
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(a);
    }
    const dupes = new Map(); // "accountId:siteUrl" → [other account emails]
    for (const group of byDomain.values()) {
      if (new Set(group.map(a => String(a.accountId))).size < 2) continue;
      for (const a of group) {
        const otherEmails = group
          .filter(o => String(o.accountId) !== String(a.accountId))
          .map(o => o.accountEmail);
        dupes.set(`${a.accountId}:${a.siteUrl}`, [...new Set(otherEmails)]);
      }
    }
    return dupes;
  }, [siteListKey]);

  // Filter/sort chain — memoized so unrelated state changes don't redo it
  const { displayedAnalytics, searchedAnalytics } = useMemo(() => {
    const displayedAnalytics = activeDashboardId
      ? (() => {
          const db = dashboards.find(d => d.id === activeDashboardId);
          if (!db) return [];
          return analytics.filter(a =>
            db.sites.some(s => String(s.connected_account_id) === String(a.accountId) && s.site_url === a.siteUrl)
          );
        })()
      : analytics;


    // Deduplicate sc-domain: vs https:// for the same account+domain
    const deduplicatedAnalytics = (() => {
      const seen = new Map(); // "accountId:normalizedDomain" → entry
      for (const a of displayedAnalytics) {
        const key = `${a.accountId}:${shortUrl(a.siteUrl)}`;
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, a);
        } else {
          // Prefer sc-domain: version (covers all subdomains)
          if (a.siteUrl.startsWith('sc-domain:')) seen.set(key, a);
        }
      }
      return [...seen.values()];
    })();

    const queryFiltered = queryFilterMatches
      ? deduplicatedAnalytics.filter(a => queryFilterMatches.has(`${a.accountId}:${a.siteUrl}`))
      : deduplicatedAnalytics;

    const safetyFiltered = safetyFilter === 'threats'
      ? queryFiltered.filter(a => safetyStatus[`${a.accountId}:${a.siteUrl}`]?.status === 'threat')
      : queryFiltered;

    const filteredAnalytics = applyTrendFilter(
      applyMetricFilters(
        siteSearch
          ? safetyFiltered.filter(a => shortUrl(a.siteUrl).toLowerCase().includes(siteSearch.toLowerCase()))
          : safetyFiltered,
        metricFilters
      ),
      trendFilter
    );

    const searchedAnalytics = (() => {
      if (!sortBy.metric) return filteredAnalytics;
      const agg = (site) => {
        const rows = site.data || [];
        if (!rows.length) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
        const s = rows.reduce((a, r) => ({
          clicks: a.clicks + (r.clicks || 0),
          impressions: a.impressions + (r.impressions || 0),
          ctr: a.ctr + (r.ctr || 0),
          position: a.position + (r.position || 0),
        }), { clicks: 0, impressions: 0, ctr: 0, position: 0 });
        s.ctr = s.ctr / rows.length;
        s.position = s.position / rows.length;
        return s;
      };
      return [...filteredAnalytics].sort((a, b) => {
        const va = agg(a)[sortBy.metric];
        const vb = agg(b)[sortBy.metric];
        return sortBy.dir === 'desc' ? vb - va : va - vb;
      });
    })();

    return { displayedAnalytics, searchedAnalytics };
  }, [analytics, activeDashboardId, dashboards, queryFilterMatches, safetyFilter, safetyStatus, siteSearch, metricFilters, trendFilter, sortBy]);

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

  // Safety: threats among displayed sites
  const threatSites = Object.entries(safetyStatus)
    .filter(([, v]) => v.status === 'threat')
    .map(([key, v]) => {
      const [accountId, ...rest] = key.split(':');
      return { accountId, siteUrl: rest.join(':'), threatTypes: v.threatTypes };
    });
  const threatCount = threatSites.length;

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

  const toggleSort = (metric) => {
    setSortBy(prev => {
      if (prev.metric === metric) {
        if (prev.dir === 'desc') return { metric, dir: 'asc' };
        return { metric: null, dir: 'desc' };
      }
      return { metric, dir: 'desc' };
    });
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
    if (searchedAnalytics.some(s => s.loading)) { showToast('Data is still loading — try again in a moment'); return; }

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
                  <button onClick={() => setDeleteTarget(d)} title="Delete"
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
              onChange={(s, e) => setDateRange(s, e)}
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
            <QueryFilter startDate={startDate} endDate={endDate} sites={displayedAnalytics} onFilterChange={setQueryFilterMatches} onKeywordChange={setQueryKeyword} />
            <CountryFilter value={geoFilter} onChange={setGeoFilter} />

            {/* Threats filter toggle */}
            {threatCount > 0 && (
              <button
                onClick={() => setSafetyFilter(f => f === 'threats' ? 'all' : 'threats')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition ${
                  safetyFilter === 'threats'
                    ? 'bg-red-600 text-white border-red-600 shadow-sm'
                    : 'bg-white dark:bg-gray-700 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L3.4 5.6v5.8c0 5.1 3.7 9.8 8.6 11 4.9-1.2 8.6-5.9 8.6-11V5.6L12 2zm1 12h-2v-2h2v2zm0-4h-2V6h2v4z"/>
                </svg>
                Threats ({threatCount})
              </button>
            )}

            {/* Safe Browsing recheck button */}
            <button
              onClick={() => runSafetyCheck(analytics)}
              disabled={safetyChecking}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 transition disabled:opacity-50"
              title="Recheck all sites with Google Safe Browsing"
            >
              <svg className={`w-3.5 h-3.5 ${safetyChecking ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20.618 5.984A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              {safetyChecking ? 'Checking…' : 'Safe Browsing'}
            </button>

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

          {/* Services switcher + UserMenu on the right */}
          <div className="flex items-center gap-1">
          <ServicesMenu />
          <UserMenu
            user={user}
            accountsCount={accounts.length}
            onOpenSettings={() => setShowSettings(true)}
            onOpenAccounts={() => setShowAccounts(true)}
            onAddSite={() => setShowAddSite(true)}
            onLogout={handleLogout}
            otherAccounts={getOtherAccounts()}
            onSwitchAccount={handleSwitchAccount}
            onAddAccount={handleAddAnotherAccount}
            onLogoutAll={handleLogoutAll}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode(d => !d)}
          />
          </div>
        </div>

        {/* ── Safety banner ───────────────────────────────────────────────── */}
        {threatCount > 0 && !safetyBannerDismissed && (
          <SafetyBanner
            threatCount={threatCount}
            onShowThreats={() => { setSafetyFilter('threats'); setSafetyBannerDismissed(true); sessionStorage.setItem('safety_banner_dismissed', 'true'); }}
            onDismiss={() => { setSafetyBannerDismissed(true); sessionStorage.setItem('safety_banner_dismissed', 'true'); }}
          />
        )}

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
              <span className="mx-2 text-gray-200 dark:text-gray-600 select-none">|</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 mr-1.5">Sort:</span>
              {ALL_METRICS.map(m => {
                const active = sortBy.metric === m;
                return (
                  <button
                    key={`sort-${m}`}
                    onClick={() => toggleSort(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                      active
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-500'
                        : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    {METRIC_LABEL[m]}{active && (sortBy.dir === 'desc' ? ' \u2193' : ' \u2191')}
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
                  onRetry={retrySite}
                  detailQuery={detailQuery}
                  hasNote={siteNotes.has(`${site.accountId}:${site.siteUrl}`)}
                  onNoteChange={fetchNotesList}
                  safetyStatus={safetyStatus[`${site.accountId}:${site.siteUrl}`]}
                  duplicateIn={duplicateDomains.get(`${site.accountId}:${site.siteUrl}`)}
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

      {showAddSite && (
        <AddSiteModal
          accounts={accounts}
          onClose={() => setShowAddSite(false)}
          onSuccess={() => { fetchAccounts(); fetchAnalytics({ refreshSites: true }).then(sites => { if (sites) runSafetyCheck(sites); }); }}
          onReconnect={handleReconnect}
        />
      )}

      {/* Safety alert modal — once per session */}
      {threatCount > 0 && !safetyAlertDismissed && (
        <SafetyAlertModal
          threats={threatSites}
          onShowThreats={() => {
            setSafetyFilter('threats');
            setSafetyAlertDismissed(true);
            sessionStorage.setItem('safety_alert_dismissed', 'true');
          }}
          onClose={() => {
            setSafetyAlertDismissed(true);
            sessionStorage.setItem('safety_alert_dismissed', 'true');
          }}
        />
      )}

      {showLoginModal && (
        <LoginModal
          onClose={() => setShowLoginModal(false)}
          onSuccess={handleLoginModalSuccess}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete dashboard?"
          message={`"${deleteTarget.name}" and its ${deleteTarget.sites.length} site${deleteTarget.sites.length === 1 ? '' : 's'} selection will be removed. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDeleteDashboard}
          onClose={() => setDeleteTarget(null)}
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

