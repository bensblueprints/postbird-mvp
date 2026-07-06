// Smoke test: boots the real server + a local SMTP capture server, then walks the
// full product loop: auth → double opt-in → CSV import → builder render →
// compliance send-block → throttled campaign send (unsub link, physical address,
// RFC 8058 headers asserted on the wire) → open/click tracking → unsubscribe
// suppression → bounce webhook.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TEST_PORT = 5398;
const SMTP_PORT = 5399;
const ADMIN_PASSWORD = 'smoke-test-password';
const DB_PATH = path.join(__dirname, 'smoke.db');
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const PHYSICAL_ADDRESS = '742 Evergreen Terrace, Springfield, USA';

for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

let serverProc = null;
let smtp = null;
const captured = []; // { to: [...], raw: '...' }

function startSmtp() {
  return new Promise((resolve) => {
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, session, cb) {
        let raw = '';
        stream.on('data', (d) => (raw += d.toString('utf8')));
        stream.on('end', () => {
          captured.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
          cb();
        });
      }
    });
    smtp.listen(SMTP_PORT, '127.0.0.1', resolve);
  });
}

async function waitFor(fn, label, tries = 60, delay = 250) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let cookie = '';
async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    redirect: 'manual',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

// decode quoted-printable bodies so URLs with '=' survive extraction
function decodeQp(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function mailsFor(email) {
  return captured.filter((m) => m.to.includes(email));
}

async function main() {
  console.log('1. Starting SMTP capture server on port', SMTP_PORT, 'and Postbird on port', TEST_PORT);
  await startSmtp();
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      ADMIN_PASSWORD,
      DB_PATH,
      DATA_DIR: __dirname,
      BASE_URL: BASE
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`   [server] ${d}`));

  await waitFor(async () => (await api('/api/health')).data.ok, 'server health');

  console.log('2. Auth gates: admin API requires login');
  cookie = '';
  const unauth = await api('/api/lists');
  assert.strictEqual(unauth.status, 401, 'admin API must 401 without auth');
  const bad = await api('/api/login', { method: 'POST', body: { password: 'wrong' } });
  assert.strictEqual(bad.status, 401, 'wrong password must 401');
  cookie = '';
  const good = await api('/api/login', { method: 'POST', body: { password: ADMIN_PASSWORD } });
  assert.strictEqual(good.status, 200, 'login must succeed');

  console.log('3. Configure SMTP + sender physical address via settings API');
  const set = await api('/api/settings', {
    method: 'PUT',
    body: {
      smtp_host: '127.0.0.1',
      smtp_port: String(SMTP_PORT),
      smtp_secure: '0',
      physical_address: PHYSICAL_ADDRESS,
      default_from_name: 'Smoke Sender',
      default_from_email: 'sender@postbird.test'
    }
  });
  assert.strictEqual(set.status, 200);

  console.log('4. Double opt-in: create list, public subscribe → pending → confirm → subscribed');
  const list = await api('/api/lists', { method: 'POST', body: { name: 'Smoke List', double_opt_in: 1 } });
  assert.strictEqual(list.status, 201);
  const listId = list.data.id;

  const sub = await api(`/api/public/lists/${listId}/subscribe`, {
    method: 'POST',
    body: { email: 'optin@postbird.test', name: 'Opt In' }
  });
  assert.strictEqual(sub.status, 200);
  assert.strictEqual(sub.data.status, 'pending', 'double opt-in signup must be pending');

  let subs = await api(`/api/lists/${listId}/subscribers`);
  assert.strictEqual(subs.data.subscribers[0].status, 'pending', 'row must be pending in DB');

  const confMail = await waitFor(() => mailsFor('optin@postbird.test')[0], 'confirmation email captured');
  const confBody = decodeQp(confMail.raw);
  const confUrl = confBody.match(new RegExp(`${BASE.replace(/[/:.]/g, '\\$&')}/confirm/[A-Za-z0-9_.-]+`));
  assert.ok(confUrl, 'confirmation email must contain a confirm link');
  const confRes = await fetch(confUrl[0]);
  assert.strictEqual(confRes.status, 200, 'confirm link must render confirmation page');

  subs = await api(`/api/lists/${listId}/subscribers`);
  const confirmed = subs.data.subscribers.find((s) => s.email === 'optin@postbird.test');
  assert.strictEqual(confirmed.status, 'subscribed', 'confirmed subscriber must be subscribed');
  assert.ok(confirmed.consent_at, 'consent_at must be set on confirm');

  console.log('5. CSV import: 3 rows, 1 invalid → {imported:2, rejected:1}');
  const imp = await api(`/api/lists/${listId}/import`, {
    method: 'POST',
    body: {
      csv: 'email,name,plan\nalice@postbird.test,Alice,pro\nbob@postbird.test,Bob,free\nnot-an-email,Nope,x\n'
    }
  });
  assert.strictEqual(imp.status, 200);
  assert.strictEqual(imp.data.imported, 2, 'must import 2 valid rows');
  assert.strictEqual(imp.data.rejected, 1, 'must reject 1 invalid email');

  console.log('6. Builder: template renders table-based email-safe HTML + text alternative');
  const tpl = await api('/api/templates', {
    method: 'POST',
    body: {
      name: 'Smoke Template',
      blocks: [
        { type: 'heading', text: 'Hello {{name}}' },
        { type: 'text', text: 'Big news — check **this** out.' },
        { type: 'button', text: 'Visit the site', href: 'https://example.com/landing' },
        { type: 'footer', text: 'You are receiving this because you subscribed.' }
      ]
    }
  });
  assert.strictEqual(tpl.status, 201);
  const tplId = tpl.data.id;
  const rendered = await api(`/api/templates/${tplId}/render`, { method: 'POST', body: {} });
  assert.strictEqual(rendered.status, 200);
  assert.ok(rendered.data.html.includes('<table'), 'HTML must be table-based');
  for (const banned of ['display:flex', 'display: flex', 'display:grid', 'display: grid', 'position:absolute']) {
    assert.ok(!rendered.data.html.includes(banned), `HTML must not contain banned property ${banned}`);
  }
  assert.ok(rendered.data.html.includes('{{unsubscribe_url}}'), 'render keeps unsubscribe merge tag for send-time resolution');
  assert.ok(rendered.data.text.trim().length > 0, 'plain-text alternative must be non-empty');

  console.log('7. Compliance block: sending without a physical address must 400');
  await api('/api/settings', { method: 'PUT', body: { physical_address: '' } });
  const camp = await api('/api/campaigns', {
    method: 'POST',
    body: {
      list_id: listId,
      template_id: tplId,
      subject: 'Smoke blast for {{name}}',
      from_name: 'Smoke Sender',
      from_email: 'sender@postbird.test',
      throttle_per_min: 6000
    }
  });
  assert.strictEqual(camp.status, 201);
  const campId = camp.data.id;
  const blocked = await api(`/api/campaigns/${campId}/send`, { method: 'POST' });
  assert.strictEqual(blocked.status, 400, 'send with empty physical address must be blocked');
  assert.ok(/physical/i.test(blocked.data.error), 'error must mention the physical address');
  await api('/api/settings', { method: 'PUT', body: { physical_address: PHYSICAL_ADDRESS } });

  console.log('8. Send campaign (throttle high) → all messages captured with compliance parts');
  captured.length = 0;
  const sendRes = await api(`/api/campaigns/${campId}/send`, { method: 'POST' });
  assert.strictEqual(sendRes.status, 200, `send must start: ${JSON.stringify(sendRes.data)}`);
  assert.strictEqual(sendRes.data.queued, 3, 'must queue 3 subscribed recipients');

  await waitFor(async () => (await api(`/api/campaigns/${campId}`)).data.status === 'sent', 'campaign sent', 120);
  assert.strictEqual(captured.length, 3, 'SMTP capture must receive 3 messages');
  for (const m of captured) {
    const body = decodeQp(m.raw);
    assert.ok(body.includes(PHYSICAL_ADDRESS), 'each email must contain the physical address');
    assert.ok(body.includes('/unsub/'), 'each email must contain an unsubscribe link');
    assert.ok(/^List-Unsubscribe:/im.test(m.raw), 'List-Unsubscribe header required');
    assert.ok(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click/im.test(m.raw), 'RFC 8058 one-click header required');
  }

  console.log('9. Tracking: open pixel + click redirect land event rows, report reflects them');
  const sample = decodeQp(mailsFor('alice@postbird.test')[0].raw);
  const pixelUrl = sample.match(new RegExp(`${BASE.replace(/[/:.]/g, '\\$&')}/t/o/[A-Za-z0-9_.-]+\\.gif`));
  assert.ok(pixelUrl, 'email must contain the open pixel');
  const pixelRes = await fetch(pixelUrl[0]);
  assert.strictEqual(pixelRes.status, 200);
  assert.strictEqual(pixelRes.headers.get('content-type'), 'image/gif');

  const clickUrl = sample.match(new RegExp(`${BASE.replace(/[/:.]/g, '\\$&')}/t/c/[A-Za-z0-9_.-]+`));
  assert.ok(clickUrl, 'email must contain a rewritten click-tracking link');
  const clickRes = await fetch(clickUrl[0], { redirect: 'manual' });
  assert.strictEqual(clickRes.status, 302, 'click must 302');
  assert.strictEqual(clickRes.headers.get('location'), 'https://example.com/landing', 'click must redirect to the original URL');

  const report = await waitFor(async () => {
    const r = await api(`/api/campaigns/${campId}/report`);
    return r.data.campaign.opens_unique === 1 && r.data.campaign.clicks_unique === 1 ? r : null;
  }, 'report shows opens=1 clicks=1');
  assert.strictEqual(report.data.campaign.opens_unique, 1);
  assert.strictEqual(report.data.campaign.clicks_unique, 1);
  assert.strictEqual(report.data.urls[0].url, 'https://example.com/landing');

  console.log('10. Unsubscribe: link works instantly + suppressed from next send (no outbox row)');
  const unsubUrl = sample.match(new RegExp(`${BASE.replace(/[/:.]/g, '\\$&')}/unsub/[A-Za-z0-9_.-]+`));
  assert.ok(unsubUrl, 'email must contain unsub link');
  const unsubRes = await fetch(unsubUrl[0]);
  assert.strictEqual(unsubRes.status, 200, 'unsub page must render');

  subs = await api(`/api/lists/${listId}/subscribers`);
  const alice = subs.data.subscribers.find((s) => s.email === 'alice@postbird.test');
  assert.strictEqual(alice.status, 'unsubscribed', 'alice must be unsubscribed immediately');

  captured.length = 0;
  const camp2 = await api('/api/campaigns', {
    method: 'POST',
    body: { list_id: listId, template_id: tplId, subject: 'Second blast', from_email: 'sender@postbird.test', throttle_per_min: 6000 }
  });
  const send2 = await api(`/api/campaigns/${camp2.data.id}/send`, { method: 'POST' });
  assert.strictEqual(send2.status, 200);
  assert.strictEqual(send2.data.queued, 2, 'second send must exclude the unsubscribed recipient');
  await waitFor(async () => (await api(`/api/campaigns/${camp2.data.id}`)).data.status === 'sent', 'second campaign sent', 120);
  assert.strictEqual(captured.length, 2, 'unsubscribed recipient must not receive mail');
  assert.ok(!captured.some((m) => m.to.includes('alice@postbird.test')), 'no message to alice');

  const rep2 = await api(`/api/campaigns/${camp2.data.id}/report`);
  assert.ok(!rep2.data.recipients.some((r) => r.email === 'alice@postbird.test'), 'outbox must have no row for the unsubscribed recipient');

  console.log('11. Bounce webhook: generic payload → status bounced');
  const bounce = await api('/api/hooks/bounce', {
    method: 'POST',
    body: { email: 'bob@postbird.test', type: 'bounce' }
  });
  assert.strictEqual(bounce.status, 200);
  assert.ok(bounce.data.updated >= 1, 'bounce hook must update at least one subscriber');
  subs = await api(`/api/lists/${listId}/subscribers`);
  const bob = subs.data.subscribers.find((s) => s.email === 'bob@postbird.test');
  assert.strictEqual(bob.status, 'bounced', 'bob must be bounced');

  console.log('\nSMOKE TEST PASSED ✔  (auth, double opt-in, import, builder HTML, compliance block, throttled send w/ RFC 8058 headers, open/click tracking, unsubscribe suppression, bounce hook)');
}

main()
  .then(() => cleanup(0))
  .catch((err) => {
    console.error('\nSMOKE TEST FAILED ✖');
    console.error(err);
    cleanup(1);
  });

function cleanup(code) {
  try { serverProc?.kill(); } catch { /* ignore */ }
  try { smtp?.close(); } catch { /* ignore */ }
  setTimeout(() => {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', path.join(__dirname, 'secret.key')]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    try { fs.rmSync(path.join(__dirname, 'uploads'), { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(code);
  }, 300);
}
