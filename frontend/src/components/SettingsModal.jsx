import { useState, useEffect } from 'react';
import api from '../api/client';

export default function SettingsModal({ inviteUrl, hasPassword, onClose }) {
  const [copied, setCopied] = useState(false);

  // Change password state
  const [pwStep, setPwStep] = useState(0); // 0=button, 1=enter code, 2=new password
  const [pwCode, setPwCode] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendCode = async () => {
    setPwError(''); setPwLoading(true);
    try {
      const res = await api.post('/auth/email/change-password/send-code');
      if (res.data.ok) setPwStep(1);
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to send code');
    } finally {
      setPwLoading(false);
    }
  };

  const handleVerifyAndChange = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pwNew !== pwConfirm) { setPwError('Passwords do not match'); return; }
    if (pwNew.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      const res = await api.post('/auth/email/change-password/verify', {
        code: pwCode, newPassword: pwNew,
      });
      if (res.data.ok) {
        setPwSuccess('Password updated successfully');
        setPwStep(0); setPwCode(''); setPwNew(''); setPwConfirm('');
        setTimeout(() => setPwSuccess(''), 3000);
      }
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Invite Link */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Invite Link</h3>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl || ''}
                className="flex-1 min-w-0 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300 outline-none"
                onFocus={e => e.target.select()}
              />
              <button
                onClick={handleCopy}
                disabled={!inviteUrl}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex-shrink-0 disabled:opacity-40"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Share to connect a Google account to your profile.</p>
          </div>

          {/* Change Password */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {hasPassword ? 'Change Password' : 'Set Password'}
            </h3>

            {pwSuccess && (
              <div className="mb-3 p-2.5 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-sm">
                {pwSuccess}
              </div>
            )}
            {pwError && (
              <div className="mb-3 p-2.5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                {pwError}
              </div>
            )}

            {pwStep === 0 && (
              <button
                onClick={handleSendCode}
                disabled={pwLoading}
                className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition disabled:opacity-50"
              >
                {pwLoading ? 'Sending code…' : hasPassword ? 'Change password' : 'Set password'}
              </button>
            )}

            {pwStep === 1 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">Enter the 6-digit code sent to your email.</p>
                <input
                  type="text" value={pwCode}
                  onChange={e => setPwCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456" maxLength={6} autoFocus
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-center text-lg tracking-widest outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-900 bg-white dark:bg-gray-700 dark:text-gray-100"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (pwCode.length === 6) setPwStep(2); }}
                    disabled={pwCode.length !== 6}
                    className="flex-1 text-sm bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-40 transition"
                  >
                    Continue
                  </button>
                  <button
                    onClick={() => { setPwStep(0); setPwCode(''); setPwError(''); }}
                    className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition px-3"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {pwStep === 2 && (
              <form onSubmit={handleVerifyAndChange} className="space-y-2">
                <input
                  type="password" value={pwNew} onChange={e => setPwNew(e.target.value)}
                  placeholder="New password (min 8 characters)" required autoFocus
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-900 bg-white dark:bg-gray-700 dark:text-gray-100"
                />
                <input
                  type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)}
                  placeholder="Confirm new password" required
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-900 bg-white dark:bg-gray-700 dark:text-gray-100"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={pwLoading}
                    className="flex-1 text-sm bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                    {pwLoading ? 'Saving…' : 'Save password'}
                  </button>
                  <button type="button"
                    onClick={() => { setPwStep(1); setPwNew(''); setPwConfirm(''); setPwError(''); }}
                    className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition px-3">
                    Back
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
