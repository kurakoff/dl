const express = require('express');
const bcrypt = require('bcrypt');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

function isValidEmail(email) {
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function issueJwt(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function sendPin(email, code) {
  await resend.emails.send({
    from: 'SEO Dashboard <noreply@updates.memoryai.club>',
    to: email,
    subject: 'Your verification code',
    html: `<p>Your verification code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>Expires in 10 minutes.</p>`,
  });
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function saveOtp(email, code) {
  const db = getDb();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  db.prepare('INSERT INTO email_otps (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);
}

function verifyOtp(email, code) {
  const db = getDb();
  const otp = db.prepare(`
    SELECT id FROM email_otps
    WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(email, code, Date.now());
  if (otp) {
    db.prepare('UPDATE email_otps SET used = 1 WHERE id = ?').run(otp.id);
  }
  return !!otp;
}

// POST /auth/email/register — send verification PIN for registration
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const code = generateCode();
    saveOtp(email.toLowerCase(), code);

    await sendPin(email, code);
    res.json({ ok: true });
  } catch (err) {
    console.error('register error:', err.message);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// POST /auth/email/verify-register — verify PIN, upsert user with password, return JWT
router.post('/verify-register', (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({ error: 'email, code and password required' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const normalizedEmail = email.toLowerCase();

    if (!verifyOtp(normalizedEmail, code)) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const db = getDb();
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

    // Upsert: if user exists, just set password_hash; if not, create
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (user) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    } else {
      const result = db.prepare(
        'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'
      ).run(normalizedEmail, normalizedEmail.split('@')[0], passwordHash);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    res.json({ token: issueJwt(user) });
  } catch (err) {
    console.error('verify-register error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/email/login — email + password login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: 'No password set. Please create an account first.', code: 'NO_PASSWORD' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    res.json({ token: issueJwt(user) });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/email/forgot-password — send reset PIN (always 200)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email required' });

    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());

    // Always respond 200 to prevent email enumeration
    if (!user) return res.json({ ok: true });

    const code = generateCode();
    saveOtp(email.toLowerCase(), code);
    await sendPin(email, code);

    res.json({ ok: true });
  } catch (err) {
    console.error('forgot-password error:', err.message);
    res.json({ ok: true }); // Still 200 to prevent enumeration
  }
});

// POST /auth/email/reset-password — verify PIN, set new password, return JWT
router.post('/reset-password', (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({ error: 'email, code and password required' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const normalizedEmail = email.toLowerCase();

    if (!verifyOtp(normalizedEmail, code)) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);

    res.json({ token: issueJwt(user) });
  } catch (err) {
    console.error('reset-password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/email/change-password/send-code — send PIN to authenticated user's email
router.post('/change-password/send-code', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const code = generateCode();
    saveOtp(user.email, code);
    await sendPin(user.email, code);

    res.json({ ok: true });
  } catch (err) {
    console.error('change-password/send-code error:', err.message);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// POST /auth/email/change-password/verify — verify PIN, update password
router.post('/change-password/verify', requireAuth, (req, res) => {
  try {
    const { code, newPassword } = req.body;
    if (!code || !newPassword) {
      return res.status(400).json({ error: 'code and newPassword required' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const db = getDb();
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!verifyOtp(user.email, code)) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.userId);

    res.json({ ok: true });
  } catch (err) {
    console.error('change-password/verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
