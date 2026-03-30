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

// ─── Helper: connect a Google account to a user ──────────────────────────────

async function connectGoogleAccount(userId, tokens, oauth2Client) {
  oauth2Client.setCredentials(tokens);
  const info = await getUserInfo(oauth2Client);
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
    userId, info.id, info.email, info.name, info.picture,
    tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null
  );

  // Auto-select all Search Console sites
  try {
    const account = db.prepare(
      'SELECT id FROM connected_accounts WHERE user_id = ? AND google_id = ?'
    ).get(userId, info.id);

    const sc = google.searchconsole({ version: 'v1', auth: oauth2Client });
    const sitesRes = await sc.sites.list();
    const sites = sitesRes.data.siteEntry || [];

    const insertSite = db.prepare(
      'INSERT OR IGNORE INTO selected_sites (connected_account_id, site_url) VALUES (?, ?)'
    );
    for (const site of sites) {
      insertSite.run(account.id, site.siteUrl);
    }
  } catch (err) {
    console.error('Auto-select sites failed (non-critical):', err.message);
  }

  return info;
}

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
    await connectGoogleAccount(stateData.userId, tokens, client);
    res.redirect(`${frontendUrl}/dashboard?account_added=true`);
  } catch (err) {
    console.error('Add-account callback error:', err);
    res.redirect(`${frontendUrl}/dashboard?error=auth_failed`);
  }
});

// ─── Invite link ──────────────────────────────────────────────────────────────

// POST /auth/invite-token  — get or create invite token (requires JWT)
router.post('/invite-token', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT token FROM invite_tokens WHERE user_id = ?').get(req.userId);
  if (existing) {
    return res.json({ token: existing.token, url: `${process.env.BACKEND_URL}/auth/invite/${existing.token}` });
  }
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO invite_tokens (user_id, token) VALUES (?, ?)').run(req.userId, token);
  res.json({ token, url: `${process.env.BACKEND_URL}/auth/invite/${token}` });
});

// POST /auth/invite-token/regenerate  — regenerate invite token (requires JWT)
router.post('/invite-token/regenerate', requireAuth, (req, res) => {
  const db = getDb();
  const token = crypto.randomUUID();
  db.prepare(`
    INSERT INTO invite_tokens (user_id, token) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = CURRENT_TIMESTAMP
  `).run(req.userId, token);
  res.json({ token, url: `${process.env.BACKEND_URL}/auth/invite/${token}` });
});

// GET /auth/invite/callback  — Google OAuth callback for invite flow (public, NO JWT)
// MUST be registered BEFORE /auth/invite/:token so Express doesn't match "callback" as :token
router.get('/invite/callback', async (req, res) => {
  const { code, state, error } = req.query;

  const stateData = stateStore.get(state);

  if (error || !stateData || stateData.type !== 'invite') {
    const errMsg = error || 'invalid_state';
    return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
      .card{text-align:center;padding:3rem;background:#fff;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:400px}
      h1{font-size:1.25rem;color:#dc2626;margin-bottom:.5rem}p{color:#6b7280;font-size:.875rem}</style></head>
      <body><div class="card"><h1>Connection Failed</h1><p>${errMsg === 'access_denied' ? 'You cancelled the authorization.' : 'Something went wrong. Please try again.'}</p>
      <p style="margin-top:1rem;color:#9ca3af;font-size:.75rem">You can close this tab.</p></div></body></html>`);
  }
  stateStore.delete(state);

  try {
    const client = makeClient('/auth/invite/callback');
    const { tokens } = await client.getToken(code);
    await connectGoogleAccount(stateData.userId, tokens, client);

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Account Connected</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
      .card{text-align:center;padding:3rem;background:#fff;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:400px}
      h1{font-size:1.25rem;color:#16a34a;margin-bottom:.5rem}p{color:#6b7280;font-size:.875rem}</style></head>
      <body><div class="card"><h1>Account Connected!</h1><p>The Google account has been successfully linked.</p>
      <p style="margin-top:1rem;color:#9ca3af;font-size:.75rem">You can close this tab.</p></div></body></html>`);
  } catch (err) {
    console.error('Invite callback error:', err);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
      .card{text-align:center;padding:3rem;background:#fff;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:400px}
      h1{font-size:1.25rem;color:#dc2626;margin-bottom:.5rem}p{color:#6b7280;font-size:.875rem}</style></head>
      <body><div class="card"><h1>Connection Failed</h1><p>Something went wrong while connecting the account. Please try again.</p>
      <p style="margin-top:1rem;color:#9ca3af;font-size:.75rem">You can close this tab.</p></div></body></html>`);
  }
});

// GET /auth/invite/:token  — start invite OAuth flow (public, NO JWT)
router.get('/invite/:token', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM invite_tokens WHERE token = ?').get(req.params.token);
  if (!row) {
    return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invalid Link</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
      .card{text-align:center;padding:3rem;background:#fff;border-radius:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1);max-width:400px}
      h1{font-size:1.25rem;color:#dc2626;margin-bottom:.5rem}p{color:#6b7280;font-size:.875rem}</style></head>
      <body><div class="card"><h1>Invalid Invite Link</h1><p>This invite link is invalid or has been regenerated.</p></div></body></html>`);
  }

  const state = crypto.randomUUID();
  stateStore.set(state, { type: 'invite', userId: row.user_id, expiresAt: Date.now() + 10 * 60 * 1000 });

  const url = makeClient('/auth/invite/callback').generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent select_account',
  });

  res.redirect(url);
});

// ─── Current user ─────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = getDb()
    .prepare('SELECT id, email, name, picture, (password_hash IS NOT NULL) as hasPassword FROM users WHERE id = ?')
    .get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router;
