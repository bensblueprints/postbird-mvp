const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { openDb, getSettings, setSettings, loadSecret } = require('./db');
const { compile } = require('./compiler');
const { compileRules } = require('./segments');
const { sign, verify } = require('./tokens');
const { importCsv, EMAIL_RE } = require('./csv');
const { createSender } = require('./sender');

// 1×1 transparent GIF (43 bytes)
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function htmlPage(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:#09090b;color:#e4e4e7;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:440px;padding:40px;text-align:center;background:#18181b;border:1px solid #27272a;border-radius:16px;margin:16px}
h1{font-size:22px;margin:0 0 12px}p{color:#a1a1aa;line-height:1.6;margin:0}</style></head>
<body><div class="card">${body}</div></body></html>`;
}

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD || 'admin';
  const autologinToken = opts.autologinToken || process.env.AUTOLOGIN_TOKEN || null;
  const dbPath = opts.dbPath || process.env.DB_PATH || null;

  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(dataDir, dbPath);
  const secret = loadSecret(dataDir);

  let runtimeBase = opts.baseUrl || process.env.BASE_URL || '';
  function getBaseUrl() {
    const s = getSettings(db);
    const base = s.base_url || runtimeBase || `http://localhost:${process.env.PORT || 5327}`;
    return base.replace(/\/+$/, '');
  }

  const sender = createSender({ db, secret, getBaseUrl });
  sender.start();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cookieParser());

  // ================= TRACKING (public, fast, dependency-free — before body parsing) =================

  app.get('/t/o/:token.gif', (req, res) => {
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' });
    res.end(PIXEL); // respond first — never let DB writes delay the pixel
    const parts = verify(secret, req.params.token);
    if (!parts || parts[0] !== 'o') return;
    try {
      const row = db.prepare('SELECT campaign_id, subscriber_id FROM outbox WHERE id = ?').get(Number(parts[1]));
      if (!row) return;
      db.prepare(`INSERT INTO events (campaign_id, subscriber_id, type, ua, ip) VALUES (?, ?, 'open', ?, ?)`)
        .run(row.campaign_id, row.subscriber_id, String(req.headers['user-agent'] || '').slice(0, 300), req.ip);
    } catch { /* tracking must never 500 */ }
  });

  app.get('/t/c/:token', (req, res) => {
    const parts = verify(secret, req.params.token);
    if (!parts || parts[0] !== 'c') return res.status(404).send('Not found');
    const url = parts.slice(2).join('|'); // URL may itself contain '|'
    res.redirect(302, url);
    try {
      const row = db.prepare('SELECT campaign_id, subscriber_id FROM outbox WHERE id = ?').get(Number(parts[1]));
      if (!row) return;
      db.prepare(`INSERT INTO events (campaign_id, subscriber_id, type, url, ua, ip) VALUES (?, ?, 'click', ?, ?, ?)`)
        .run(row.campaign_id, row.subscriber_id, url.slice(0, 2000), String(req.headers['user-agent'] || '').slice(0, 300), req.ip);
    } catch { /* tracking must never 500 */ }
  });

  // ================= UNSUBSCRIBE (public, no login, immediate) =================

  function doUnsub(parts, req) {
    const subId = Number(parts[1]);
    const campaignId = Number(parts[2]) || null;
    const sub = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(subId);
    if (!sub) return null;
    if (sub.status !== 'unsubscribed') {
      db.prepare(`UPDATE subscribers SET status = 'unsubscribed', unsub_at = datetime('now') WHERE id = ?`).run(subId);
      db.prepare(`INSERT INTO events (campaign_id, subscriber_id, type, ua, ip) VALUES (?, ?, 'unsub', ?, ?)`)
        .run(campaignId, subId, String(req.headers['user-agent'] || '').slice(0, 300), req.ip);
    }
    return sub;
  }

  app.get('/unsub/:token', (req, res) => {
    const parts = verify(secret, req.params.token);
    if (!parts || parts[0] !== 'u') return res.status(404).send(htmlPage('Not found', '<h1>Link invalid</h1><p>This unsubscribe link is invalid or malformed.</p>'));
    const sub = doUnsub(parts, req);
    if (!sub) return res.status(404).send(htmlPage('Not found', '<h1>Not found</h1><p>This subscription no longer exists.</p>'));
    res.send(htmlPage('Unsubscribed', `<h1>You're unsubscribed</h1><p>${sub.email} will no longer receive emails from this list. This took effect immediately.</p>`));
  });

  // RFC 8058 one-click (List-Unsubscribe-Post) — mailbox providers POST here.
  app.post('/unsub/:token', express.urlencoded({ extended: false }), (req, res) => {
    const parts = verify(secret, req.params.token);
    if (!parts || parts[0] !== 'u') return res.status(404).json({ error: 'invalid token' });
    const sub = doUnsub(parts, req);
    if (!sub) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  // ================= DOUBLE OPT-IN CONFIRM (public) =================

  app.get('/confirm/:token', (req, res) => {
    const parts = verify(secret, req.params.token);
    if (!parts || parts[0] !== 'cf') return res.status(404).send(htmlPage('Invalid link', '<h1>Link invalid</h1><p>This confirmation link is invalid or expired.</p>'));
    const sub = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(Number(parts[1]));
    if (!sub) return res.status(404).send(htmlPage('Not found', '<h1>Not found</h1><p>This subscription no longer exists.</p>'));
    if (sub.status === 'pending') {
      db.prepare(`UPDATE subscribers SET status = 'subscribed', consent_at = datetime('now'), consent_ip = ? WHERE id = ?`)
        .run(req.ip, sub.id);
    }
    res.send(htmlPage('Confirmed', `<h1>Subscription confirmed 🎉</h1><p>${sub.email} is now subscribed. Welcome aboard!</p>`));
  });

  app.use(express.json({ limit: '10mb' }));

  // ================= PUBLIC SIGNUP =================

  app.post('/api/public/lists/:id/subscribe', (req, res) => {
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim().slice(0, 200);
    const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

    const existing = db.prepare('SELECT * FROM subscribers WHERE list_id = ? AND email = ?').get(list.id, email);
    let sub;
    if (existing) {
      if (existing.status === 'subscribed') return res.json({ ok: true, status: 'subscribed' });
      // re-signup after unsub/bounce → back through opt-in
      db.prepare(`UPDATE subscribers SET status = ?, name = COALESCE(NULLIF(?, ''), name) WHERE id = ?`)
        .run(list.double_opt_in ? 'pending' : 'subscribed', name, existing.id);
      sub = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(existing.id);
    } else {
      const status = list.double_opt_in ? 'pending' : 'subscribed';
      const info = db.prepare(
        `INSERT INTO subscribers (list_id, email, name, fields_json, status, consent_at, consent_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(list.id, email, name, JSON.stringify(fields), status,
        list.double_opt_in ? null : new Date().toISOString().replace('T', ' ').slice(0, 19),
        list.double_opt_in ? null : req.ip);
      sub = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(info.lastInsertRowid);
    }

    if (list.double_opt_in && sub.status === 'pending') {
      const token = sign(secret, `cf|${sub.id}`);
      const confirmUrl = `${getBaseUrl()}/confirm/${token}`;
      const settings = getSettings(db);
      const fromEmail = list.from_email || settings.default_from_email || settings.smtp_user || 'noreply@localhost';
      const fromName = list.from_name || settings.default_from_name || list.name;
      sender.sendSystemMail({
        from: `"${fromName.replace(/"/g, '')}" <${fromEmail}>`,
        to: sub.email,
        subject: `Confirm your subscription to ${list.name}`,
        html: htmlPage('Confirm', `<h1>Confirm your subscription</h1><p>Click the link below to confirm you want to receive emails from <b>${list.name}</b>.</p><p style="margin-top:20px"><a href="${confirmUrl}" style="color:#818cf8">Confirm my subscription</a></p><p style="margin-top:20px;font-size:12px">If you didn't sign up, ignore this email and you will not be subscribed.</p>`),
        text: `Confirm your subscription to ${list.name}:\n\n${confirmUrl}\n\nIf you didn't sign up, ignore this email.`
      }).catch((err) => console.error('[opt-in] confirmation send failed:', err.message));
      return res.json({ ok: true, status: 'pending', message: 'Check your inbox to confirm your subscription.' });
    }
    res.json({ ok: true, status: sub.status });
  });

  // ================= BOUNCE / COMPLAINT WEBHOOK (public) =================
  // Accepts generic JSON plus SES-SNS / Postmark / Mailgun shapes (see README).

  function extractBounceEvents(body) {
    const out = [];
    const push = (email, kind) => { if (email && EMAIL_RE.test(String(email).toLowerCase())) out.push({ email: String(email).toLowerCase(), kind }); };
    if (!body || typeof body !== 'object') return out;
    // generic: { email, type: 'bounce'|'complaint' }
    if (body.email && body.type) push(body.email, body.type === 'complaint' ? 'complaint' : 'bounce');
    // Postmark: { RecordType: 'Bounce'|'SpamComplaint', Email }
    if (body.RecordType === 'Bounce') push(body.Email || body.Recipient, 'bounce');
    if (body.RecordType === 'SpamComplaint') push(body.Email || body.Recipient, 'complaint');
    // Mailgun: { "event-data": { event: 'failed'|'complained', severity, recipient } }
    const ed = body['event-data'];
    if (ed && ed.recipient) {
      if (ed.event === 'failed' && (!ed.severity || ed.severity === 'permanent')) push(ed.recipient, 'bounce');
      if (ed.event === 'complained') push(ed.recipient, 'complaint');
    }
    // SES via SNS: { Type: 'Notification', Message: '<json>' } or raw SES JSON
    let ses = null;
    if (body.Type === 'Notification' && typeof body.Message === 'string') ses = safeJson(body.Message, null);
    else if (body.notificationType) ses = body;
    if (ses) {
      if (ses.notificationType === 'Bounce' && ses.bounce?.bounceType !== 'Transient') {
        for (const r of ses.bounce?.bouncedRecipients || []) push(r.emailAddress, 'bounce');
      }
      if (ses.notificationType === 'Complaint') {
        for (const r of ses.complaint?.complainedRecipients || []) push(r.emailAddress, 'complaint');
      }
    }
    return out;
  }

  app.post('/api/hooks/bounce', (req, res) => {
    const events = extractBounceEvents(req.body);
    let updated = 0;
    for (const ev of events) {
      const status = ev.kind === 'complaint' ? 'complained' : 'bounced';
      const listId = Number(req.body?.list_id) || null;
      const subs = listId
        ? db.prepare('SELECT id, list_id FROM subscribers WHERE list_id = ? AND email = ?').all(listId, ev.email)
        : db.prepare('SELECT id, list_id FROM subscribers WHERE email = ?').all(ev.email);
      for (const s of subs) {
        db.prepare('UPDATE subscribers SET status = ? WHERE id = ?').run(status, s.id);
        db.prepare(`INSERT INTO events (campaign_id, subscriber_id, type) VALUES (NULL, ?, ?)`)
          .run(s.id, ev.kind === 'complaint' ? 'complaint' : 'bounce');
        updated++;
      }
    }
    res.json({ ok: true, processed: events.length, updated });
  });

  // ================= AUTH =================

  const sessions = new Set();
  function newSession(res) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.add(sid);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    return sid;
  }
  function requireAuth(req, res, next) {
    if (req.cookies.sid && sessions.has(req.cookies.sid)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  app.post('/api/login', (req, res) => {
    const pw = String(req.body?.password || '');
    const a = Buffer.from(pw);
    const b = Buffer.from(adminPassword);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    newSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', requireAuth, (req, res) => {
    sessions.delete(req.cookies.sid);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    res.json({ authed: !!(req.cookies.sid && sessions.has(req.cookies.sid)) });
  });

  if (autologinToken) {
    app.get('/auth/auto', (req, res) => {
      if (req.query.token !== autologinToken) return res.status(403).send('Forbidden');
      newSession(res);
      res.redirect('/admin');
    });
  }

  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'postbird' }));

  // ================= UPLOADS (builder images, served from BASE_URL) =================

  const uploadsDir = path.join(dataDir, 'uploads');
  const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.png').toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype))
  });
  app.use('/uploads', express.static(uploadsDir, { maxAge: '30d' }));

  app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    res.json({ url: `${getBaseUrl()}/uploads/${req.file.filename}` });
  });

  // ================= LISTS =================

  const listStats = (l) => ({
    ...l,
    counts: db.prepare(
      `SELECT status, COUNT(*) AS n FROM subscribers WHERE list_id = ? GROUP BY status`
    ).all(l.id).reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {})
  });

  app.get('/api/lists', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM lists ORDER BY id DESC').all().map(listStats));
  });

  app.post('/api/lists', requireAuth, (req, res) => {
    const { name, double_opt_in = 1, from_name = '', from_email = '' } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
    const info = db.prepare('INSERT INTO lists (name, double_opt_in, from_name, from_email) VALUES (?, ?, ?, ?)')
      .run(String(name).trim(), double_opt_in ? 1 : 0, String(from_name), String(from_email));
    res.status(201).json(listStats(db.prepare('SELECT * FROM lists WHERE id = ?').get(info.lastInsertRowid)));
  });

  app.get('/api/lists/:id', requireAuth, (req, res) => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    res.json(listStats(l));
  });

  app.put('/api/lists/:id', requireAuth, (req, res) => {
    const l = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: 'Not found' });
    const { name = l.name, double_opt_in = l.double_opt_in, from_name = l.from_name, from_email = l.from_email } = req.body || {};
    db.prepare('UPDATE lists SET name = ?, double_opt_in = ?, from_name = ?, from_email = ? WHERE id = ?')
      .run(String(name), double_opt_in ? 1 : 0, String(from_name), String(from_email), l.id);
    res.json(listStats(db.prepare('SELECT * FROM lists WHERE id = ?').get(l.id)));
  });

  app.delete('/api/lists/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM subscribers WHERE list_id = ?').run(req.params.id);
    db.prepare('DELETE FROM segments WHERE list_id = ?').run(req.params.id);
    db.prepare('DELETE FROM lists WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ================= SUBSCRIBERS =================

  app.get('/api/lists/:id/subscribers', requireAuth, (req, res) => {
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.min(500, Number(req.query.limit) || 200);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    let where = 'list_id = ?';
    const params = [req.params.id];
    if (q) { where += ' AND (email LIKE ? OR name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE ${where}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM subscribers WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    res.json({ total, subscribers: rows });
  });

  app.post('/api/lists/:id/subscribers', requireAuth, (req, res) => {
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
    try {
      // manual admin add = consent asserted by the operator
      const info = db.prepare(
        `INSERT INTO subscribers (list_id, email, name, fields_json, status, consent_at) VALUES (?, ?, ?, ?, 'subscribed', datetime('now'))`
      ).run(list.id, email, name, JSON.stringify(fields));
      res.status(201).json(db.prepare('SELECT * FROM subscribers WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) {
      if (/UNIQUE/.test(String(e))) return res.status(409).json({ error: 'Already on this list' });
      throw e;
    }
  });

  app.put('/api/subscribers/:id', requireAuth, (req, res) => {
    const s = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const { name = s.name, fields = null, status = s.status } = req.body || {};
    const allowed = ['pending', 'subscribed', 'unsubscribed', 'bounced', 'complained'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    db.prepare('UPDATE subscribers SET name = ?, fields_json = ?, status = ? WHERE id = ?')
      .run(String(name), fields ? JSON.stringify(fields) : s.fields_json, status, s.id);
    res.json(db.prepare('SELECT * FROM subscribers WHERE id = ?').get(s.id));
  });

  app.delete('/api/subscribers/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/subscribers/:id/activity', requireAuth, (req, res) => {
    const events = db.prepare(
      `SELECT e.*, c.subject AS campaign_subject FROM events e LEFT JOIN campaigns c ON c.id = e.campaign_id
       WHERE e.subscriber_id = ? ORDER BY e.id DESC LIMIT 200`
    ).all(req.params.id);
    res.json(events);
  });

  app.post('/api/lists/:id/import', requireAuth, (req, res) => {
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found' });
    const csv = String(req.body?.csv || '');
    if (!csv.trim()) return res.status(400).json({ error: 'Provide CSV content in the `csv` field' });
    res.json(importCsv(db, list.id, csv));
  });

  app.get('/api/lists/:id/export.csv', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT email, name, status, fields_json, consent_at, created_at FROM subscribers WHERE list_id = ? ORDER BY id').all(req.params.id);
    const escCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = 'email,name,status,fields,consent_at,created_at\n' +
      rows.map((r) => [r.email, r.name, r.status, r.fields_json, r.consent_at, r.created_at].map(escCsv).join(',')).join('\n') + '\n';
    res.set('Content-Disposition', 'attachment; filename="subscribers.csv"');
    res.type('text/csv').send(csv);
  });

  // ================= SEGMENTS =================

  app.get('/api/lists/:id/segments', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM segments WHERE list_id = ? ORDER BY id DESC').all(req.params.id));
  });

  app.post('/api/lists/:id/segments', requireAuth, (req, res) => {
    const { name, rules } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name required' });
    const info = db.prepare('INSERT INTO segments (list_id, name, rules_json) VALUES (?, ?, ?)')
      .run(req.params.id, String(name), JSON.stringify(rules || { op: 'AND', rules: [] }));
    res.status(201).json(db.prepare('SELECT * FROM segments WHERE id = ?').get(info.lastInsertRowid));
  });

  app.put('/api/segments/:id', requireAuth, (req, res) => {
    const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(req.params.id);
    if (!seg) return res.status(404).json({ error: 'Not found' });
    const { name = seg.name, rules = null } = req.body || {};
    db.prepare('UPDATE segments SET name = ?, rules_json = ? WHERE id = ?')
      .run(String(name), rules ? JSON.stringify(rules) : seg.rules_json, seg.id);
    res.json(db.prepare('SELECT * FROM segments WHERE id = ?').get(seg.id));
  });

  app.delete('/api/segments/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM segments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/segments/preview', requireAuth, (req, res) => {
    const { list_id, rules } = req.body || {};
    if (!list_id) return res.status(400).json({ error: 'list_id required' });
    const c = compileRules(rules || {});
    const where = `s.list_id = ? AND s.status = 'subscribed' AND ${c.where}`;
    const params = [list_id, ...c.params];
    try {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM subscribers s WHERE ${where}`).get(...params).n;
      const sample = db.prepare(`SELECT s.id, s.email, s.name FROM subscribers s WHERE ${where} LIMIT 10`).all(...params);
      res.json({ count, sample });
    } catch (e) {
      res.status(400).json({ error: `Invalid rules: ${e.message}` });
    }
  });

  // ================= TEMPLATES =================

  app.get('/api/templates', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT id, name, updated_at FROM templates ORDER BY updated_at DESC').all());
  });

  app.post('/api/templates', requireAuth, (req, res) => {
    const { name = 'Untitled', blocks = [] } = req.body || {};
    const info = db.prepare('INSERT INTO templates (name, blocks_json) VALUES (?, ?)')
      .run(String(name), JSON.stringify(blocks));
    res.status(201).json(db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid));
  });

  app.get('/api/templates/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json({ ...t, blocks: safeJson(t.blocks_json, []) });
  });

  app.put('/api/templates/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const { name = t.name, blocks = null } = req.body || {};
    db.prepare(`UPDATE templates SET name = ?, blocks_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(name), blocks ? JSON.stringify(blocks) : t.blocks_json, t.id);
    res.json(db.prepare('SELECT * FROM templates WHERE id = ?').get(t.id));
  });

  app.delete('/api/templates/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/templates/:id/render', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const blocks = req.body?.blocks || safeJson(t.blocks_json, []);
    res.json(compile(blocks, { enforceFooter: true, global: req.body?.global }));
  });

  app.post('/api/templates/:id/test-send', requireAuth, async (req, res) => {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const to = String(req.body?.to || '').trim();
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Invalid recipient email' });
    try {
      await sender.sendTest({ to, blocks: safeJson(t.blocks_json, []), subject: t.name });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ================= CAMPAIGNS =================

  const campaignStats = (c) => {
    const ob = db.prepare(`SELECT status, COUNT(*) AS n FROM outbox WHERE campaign_id = ? GROUP BY status`).all(c.id)
      .reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
    const opens = db.prepare(`SELECT COUNT(DISTINCT subscriber_id) AS u, COUNT(*) AS t FROM events WHERE campaign_id = ? AND type = 'open'`).get(c.id);
    const clicks = db.prepare(`SELECT COUNT(DISTINCT subscriber_id) AS u, COUNT(*) AS t FROM events WHERE campaign_id = ? AND type = 'click'`).get(c.id);
    return { ...c, outbox: ob, opens_unique: opens.u, opens_total: opens.t, clicks_unique: clicks.u, clicks_total: clicks.t };
  };

  app.get('/api/campaigns', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all().map(campaignStats));
  });

  app.post('/api/campaigns', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!b.list_id || !b.template_id) return res.status(400).json({ error: 'list_id and template_id required' });
    const info = db.prepare(
      `INSERT INTO campaigns (list_id, segment_id, template_id, subject, from_name, from_email, reply_to, throttle_per_min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(b.list_id, b.segment_id || null, b.template_id, String(b.subject || ''), String(b.from_name || ''),
      String(b.from_email || ''), String(b.reply_to || ''), Math.max(1, Number(b.throttle_per_min) || 30));
    res.status(201).json(campaignStats(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid)));
  });

  app.get('/api/campaigns/:id', requireAuth, (req, res) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(campaignStats(c));
  });

  app.put('/api/campaigns/:id', requireAuth, (req, res) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!['draft', 'scheduled', 'paused'].includes(c.status)) return res.status(400).json({ error: `Cannot edit a ${c.status} campaign` });
    const b = req.body || {};
    db.prepare(
      `UPDATE campaigns SET list_id = ?, segment_id = ?, template_id = ?, subject = ?, from_name = ?, from_email = ?, reply_to = ?, throttle_per_min = ? WHERE id = ?`
    ).run(b.list_id ?? c.list_id, b.segment_id !== undefined ? b.segment_id : c.segment_id, b.template_id ?? c.template_id,
      String(b.subject ?? c.subject), String(b.from_name ?? c.from_name), String(b.from_email ?? c.from_email),
      String(b.reply_to ?? c.reply_to), Math.max(1, Number(b.throttle_per_min ?? c.throttle_per_min) || 30), c.id);
    res.json(campaignStats(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(c.id)));
  });

  app.delete('/api/campaigns/:id', requireAuth, (req, res) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (c.status === 'sending') return res.status(400).json({ error: 'Cancel the campaign before deleting' });
    db.prepare('DELETE FROM outbox WHERE campaign_id = ?').run(c.id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  // Compliance gate + queue + start (or schedule).
  app.post('/api/campaigns/:id/send', requireAuth, (req, res) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!['draft', 'scheduled', 'paused'].includes(c.status)) {
      return res.status(400).json({ error: `Campaign is already ${c.status}` });
    }

    const settings = getSettings(db);
    const problems = [];
    // MANDATORY CAN-SPAM: a physical mailing address must appear in every send.
    if (!settings.physical_address.trim()) {
      problems.push('Sender physical mailing address is empty (Settings → Compliance). CAN-SPAM requires it in every email.');
    }
    if (!settings.smtp_host.trim()) problems.push('SMTP is not configured (Settings → SMTP).');
    if (!c.subject.trim()) problems.push('Campaign subject is empty.');
    const fromEmail = c.from_email || settings.default_from_email;
    if (!EMAIL_RE.test(fromEmail || '')) problems.push('From address is missing or invalid.');
    const tpl = db.prepare('SELECT id FROM templates WHERE id = ?').get(c.template_id);
    if (!tpl) problems.push('Template no longer exists.');
    if (problems.length) return res.status(400).json({ error: problems[0], problems });

    if (c.status === 'paused') {
      db.prepare(`UPDATE campaigns SET status = 'sending' WHERE id = ?`).run(c.id);
      return res.json({ ok: true, resumed: true });
    }

    const scheduleAt = req.body?.scheduled_at ? String(req.body.scheduled_at) : null;
    const queued = sender.queueCampaign(c);
    if (!queued) {
      db.prepare('DELETE FROM outbox WHERE campaign_id = ?').run(c.id);
      return res.status(400).json({ error: 'No subscribed recipients match this audience.' });
    }
    if (scheduleAt) {
      db.prepare(`UPDATE campaigns SET status = 'scheduled', scheduled_at = ? WHERE id = ?`).run(scheduleAt, c.id);
    } else {
      db.prepare(`UPDATE campaigns SET status = 'sending', started_at = datetime('now') WHERE id = ?`).run(c.id);
    }
    res.json({ ok: true, queued, scheduled: !!scheduleAt });
  });

  app.post('/api/campaigns/:id/pause', requireAuth, (req, res) => {
    const r = db.prepare(`UPDATE campaigns SET status = 'paused' WHERE id = ? AND status = 'sending'`).run(req.params.id);
    if (!r.changes) return res.status(400).json({ error: 'Campaign is not sending' });
    res.json({ ok: true });
  });

  app.post('/api/campaigns/:id/cancel', requireAuth, (req, res) => {
    const r = db.prepare(`UPDATE campaigns SET status = 'canceled', finished_at = datetime('now') WHERE id = ? AND status IN ('sending','paused','scheduled')`).run(req.params.id);
    if (!r.changes) return res.status(400).json({ error: 'Campaign cannot be canceled' });
    db.prepare(`UPDATE outbox SET status = 'failed', error = 'canceled' WHERE campaign_id = ? AND status = 'queued'`).run(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/campaigns/:id/report', requireAuth, (req, res) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const stats = campaignStats(c);
    const urls = db.prepare(
      `SELECT url, COUNT(*) AS total, COUNT(DISTINCT subscriber_id) AS unique_clicks FROM events
       WHERE campaign_id = ? AND type = 'click' GROUP BY url ORDER BY total DESC`
    ).all(c.id);
    const recipients = db.prepare(
      `SELECT o.id AS outbox_id, o.status, o.error, o.sent_at, s.email, s.name, s.id AS subscriber_id,
        (SELECT COUNT(*) FROM events e WHERE e.campaign_id = o.campaign_id AND e.subscriber_id = o.subscriber_id AND e.type = 'open') AS opens,
        (SELECT COUNT(*) FROM events e WHERE e.campaign_id = o.campaign_id AND e.subscriber_id = o.subscriber_id AND e.type = 'click') AS clicks
       FROM outbox o JOIN subscribers s ON s.id = o.subscriber_id WHERE o.campaign_id = ? ORDER BY o.id LIMIT 1000`
    ).all(c.id);
    const unsubs = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE campaign_id = ? AND type = 'unsub'`).get(c.id).n;
    res.json({ campaign: stats, urls, recipients, unsubs });
  });

  // ================= SETTINGS / DASHBOARD =================

  app.get('/api/settings', requireAuth, (req, res) => {
    const s = getSettings(db);
    res.json({ ...s, smtp_pass: s.smtp_pass ? '••••••••' : '', base_url_effective: getBaseUrl() });
  });

  app.put('/api/settings', requireAuth, (req, res) => {
    const body = { ...(req.body || {}) };
    if (body.smtp_pass === '••••••••') delete body.smtp_pass; // masked value untouched
    setSettings(db, body);
    const s = getSettings(db);
    res.json({ ...s, smtp_pass: s.smtp_pass ? '••••••••' : '', base_url_effective: getBaseUrl() });
  });

  app.post('/api/settings/smtp-test', requireAuth, async (req, res) => {
    try {
      await sender.verifySmtp();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/dashboard', requireAuth, (req, res) => {
    const campaigns = db.prepare(`SELECT * FROM campaigns ORDER BY id DESC LIMIT 8`).all().map(campaignStats);
    const totals = {
      lists: db.prepare('SELECT COUNT(*) AS n FROM lists').get().n,
      subscribers: db.prepare(`SELECT COUNT(*) AS n FROM subscribers WHERE status = 'subscribed'`).get().n,
      sent: db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'sent'`).get().n,
      campaigns: db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n
    };
    res.json({ campaigns, totals });
  });

  // ================= ADMIN SPA =================
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use('/admin', express.static(distDir));
    app.get('/admin/*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    app.get('/admin', (req, res) =>
      res.status(503).type('html').send('<h1>Admin UI not built</h1><p>Run <code>npm run build</code> first.</p>')
    );
  }

  app.get('/', (req, res) => res.redirect('/admin'));

  app.locals.db = db;
  app.locals.sender = sender;
  app.locals.setBaseUrl = (url) => { runtimeBase = url; };
  return app;
}

module.exports = { createApp };
