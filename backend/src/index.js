require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const { initDb }       = require('./config/database');
const authRoutes       = require('./routes/auth');
const { router: accountsRouter } = require('./routes/accounts');
const analyticsRoutes  = require('./routes/analytics');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Init DB ──────────────────────────────────────────────────────────────────
initDb();

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, Postman) and whitelisted origins
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',          authRoutes);
app.use('/auth/email',      require('./routes/emailAuth'));
app.use('/api/accounts',   accountsRouter);
app.use('/api/analytics',  analyticsRoutes);
app.use('/api/dashboards', require('./routes/dashboards'));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SEO Dashboard backend running on port ${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`Backend URL:  ${process.env.BACKEND_URL}`);
});

module.exports = app;
