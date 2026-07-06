// Small dependency-free CSV parser (handles quoted fields, CRLF, embedded commas).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Returns { imported, rejected, rejects: [{line, email, reason}] }
// First row may be a header (detected by an "email" column); columns other than
// email/name become custom fields (stored as JSON).
function importCsv(db, listId, csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { imported: 0, rejected: 0, rejects: [] };

  let header = rows[0].map((h) => h.trim().toLowerCase());
  let start = 0;
  let emailIdx = header.indexOf('email');
  let nameIdx = header.indexOf('name');
  if (emailIdx !== -1) {
    start = 1;
  } else {
    header = null;
    emailIdx = 0;
    nameIdx = 1;
  }

  const insert = db.prepare(
    `INSERT INTO subscribers (list_id, email, name, fields_json, status, consent_at)
     VALUES (?, ?, ?, ?, 'subscribed', datetime('now'))`
  );
  const exists = db.prepare('SELECT id FROM subscribers WHERE list_id = ? AND email = ?');

  let imported = 0;
  const rejects = [];
  const seen = new Set();

  const tx = db.transaction(() => {
    for (let i = start; i < rows.length; i++) {
      const cols = rows[i];
      const email = String(cols[emailIdx] || '').trim().toLowerCase();
      const name = nameIdx >= 0 ? String(cols[nameIdx] || '').trim() : '';
      if (!EMAIL_RE.test(email)) {
        rejects.push({ line: i + 1, email, reason: 'invalid email' });
        continue;
      }
      if (seen.has(email)) {
        rejects.push({ line: i + 1, email, reason: 'duplicate in file' });
        continue;
      }
      seen.add(email);
      if (exists.get(listId, email)) {
        rejects.push({ line: i + 1, email, reason: 'already on list' });
        continue;
      }
      const fields = {};
      if (header) {
        header.forEach((h, idx) => {
          if (idx !== emailIdx && idx !== nameIdx && h) fields[h] = String(cols[idx] ?? '').trim();
        });
      }
      insert.run(listId, email, name, JSON.stringify(fields));
      imported++;
    }
  });
  tx();

  return { imported, rejected: rejects.length, rejects };
}

module.exports = { parseCsv, importCsv, EMAIL_RE };
