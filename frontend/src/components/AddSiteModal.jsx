import { useState, useRef, useEffect } from 'react';
import api from '../api/client';

export default function AddSiteModal({ accounts, onClose, onSuccess, onReconnect }) {
  const [step, setStep] = useState(1);
  const [accountId, setAccountId] = useState('');
  const [domain, setDomain] = useState('');
  const [token, setToken] = useState('');
  const [cleanDomain, setCleanDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [pendingDomains, setPendingDomains] = useState([]);
  const [verifyingPendingId, setVerifyingPendingId] = useState(null);
  const [method, setMethod] = useState('cloudflare');
  const [cfApiKey, setCfApiKey] = useState('');
  const [cfZoneId, setCfZoneId] = useState('');
  const dropdownRef = useRef(null);

  const selectedAccount = accounts.find(a => String(a.id) === accountId);
  const needsReconnect = selectedAccount && !selectedAccount.has_siteverification_scope;
  const filteredAccounts = accounts.filter(a => a.email.toLowerCase().includes(accountSearch.toLowerCase()));

  // Load pending from API
  useEffect(() => {
    api.get('/api/site-verification/pending').then(r => setPendingDomains(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setAccountDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function refreshPending() {
    api.get('/api/site-verification/pending').then(r => setPendingDomains(r.data)).catch(() => {});
  }

  async function handleGetToken() {
    if (!accountId || !domain.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/api/site-verification/get-token', { accountId: Number(accountId), domain });
      setToken(data.token);
      setCleanDomain(data.domain);
      refreshPending();
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to get DNS token');
    } finally {
      setLoading(false);
    }
  }

  async function handleCloudflareVerify() {
    if (!accountId || !domain.trim() || !cfApiKey.trim() || !cfZoneId.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/api/site-verification/verify-cf', {
        accountId: Number(accountId),
        domain,
        cfApiKey: cfApiKey.trim(),
        cfZoneId: cfZoneId.trim(),
      });
      setResult(data);
      setStep(3);
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Cloudflare verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(overrideAccountId, overrideDomain) {
    const aid = overrideAccountId || Number(accountId);
    const dom = overrideDomain || cleanDomain;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/api/site-verification/verify', { accountId: aid, domain: dom });
      refreshPending();
      setResult(data);
      setStep(3);
      onSuccess?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    } finally {
      setLoading(false);
      setVerifyingPendingId(null);
    }
  }

  async function handleVerifyPending(p) {
    setVerifyingPendingId(p.id);
    setError('');
    setAccountId(String(p.accountId));
    setCleanDomain(p.domain);
    setToken(p.token);
    await handleVerify(p.accountId, p.domain);
  }

  async function handleRemovePending(p) {
    try {
      await api.delete(`/api/site-verification/pending/${p.id}`);
      refreshPending();
    } catch {}
  }

  function handleResumePending(p) {
    setAccountId(String(p.accountId));
    setCleanDomain(p.domain);
    setDomain(p.domain);
    setToken(p.token);
    setStep(2);
  }

  function handleCopy(text) {
    navigator.clipboard.writeText(text || token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Add Site to Google Search Console</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Pending verifications */}
            {pendingDomains.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Pending Verification</label>
                {pendingDomains.map(p => (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.domain}</p>
                      <p className="text-xs text-gray-400 truncate">{p.accountEmail}</p>
                    </div>
                    <button
                      onClick={() => handleResumePending(p)}
                      className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
                      title="Show DNS record"
                    >
                      DNS
                    </button>
                    <button
                      onClick={() => handleVerifyPending(p)}
                      disabled={loading}
                      className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
                    >
                      {verifyingPendingId === p.id ? 'Verifying...' : 'Verify'}
                    </button>
                    <button
                      onClick={() => handleRemovePending(p)}
                      className="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition"
                      title="Remove"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {error && verifyingPendingId !== null && <p className="text-sm text-red-500">{error}</p>}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                  <p className="text-xs text-gray-400 mb-2">Or add a new domain:</p>
                </div>
              </div>
            )}

            <div ref={dropdownRef}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Google Account</label>
              <div className="relative">
                {selectedAccount && !accountDropdownOpen ? (
                  <button
                    type="button"
                    onClick={() => { setAccountDropdownOpen(true); setAccountSearch(''); }}
                    className="w-full flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-left"
                  >
                    {selectedAccount.picture ? (
                      <img src={selectedAccount.picture} alt="" className="w-5 h-5 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-[10px] font-semibold text-blue-600 dark:text-blue-300 flex-shrink-0">
                        {selectedAccount.email[0].toUpperCase()}
                      </div>
                    )}
                    <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{selectedAccount.email}</span>
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                ) : (
                  <input
                    type="text"
                    value={accountSearch}
                    onChange={e => { setAccountSearch(e.target.value); setAccountDropdownOpen(true); }}
                    onFocus={() => setAccountDropdownOpen(true)}
                    placeholder="Search accounts..."
                    autoFocus={accountDropdownOpen}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                )}

                {accountDropdownOpen && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredAccounts.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-400">No accounts found</div>
                    ) : (
                      filteredAccounts.map(a => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setAccountId(String(a.id));
                            setAccountSearch('');
                            setAccountDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition ${String(a.id) === accountId ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                        >
                          {a.picture ? (
                            <img src={a.picture} alt="" className="w-5 h-5 rounded-full flex-shrink-0" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-[10px] font-semibold text-blue-600 dark:text-blue-300 flex-shrink-0">
                              {a.email[0].toUpperCase()}
                            </div>
                          )}
                          <span className="flex-1 text-left truncate text-gray-800 dark:text-gray-200">{a.email}</span>
                          {!a.has_siteverification_scope && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded flex-shrink-0">reconnect</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {needsReconnect && (
                <div className="flex items-center justify-between mt-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <span className="text-xs text-amber-700 dark:text-amber-400">This account needs reconnect for Site Verification</span>
                  <button
                    onClick={() => onReconnect(selectedAccount.email)}
                    className="ml-2 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition"
                  >
                    Reconnect
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Domain</label>
              <input
                type="text"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                placeholder="example.com"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                onKeyDown={e => e.key === 'Enter' && (method === 'cloudflare' ? handleCloudflareVerify() : handleGetToken())}
              />
              <p className="text-xs text-gray-400 mt-1">Enter domain without protocol (e.g. example.com)</p>
            </div>

            {/* Method toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Verification Method</label>
              <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setMethod('cloudflare')}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition ${method === 'cloudflare' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Cloudflare API
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('manual')}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition ${method === 'manual' ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                >
                  Manual DNS
                </button>
              </div>
            </div>

            {/* Cloudflare fields */}
            {method === 'cloudflare' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CF API Token</label>
                  <input
                    type="password"
                    value={cfApiKey}
                    onChange={e => setCfApiKey(e.target.value)}
                    placeholder="Cloudflare API token with DNS edit permissions"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Zone ID</label>
                  <input
                    type="text"
                    value={cfZoneId}
                    onChange={e => setCfZoneId(e.target.value)}
                    placeholder="Cloudflare Zone ID"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            {error && verifyingPendingId === null && <p className="text-sm text-red-500">{error}</p>}

            {method === 'cloudflare' ? (
              <button
                onClick={handleCloudflareVerify}
                disabled={loading || !accountId || !domain.trim() || !cfApiKey.trim() || !cfZoneId.trim() || needsReconnect}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading && verifyingPendingId === null ? 'Adding site via Cloudflare...' : 'Add Site'}
              </button>
            ) : (
              <button
                onClick={handleGetToken}
                disabled={loading || !accountId || !domain.trim() || needsReconnect}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading && verifyingPendingId === null ? 'Getting DNS record...' : 'Get DNS Record'}
              </button>
            )}
          </div>
        )}

        {/* Step 2: DNS record + verify */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Add the following TXT record to your DNS for <strong className="text-gray-800 dark:text-gray-200">{cleanDomain}</strong>:
            </p>

            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Type</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">TXT</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Host</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">@</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-500 dark:text-gray-400">Value</span>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5 text-xs break-all text-gray-800 dark:text-gray-200">
                    {token}
                  </code>
                  <button
                    onClick={() => handleCopy()}
                    className="flex-shrink-0 px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              After adding the record, DNS propagation may take a few minutes. Click Verify when ready.
              You can also close this dialog and verify later.
            </p>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep(1); setError(''); }}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                Back
              </button>
              <button
                onClick={() => handleVerify()}
                disabled={loading}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === 3 && (
          <div className="text-center space-y-4">
            {result?.success ? (
              <>
                <div className="w-14 h-14 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg className="w-7 h-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">Site Added!</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    <strong>{result.domain}</strong> has been verified and added to Google Search Console.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <svg className="w-7 h-7 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">Verification Failed</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{error}</p>
                </div>
              </>
            )}

            <button
              onClick={result?.success ? onClose : () => { setStep(2); setError(''); setResult(null); }}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              {result?.success ? 'Close' : 'Try Again'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
