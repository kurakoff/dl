import { useState } from 'react';
import SiteSelector from './SiteSelector';

export default function AccountCard({ account, onDisconnect, onSelectionChange, activeDashboard, onDashboardSiteToggle, onDashboardBatchToggle }) {
  const [expanded,    setExpanded]    = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    if (!confirm(`Disconnect ${account.email}? All selected sites for this account will be removed from the dashboard.`)) return;
    setDisconnecting(true);
    await onDisconnect(account.id);
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-3 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {account.picture ? (
          <img src={account.picture} alt="" className="w-8 h-8 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
            {account.email[0].toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{account.name || account.email}</p>
          <p className="text-xs text-gray-400 truncate">{account.email}</p>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="p-1 text-gray-400 hover:text-gray-700 transition"
          title={expanded ? 'Hide sites' : 'Manage sites'}
        >
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Disconnect */}
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="p-1 text-gray-300 hover:text-red-500 transition"
          title="Disconnect account"
        >
          {disconnecting ? (
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>
      </div>

      {/* Selected sites badge */}
      {!expanded && (() => {
        const count = activeDashboard
          ? activeDashboard.sites.filter(s => String(s.connected_account_id) === String(account.id)).length
          : (account.selected_sites?.length ?? 0);
        if (count === 0) return null;
        return (
          <div className="px-4 pb-3">
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              {count} site{count !== 1 ? 's' : ''} {activeDashboard ? 'in dashboard' : 'selected'}
            </span>
          </div>
        );
      })()}

      {/* Site selector (lazy-loaded when expanded) */}
      {expanded && (
        <div className="border-t border-gray-100">
          <SiteSelector
            accountId={account.id}
            initialSelected={account.selected_sites}
            onSelectionChange={onSelectionChange}
            activeDashboard={activeDashboard}
            onDashboardSiteToggle={onDashboardSiteToggle}
            onDashboardBatchToggle={onDashboardBatchToggle}
          />
        </div>
      )}
    </div>
  );
}
