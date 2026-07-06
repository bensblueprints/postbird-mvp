// HMAC-signed tokens for tracking, confirm and unsubscribe links.
// Format: base64url(payload) + '.' + hmac-sha256(payload).slice(0, 24)
// Payloads are pipe-delimited strings, e.g. "o|123", "c|123|https://x", "u|45", "cf|45".
// Signing prevents forgery/enumeration of event rows (see build plan "Risks").
const crypto = require('crypto');

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function sign(secret, payload) {
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);
  return `${b64url(payload)}.${mac}`;
}

function verify(secret, token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  let payload;
  try {
    payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);
  const given = token.slice(dot + 1);
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return payload.split('|');
}

module.exports = { sign, verify };
