const express = require('express');
const { getDb } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function getDashboardWithSites(db, id) {
  const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id);
  if (!dashboard) return null;
  dashboard.sites = db.prepare(
    'SELECT connected_account_id, site_url FROM dashboard_sites WHERE dashboard_id = ?'
  ).all(id);
  return dashboard;
}

// GET /api/dashboards
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM dashboards WHERE user_id = ? ORDER BY created_at ASC'
  ).all(req.userId);

  const result = rows.map(d => ({
    ...d,
    sites: db.prepare(
      'SELECT connected_account_id, site_url FROM dashboard_sites WHERE dashboard_id = ?'
    ).all(d.id),
  }));

  res.json(result);
});

// POST /api/dashboards
router.post('/', (req, res) => {
  const { name, sites = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const db = getDb();
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO dashboards (user_id, name) VALUES (?, ?)'
  ).run(req.userId, name.trim());

  const ins = db.prepare(
    'INSERT OR IGNORE INTO dashboard_sites (dashboard_id, connected_account_id, site_url) VALUES (?, ?, ?)'
  );
  for (const s of sites) ins.run(lastInsertRowid, s.connected_account_id, s.site_url);

  res.status(201).json(getDashboardWithSites(db, lastInsertRowid));
});

// PUT /api/dashboards/:id
router.put('/:id', (req, res) => {
  const { name, sites } = req.body;
  const db = getDb();

  const row = db.prepare(
    'SELECT id FROM dashboards WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (name?.trim()) {
    db.prepare('UPDATE dashboards SET name = ? WHERE id = ?').run(name.trim(), row.id);
  }

  if (Array.isArray(sites)) {
    db.prepare('DELETE FROM dashboard_sites WHERE dashboard_id = ?').run(row.id);
    const ins = db.prepare(
      'INSERT OR IGNORE INTO dashboard_sites (dashboard_id, connected_account_id, site_url) VALUES (?, ?, ?)'
    );
    for (const s of sites) ins.run(row.id, s.connected_account_id, s.site_url);
  }

  res.json(getDashboardWithSites(db, row.id));
});

// DELETE /api/dashboards/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT id FROM dashboards WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM dashboards WHERE id = ?').run(row.id);
  res.json({ success: true });
});

module.exports = router;
