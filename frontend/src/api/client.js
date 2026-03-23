import axios from 'axios';

// In production VITE_API_URL=https://dl.memoryai.club (direct calls)
// In development use empty string → Vite proxy handles routing to backend
const BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export default api;
