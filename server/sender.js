// Sending worker: in-process loop draining the `outbox` table at the campaign's
// throttle rate. Survives restarts — unsent (queued) rows simply resume.
// SMTP via nodemailer pooled transport (BYO SMTP: SES, Postmark, Mailgun, Gmail...).
const nodemailer = require('nodemailer');
const { compile } = require('./compiler');
const { compileRules } = require('./segments');
const { sign } = require('./tokens');
const { getSettings } = require('./db');

const TICK_MS = 2000;

function createSender({ db, secret, getBaseUrl }) {
  let transport = null;
  let transportKey = '';
  const credits = new Map(); // campaignId → fractional send credit
  const compiledCache = new Map(); // campaignId → { html, text }
  let timer = null;
  let ticking = false;

  function smtpConfigured(s) {
    return Boolean(s.smtp_host);
  }

  function getTransport() {
    const s = getSettings(db);
    if (!smtpConfigured(s)) return null;
    const key = JSON.stringify([s.smtp_host, s.smtp_port, s.smtp_secure, s.smtp_user, s.smtp_pass, s.smtp_pool_size]);
    if (!transport || key !== transportKey) {
      if (transport) transport.close();
      transport = nodemailer.createTransport({
        host: s.smtp_host,
        port: Number(s.smtp_port) || 587,
        secure: s.smtp_secure === '1',
        auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
        pool: true,
        maxConnections: Math.min(5, Math.max(1, Number(s.smtp_pool_size) || 2)),
        tls: { rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED === '1' ? false : undefined }
      });
      transportKey = key;
    }
    return transport;
  }

  // ---------- personalization ----------
  function mergeTags(str, sub, extra = {}) {
    const fields = safeJson(sub.fields_json);
    return String(str)
      .replace(/\{\{\s*name\s*\}\}/g, sub.name || '')
      .replace(/\{\{\s*email\s*\}\}/g, sub.email || '')
      .replace(/\{\{\s*physical_address\s*\}\}/g, extra.physicalAddress || '')
      .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, extra.unsubUrl || '')
      .replace(/\{\{\s*field\.([\w-]+)\s*\}\}/g, (m, k) => String(fields[k] ?? ''));
  }

  function safeJson(s) {
    try { return JSON.parse(s || '{}'); } catch { return {}; }
  }

  // Rewrite every real http(s) link to a signed click-tracking redirect.
  // The unsubscribe link is still `{{unsubscribe_url}}` at this point so it is
  // never click-wrapped (unsubscribe must resolve directly, one click).
  function rewriteLinks(html, outboxId, base) {
    return html.replace(/href="(https?:\/\/[^"]+)"/g, (m, url) => {
      const token = sign(secret, `c|${outboxId}|${url}`);
      return `href="${base}/t/c/${token}"`;
    });
  }

  function buildMessage({ campaign, sub, outboxRow, compiled, settings, base }) {
    const unsubToken = sign(secret, `u|${sub.id}|${campaign.id}`);
    const unsubUrl = `${base}/unsub/${unsubToken}`;
    const extra = { unsubUrl, physicalAddress: settings.physical_address };

    let html = rewriteLinks(compiled.html, outboxRow.id, base);
    html = mergeTags(html, sub, extra);
    const pixelToken = sign(secret, `o|${outboxRow.id}`);
    html = html.replace(
      '</body>',
      `<img src="${base}/t/o/${pixelToken}.gif" width="1" height="1" alt="" style="display:block;border:0;" /></body>`
    );
    const text = mergeTags(compiled.text, sub, extra);
    const subject = mergeTags(campaign.subject, sub, extra);

    const fromEmail = campaign.from_email || settings.default_from_email;
    const fromName = campaign.from_name || settings.default_from_name;
    return {
      from: fromName ? `"${fromName.replace(/"/g, '')}" <${fromEmail}>` : fromEmail,
      to: sub.email,
      replyTo: campaign.reply_to || undefined,
      subject,
      html,
      text,
      headers: {
        // RFC 8058 one-click unsubscribe — required by Gmail/Yahoo for bulk senders.
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    };
  }

  // ---------- recipients / queueing ----------
  function recipientQuery(listId, segmentId) {
    let where = `s.list_id = ? AND s.status = 'subscribed'`;
    const params = [listId];
    if (segmentId) {
      const seg = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
      if (seg) {
        const c = compileRules(seg.rules_json);
        where += ` AND ${c.where}`;
        params.push(...c.params);
      }
    }
    return { where, params };
  }

  function countRecipients(listId, segmentId) {
    const { where, params } = recipientQuery(listId, segmentId);
    return db.prepare(`SELECT COUNT(*) AS n FROM subscribers s WHERE ${where}`).get(...params).n;
  }

  function listRecipients(listId, segmentId) {
    const { where, params } = recipientQuery(listId, segmentId);
    return db.prepare(`SELECT s.* FROM subscribers s WHERE ${where}`).all(...params);
  }

  function queueCampaign(campaign) {
    const recipients = listRecipients(campaign.list_id, campaign.segment_id);
    const insert = db.prepare(
      'INSERT INTO outbox (campaign_id, subscriber_id, status, token) VALUES (?, ?, ?, ?)'
    );
    // Batched in one transaction — matters for large sends on SQLite.
    const tx = db.transaction((rows) => {
      for (const r of rows) insert.run(campaign.id, r.id, 'queued', '');
    });
    tx(recipients);
    compiledCache.delete(campaign.id);
    return recipients.length;
  }

  function getCompiled(campaign) {
    if (!compiledCache.has(campaign.id)) {
      const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id);
      const blocks = tpl ? safeJsonArr(tpl.blocks_json) : [];
      compiledCache.set(campaign.id, compile(blocks, { enforceFooter: true }));
    }
    return compiledCache.get(campaign.id);
  }

  function safeJsonArr(s) {
    try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }

  // ---------- the loop ----------
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      // promote due scheduled campaigns
      db.prepare(
        `UPDATE campaigns SET status = 'sending', started_at = COALESCE(started_at, datetime('now'))
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')`
      ).run();

      const sending = db.prepare(`SELECT * FROM campaigns WHERE status = 'sending'`).all();
      const settings = getSettings(db);
      const base = getBaseUrl();
      const t = getTransport();

      for (const campaign of sending) {
        const rate = Math.max(1, Number(campaign.throttle_per_min) || 30);
        const credit = (credits.get(campaign.id) || 0) + (rate * TICK_MS) / 60000;
        let allowance = Math.floor(credit);
        credits.set(campaign.id, credit - allowance);
        if (allowance <= 0) continue;

        const rows = db
          .prepare(`SELECT * FROM outbox WHERE campaign_id = ? AND status = 'queued' ORDER BY id LIMIT ?`)
          .all(campaign.id, allowance);

        if (!rows.length) {
          // nothing queued left → campaign finished
          db.prepare(
            `UPDATE campaigns SET status = 'sent', finished_at = datetime('now') WHERE id = ? AND status = 'sending'`
          ).run(campaign.id);
          credits.delete(campaign.id);
          compiledCache.delete(campaign.id);
          continue;
        }
        if (!t) continue; // SMTP unconfigured mid-send — wait

        const compiled = getCompiled(campaign);
        for (const row of rows) {
          // re-check campaign status so pause/cancel takes effect mid-batch
          const cur = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaign.id);
          if (!cur || cur.status !== 'sending') break;

          const sub = db.prepare('SELECT * FROM subscribers WHERE id = ?').get(row.subscriber_id);
          if (!sub || sub.status !== 'subscribed') {
            // suppressed since queueing (unsub/bounce/complaint) — never send
            db.prepare(`UPDATE outbox SET status = 'failed', error = 'suppressed' WHERE id = ?`).run(row.id);
            continue;
          }
          try {
            const msg = buildMessage({ campaign, sub, outboxRow: row, compiled, settings, base });
            await t.sendMail(msg);
            db.prepare(`UPDATE outbox SET status = 'sent', sent_at = datetime('now') WHERE id = ?`).run(row.id);
          } catch (err) {
            const code = err && (err.responseCode || err.code);
            const hard = Number(code) >= 500 && Number(code) < 600;
            if (hard) {
              // SMTP-time 5xx rejection = hard bounce
              db.prepare(`UPDATE outbox SET status = 'bounced', error = ? WHERE id = ?`).run(String(err.message || code), row.id);
              db.prepare(`UPDATE subscribers SET status = 'bounced' WHERE id = ?`).run(sub.id);
              db.prepare(
                `INSERT INTO events (campaign_id, subscriber_id, type) VALUES (?, ?, 'bounce')`
              ).run(campaign.id, sub.id);
            } else {
              db.prepare(`UPDATE outbox SET status = 'failed', error = ? WHERE id = ?`).run(String(err.message || err), row.id);
            }
          }
        }
      }
    } catch (err) {
      console.error('[sender] tick error:', err.message);
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (!timer) {
      timer = setInterval(tick, TICK_MS);
      if (timer.unref) timer.unref();
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (transport) transport.close();
    transport = null;
  }

  async function sendTest({ to, blocks, subject }) {
    const t = getTransport();
    if (!t) throw new Error('SMTP is not configured (Settings → SMTP)');
    const settings = getSettings(db);
    const base = getBaseUrl();
    const compiled = compile(blocks, { enforceFooter: true });
    const extra = {
      unsubUrl: `${base}/unsub/preview`,
      physicalAddress: settings.physical_address || '123 Example St, City, Country'
    };
    const fake = { name: 'Test Recipient', email: to, fields_json: '{}' };
    await t.sendMail({
      from: settings.default_from_email || settings.smtp_user || 'test@localhost',
      to,
      subject: `[TEST] ${subject || 'Postbird test email'}`,
      html: mergeTags(compiled.html, fake, extra),
      text: mergeTags(compiled.text, fake, extra)
    });
  }

  async function verifySmtp() {
    const t = getTransport();
    if (!t) throw new Error('SMTP is not configured');
    await t.verify();
  }

  async function sendSystemMail(msg) {
    const t = getTransport();
    if (!t) throw new Error('SMTP is not configured — set it up in Settings before enabling double opt-in signups');
    await t.sendMail(msg);
  }

  return {
    start,
    stop,
    tick,
    queueCampaign,
    countRecipients,
    listRecipients,
    sendTest,
    verifySmtp,
    sendSystemMail,
    smtpConfigured: () => smtpConfigured(getSettings(db))
  };
}

module.exports = { createSender };
