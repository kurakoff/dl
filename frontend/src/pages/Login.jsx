import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL;

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // login | register | register-verify | forgot | forgot-verify | forgot-newpass
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (localStorage.getItem('auth_token')) {
      navigate('/dashboard', { replace: true });
    }
  }, []); // eslint-disable-line

  const resetFields = () => {
    setPassword(''); setConfirmPassword(''); setCode('');
    setNewPassword(''); setConfirmNewPassword(''); setError('');
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
      localStorage.setItem('auth_token', data.token);
      navigate('/dashboard', { replace: true });
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
      localStorage.setItem('auth_token', data.token);
      navigate('/dashboard', { replace: true });
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
      localStorage.setItem('auth_token', data.token);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const subtitle = {
    'login': 'Sign in to your account',
    'register': 'Create your account',
    'register-verify': `We sent a 6-digit code to ${email}`,
    'forgot': 'Enter your email to reset password',
    'forgot-verify': `Enter the code sent to ${email}`,
    'forgot-newpass': 'Set your new password',
  }[mode];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-10 max-w-md w-full text-center">
        {/* Logo */}
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">SEO Dashboard</h1>
        <p className="text-gray-500 text-sm mb-8">{subtitle}</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* LOGIN */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Password" required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="flex justify-between text-sm pt-1">
              <button type="button" onClick={() => { resetFields(); setMode('forgot'); }}
                className="text-gray-400 hover:text-gray-600 transition">
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
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Password (min 8 characters)" required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <input
              type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Confirm password" required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
              {loading ? 'Sending code…' : 'Create account'}
            </button>
            <button type="button" onClick={() => { resetFields(); setMode('login'); }}
              className="w-full text-sm text-gray-400 hover:text-gray-600 transition">
              Already have an account? Sign in
            </button>
          </form>
        )}

        {/* REGISTER VERIFY */}
        {mode === 'register-verify' && (
          <form onSubmit={handleVerifyRegister} className="space-y-3">
            <input
              type="text" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456" maxLength={6} required autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 text-center text-2xl tracking-widest outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button type="submit" disabled={loading || code.length !== 6}
              className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
              {loading ? 'Verifying…' : 'Verify & Sign in'}
            </button>
            <button type="button" onClick={() => { resetFields(); setMode('register'); }}
              className="w-full text-sm text-gray-400 hover:text-gray-600 transition">
              Back
            </button>
          </form>
        )}

        {/* FORGOT PASSWORD */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-3">
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
              {loading ? 'Sending…' : 'Send reset code'}
            </button>
            <button type="button" onClick={() => { resetFields(); setMode('login'); }}
              className="w-full text-sm text-gray-400 hover:text-gray-600 transition">
              Back to sign in
            </button>
          </form>
        )}

        {/* FORGOT VERIFY CODE */}
        {mode === 'forgot-verify' && (
          <form onSubmit={handleVerifyForgotCode} className="space-y-3">
            <input
              type="text" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456" maxLength={6} required autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 text-center text-2xl tracking-widest outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button type="submit" disabled={code.length !== 6}
              className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
              Continue
            </button>
            <button type="button" onClick={() => { resetFields(); setMode('forgot'); }}
              className="w-full text-sm text-gray-400 hover:text-gray-600 transition">
              Back
            </button>
          </form>
        )}

        {/* FORGOT NEW PASSWORD */}
        {mode === 'forgot-newpass' && (
          <form onSubmit={handleResetPassword} className="space-y-3">
            <input
              type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="New password (min 8 characters)" required autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <input
              type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)}
              placeholder="Confirm new password" required
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white rounded-xl px-6 py-3 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
              {loading ? 'Resetting…' : 'Reset password & Sign in'}
            </button>
            <button type="button" onClick={() => { setError(''); setMode('forgot-verify'); }}
              className="w-full text-sm text-gray-400 hover:text-gray-600 transition">
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
