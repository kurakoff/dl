import { useState } from 'react';
import api from '../api/client';

const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordModal({ email, onClose }) {
  const [step, setStep] = useState('send');   // 'send' → 'verify' → 'done'
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const errText = (err, fallback) => err?.response?.data?.error || fallback;

  const sendCode = async () => {
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/email/change-password/send-code');
      setStep('verify');
    } catch (err) {
      setError(errText(err, 'Failed to send verification email'));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/email/change-password/verify', { code, newPassword });
      setStep('done');
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(errText(err, 'Failed to change password'));
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-900 bg-white dark:bg-gray-700 dark:text-gray-100';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !loading && onClose()} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Change password</h3>

        {error && (
          <div className="mb-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {step === 'done' && (
          <div className="text-sm text-green-600 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
            Password changed successfully.
          </div>
        )}

        {step === 'send' && (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              We'll email a confirmation code to <span className="font-medium text-gray-700 dark:text-gray-200">{email}</span>.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={sendCode}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
              >
                {loading ? 'Sending…' : 'Send code'}
              </button>
            </div>
          </>
        )}

        {step === 'verify' && (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Code sent to <span className="font-medium text-gray-700 dark:text-gray-200">{email}</span>.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code from email"
              value={code}
              onChange={e => setCode(e.target.value)}
              className={inputCls}
              required
            />
            <input
              type="password"
              placeholder={`New password (min ${MIN_PASSWORD_LENGTH})`}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className={inputCls}
              required
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className={inputCls}
              required
            />
            <div className="flex gap-2 justify-between items-center pt-1">
              <button
                type="button"
                onClick={sendCode}
                disabled={loading}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition"
              >
                Resend code
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition"
                >
                  {loading ? 'Saving…' : 'Change password'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
