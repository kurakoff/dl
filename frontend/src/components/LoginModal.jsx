import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL;

export default function LoginModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const resetFields = () => {
    setPassword(''); setConfirmPassword(''); setCode('');
    setNewPassword(''); setConfirmNewPassword(''); setError('');
  };

  const finishSuccess = async (token) => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const user = await res.json();
        onSuccess({ token, user });
      }
    } catch { /* fallback — caller handles */ }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/email/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'NO_PASSWORD') {
          setError('No password set for this email. Please create an account first.');
        } else {
          throw new Error(data.error || 'Login failed');
        }
        return;
      }
      await finishSuccess(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/email/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setMode('register-verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/email/verify-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      await finishSuccess(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/email/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMode('forgot-verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyForgotCode = async (e) => {
    e.preventDefault();
    setError('');
    if (code.length !== 6) { setError('Enter 6-digit code'); return; }
    setMode('forgot-newpass');
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmNewPassword) { setError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/email/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      await finishSuccess(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const subtitle = {
    'login': 'Sign in to add another account',
    'register': 'Create a new account',
    'register-verify': `We sent a 6-digit code to ${email}`,
    'forgot': 'Enter your email to reset password',
    'forgot-verify': `Enter the code sent to ${email}`,
    'forgot-newpass': 'Set your new password',
  }[mode];

  const inputClass = 'w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900 transition placeholder-gray-400 dark:placeholder-gray-500';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Account</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 text-center">{subtitle}</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* LOGIN */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoFocus className={inputClass} />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Password" required className={inputClass} />
              <button type="submit" disabled={loading}
                className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                {loading ? 'Signing in\u2026' : 'Sign in'}
              </button>
              <div className="flex justify-between text-sm pt-1">
                <button type="button" onClick={() => { resetFields(); setMode('forgot'); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                  Forgot password?
                </button>
                <button type="button" onClick={() => { resetFields(); setMode('register'); }}
                  className="text-blue-600 hover:text-blue-700 font-medium transition">
                  Create account
                </button>
              </div>
            </form>
          )}

          {/* REGISTER */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoFocus className={inputClass} />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Password (min 8 characters)" required className={inputClass} />
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm password" required className={inputClass} />
              <button type="submit" disabled={loading}
                className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                {loading ? 'Sending code\u2026' : 'Create account'}
              </button>
              <button type="button" onClick={() => { resetFields(); setMode('login'); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                Already have an account? Sign in
              </button>
            </form>
          )}

          {/* REGISTER VERIFY */}
          {mode === 'register-verify' && (
            <form onSubmit={handleVerifyRegister} className="space-y-3">
              <input type="text" value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456" maxLength={6} required autoFocus
                className={`${inputClass} text-center text-2xl tracking-widest`} />
              <button type="submit" disabled={loading || code.length !== 6}
                className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                {loading ? 'Verifying\u2026' : 'Verify & Sign in'}
              </button>
              <button type="button" onClick={() => { resetFields(); setMode('register'); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                Back
              </button>
            </form>
          )}

          {/* FORGOT PASSWORD */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoFocus className={inputClass} />
              <button type="submit" disabled={loading}
                className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                {loading ? 'Sending\u2026' : 'Send reset code'}
              </button>
              <button type="button" onClick={() => { resetFields(); setMode('login'); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                Back to sign in
              </button>
            </form>
          )}

          {/* FORGOT VERIFY CODE */}
          {mode === 'forgot-verify' && (
            <form onSubmit={handleVerifyForgotCode} className="space-y-3">
              <input type="text" value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456" maxLength={6} required autoFocus
                className={`${inputClass} text-center text-2xl tracking-widest`} />
              <button type="submit" disabled={code.length !== 6}
                className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                Continue
              </button>
              <button type="button" onClick={() => { resetFields(); setMode('forgot'); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                Back
              </button>
            </form>
          )}

          {/* FORGOT NEW PASSWORD */}
          {mode === 'forgot-newpass' && (
            <form onSubmit={handleResetPassword} className="space-y-3">
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="New password (min 8 characters)" required autoFocus className={inputClass} />
              <input type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password" required className={inputClass} />
              <button type="submit" disabled={loading}
                className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                {loading ? 'Resetting\u2026' : 'Reset password & Sign in'}
              </button>
              <button type="button" onClick={() => { setError(''); setMode('forgot-verify'); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                Back
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
