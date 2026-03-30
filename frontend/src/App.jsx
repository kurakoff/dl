import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SiteDetail from './pages/SiteDetail';

// Сохраняем токен из URL ДО того как PrivateRoute проверит localStorage
function PrivateRoute({ children }) {
  const [params] = useSearchParams();
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem('auth_token', urlToken);
  }
  return localStorage.getItem('auth_token') ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Login />} />
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/site/:accountId/:encodedSiteUrl" element={<PrivateRoute><SiteDetail /></PrivateRoute>} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
