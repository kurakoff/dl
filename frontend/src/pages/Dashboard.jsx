import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import AccountCard from '../components/AccountCard';
import TrafficChart from '../components/TrafficChart';

const METRICS = [
  { value: 'clicks',      label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'ctr',         label: 'CTR' },
  { value: 'position',    label: 'Position' },
];

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export default function Dashboard() {
  const navigate       = useNavigate();
  const [params]       = useSearchParams();

  const [user,         setUser]         = useState(null);
  const [accounts,     setAccounts]     = useState([]);
  const [analytics,    setAnalytics]    = useState([]);
  const [metric,       setMetric]       = useState('clicks');
  const [startDate,    setStartDate]    = useState(daysAgo(28));
  const [endDate,      setEndDate]      = useState(daysAgo(1));
  const [loadingCharts, setLoadingCharts] = useState(false);
  const [toast,        setToast]        = useState('');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ── Handle OAuth redirects ──────────────────────────────────────────────────
  useEffect(() => {
    const token = params.get('token');
    if (token) {
      localStorage.setItem('auth_token', token);
      navigate('/dashboard', { replace: true });
    }
    if (params.get('account_added') === 'true') {
      showToast('Account connected successfully!');
      navigate('/dashboard', { replace: true });
    }
    const err = params.get('error');
    if (err) {
      showToast(`Error: ${err}`);
      navigate('/dashboard', { replace: true });
    }
  }, []);                                               // eslint-disable-line

  // ── Load user + accounts ────────────────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    const [userRes, accRes] = await Promise.all([
      api.get('/auth/me'),
      api.get('/api/accounts'),
    ]);
    setUser(userRes.data);
    setAccounts(accRes.data);
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // ── Load analytics whenever accounts/dates change ──────────────────────────
  const fetchAnalytics = useCallback(async () => {
    setLoadingCharts(true);
    try {
      const res = await api.get('/api/analytics', { params: { startDate, endDate } });
      setAnalytics(res.data.results || []);
    } catch {
      // ignore
    } finally {
      setLoadingCharts(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  // ── Add account ─────────────────────────────────────────────────────────────
  const handleAddAccount = () => {
    const token = localStorage.getItem('auth_token');
    window.location.href = `${import.meta.env.VITE_API_URL}/auth/add-account?token=${token}&from=${window.location.origin}`;
  };

  // ── Disconnect account ───────────────────────────────────────────────────────
  const handleDisconnect = async (id) => {
    await api.delete(`/api/accounts/${id}`);
    await fetchAccounts();
    await fetchAnalytics();
    showToast('Account disconnected.');
  };

  // ── Site selection changed ───────────────────────────────────────────────────
  const handleSelectionChange = useCallback(() => {
    // Re-fetch analytics after a short delay
    setTimeout(fetchAnalytics, 300);
  }, [fetchAnalytics]);

  // ── Logout ───────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    navigate('/', { replace: true });
  };

  // ── Selected sites for chart ─────────────────────────────────────────────────
  const hasSelectedSites = analytics.some(s => s.data?.length > 0);

  // Aggregate totals for summary cards
  const totals = analytics.reduce((acc, site) => {
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
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
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
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            {user.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium">
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

        {/* Connected accounts */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Connected Accounts
            </h2>
            <span className="text-xs text-gray-400">{accounts.length}</span>
          </div>

          {accounts.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No accounts connected yet.</p>
          )}

          {accounts.map(acc => (
            <AccountCard
              key={acc.id}
              account={acc}
              onDisconnect={handleDisconnect}
              onSelectionChange={handleSelectionChange}
            />
          ))}

          <button
            onClick={handleAddAccount}
            className="w-full flex items-center justify-center gap-2 mt-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Google Account
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Date range */}
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={e => setStartDate(e.target.value)}
              className="text-sm text-gray-700 outline-none bg-transparent"
            />
            <span className="text-gray-300">–</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={daysAgo(1)}
              onChange={e => setEndDate(e.target.value)}
              className="text-sm text-gray-700 outline-none bg-transparent"
            />
          </div>

          {/* Quick ranges */}
          {[7, 28, 90].map(d => (
            <button
              key={d}
              onClick={() => { setStartDate(daysAgo(d)); setEndDate(daysAgo(1)); }}
              className="text-xs px-3 py-2 bg-white border border-gray-200 rounded-xl text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition shadow-sm"
            >
              Last {d}d
            </button>
          ))}

        </div>

        {/* Summary cards */}
        {hasSelectedSites && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Clicks"      value={totals.clicks.toLocaleString()}      icon="👆" />
            <StatCard label="Total Impressions" value={totals.impressions.toLocaleString()} icon="👁" />
            <StatCard label="Sites tracked"     value={analytics.filter(s => s.data?.length).length} icon="🌐" />
            <StatCard label="Accounts"          value={accounts.length}                     icon="👤" />
          </div>
        )}

        {/* One chart per site */}
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
            {analytics.map(site => (
              <TrafficChart
                key={site.siteUrl + site.accountId}
                site={site}
              />
            ))}
          </div>
        )}

        {/* Per-site table */}
        {hasSelectedSites && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mt-6">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Sites breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                    <th className="text-left px-6 py-3">Site</th>
                    <th className="text-left px-4 py-3">Account</th>
                    <th className="text-right px-4 py-3">Clicks</th>
                    <th className="text-right px-4 py-3">Impressions</th>
                    <th className="text-right px-4 py-3">CTR</th>
                    <th className="text-right px-6 py-3">Avg. Pos.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {analytics.filter(s => s.data?.length > 0).map(site => {
                    const total = site.data.reduce((a, r) => ({
                      clicks:      a.clicks      + r.clicks,
                      impressions: a.impressions + r.impressions,
                      ctr:         a.ctr         + r.ctr,
                      position:    a.position    + r.position,
                    }), { clicks: 0, impressions: 0, ctr: 0, position: 0 });
                    const n = site.data.length;
                    return (
                      <tr key={site.siteUrl + site.accountId} className="hover:bg-gray-50 transition">
                        <td className="px-6 py-3 font-medium text-gray-800 max-w-xs truncate">
                          {site.siteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{site.accountEmail}</td>
                        <td className="px-4 py-3 text-right">{total.clicks.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">{total.impressions.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">{(total.ctr / n).toFixed(2)}%</td>
                        <td className="px-6 py-3 text-right">{(total.position / n).toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                : 'Expand an account in the sidebar and select sites to track.'}
            </p>
          </div>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}
