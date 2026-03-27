const express = require('express');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

// POST /auth/email/send-otp
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const db = getDb();
  db.prepare(
    'INSERT INTO email_otps (email, code, expires_at) VALUES (?, ?, ?)'
  ).run(email.toLowerCase(), code, expiresAt);

  try {
    await resend.emails.send({
      from: `SEO Dashboard <noreply@updates.memoryai.club>`,
      to: email,
      subject: 'Your login code',
      html: `<p>Your one-time login code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>Expires in 10 minutes.</p>`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// POST /auth/email/verify-otp
router.post('/verify-otp', (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'email and code required' });
    }

    const db = getDb();
    const normalizedEmail = email.toLowerCase();

    const otp = db.prepare(`
      SELECT id FROM email_otps
      WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
      ORDER BY id DESC LIMIT 1
    `).get(normalizedEmail, code, Date.now());

    if (!otp) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    db.prepare('UPDATE email_otps SET used = 1 WHERE id = ?').run(otp.id);

    // Upsert user by email
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) {
      const result = db.prepare(
        'INSERT INTO users (email, name) VALUES (?, ?)'
      ).run(normalizedEmail, normalizedEmail.split('@')[0]);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token });
  } catch (err) {
    console.error('verify-otp error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
