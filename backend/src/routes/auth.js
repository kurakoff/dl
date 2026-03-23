const express = require('express');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// In-memory OAuth state store  { state -> { type, userId, expiresAt } }
const stateStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateStore.entries()) {
    if (v.expiresAt < now) stateStore.delete(k);
  }
}, 5 * 60 * 1000);

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

function makeClient(callbackPath) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.BACKEND_URL + callbackPath
  );
}

async function getUserInfo(oauth2Client) {
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

function issueJwt(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// ─── Login ────────────────────────────────────────────────────────────────────

// GET /auth/google  →  redirect to Google login
router.get('/google', (req, res) => {
  const state = crypto.randomUUID();
  const from = req.query.from || process.env.FRONTEND_URL;
  stateStore.set(state, { type: 'login', from, expiresAt: Date.now() + 10 * 60 * 1000 });

  const url = makeClient('/auth/callback').generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });

  res.redirect(url);
});

// GET /auth/callback  →  handle Google login callback
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  const stateData = stateStore.get(state);
  const frontendUrl = stateData?.from || process.env.FRONTEND_URL;

  if (error) return res.redirect(`${frontendUrl}?error=${error}`);

  if (!stateData || stateData.type !== 'login') {
    return res.redirect(`${process.env.FRONTEND_URL}?error=invalid_state`);
  }
  stateStore.delete(state);

  try {
    const client = makeClient('/auth/callback');
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const info = await getUserInfo(client);
    const db = getDb();

    // Upsert user
    db.prepare(`
      INSERT INTO users (google_id, email, name, picture)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(google_id) DO UPDATE SET
        email   = excluded.email,
        name    = excluded.name,
        picture = excluded.picture
    `).run(info.id, info.email, info.name, info.picture);

    const user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(info.id);

    // Also save as connected account (primary)
    db.prepare(`
      INSERT INTO connected_accounts (user_id, google_id, email, name, picture, access_token, refresh_token, token_expiry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, google_id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, connected_accounts.refresh_token),
        token_expiry  = excluded.token_expiry,
        email         = excluded.email,
        name          = excluded.name,
        picture       = excluded.picture
    `).run(
      user.id, info.id, info.email, info.name, info.picture,
      tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null
    );

    const token = issueJwt(user.id);
    res.redirect(`${frontendUrl}/dashboard?token=${token}`);
  } catch (err) {
    console.error('Login callback error:', err);
    res.redirect(`${frontendUrl}?error=auth_failed`);
  }
});

// ─── Add account ──────────────────────────────────────────────────────────────

// GET /auth/add-account?token=JWT  →  start adding another Google account
router.get('/add-account', (req, res) => {
  const { token, from } = req.query;
  const frontendUrl = from || process.env.FRONTEND_URL;

  if (!token) return res.redirect(`${frontendUrl}/dashboard?error=missing_token`);

  let userId;
  try {
    userId = jwt.verify(token, process.env.JWT_SECRET).userId;
  } catch {
    return res.redirect(`${frontendUrl}/dashboard?error=invalid_token`);
  }

  const state = crypto.randomUUID();
  stateStore.set(state, { type: 'add_account', userId, from: frontendUrl, expiresAt: Date.now() + 10 * 60 * 1000 });

  const url = makeClient('/auth/add-account/callback').generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent select_account',
  });

  res.redirect(url);
});

// GET /auth/add-account/callback
router.get('/add-account/callback', async (req, res) => {
  const { code, state, error } = req.query;

  const stateData = stateStore.get(state);
  const frontendUrl = stateData?.from || process.env.FRONTEND_URL;

  if (error) return res.redirect(`${frontendUrl}/dashboard?error=${error}`);

  if (!stateData || stateData.type !== 'add_account') {
    return res.redirect(`${process.env.FRONTEND_URL}/dashboard?error=invalid_state`);
  }
  stateStore.delete(state);

  try {
    const client = makeClient('/auth/add-account/callback');
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const info = await getUserInfo(client);
    const db = getDb();

    db.prepare(`
      INSERT INTO connected_accounts (user_id, google_id, email, name, picture, access_token, refresh_token, token_expiry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, google_id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, connected_accounts.refresh_token),
        token_expiry  = excluded.token_expiry,
        email         = excluded.email,
        name          = excluded.name,
        picture       = excluded.picture
    `).run(
      stateData.userId, info.id, info.email, info.name, info.picture,
      tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null
    );

    res.redirect(`${frontendUrl}/dashboard?account_added=true`);
  } catch (err) {
    console.error('Add-account callback error:', err);
    res.redirect(`${frontendUrl}/dashboard?error=auth_failed`);
  }
});

// ─── Current user ─────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = getDb()
    .prepare('SELECT id, email, name, picture FROM users WHERE id = ?')
    .get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router;
