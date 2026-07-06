// Segment rules → SQL WHERE clause (parameterized).
// rules_json shape: { op: 'AND'|'OR', rules: [{ field, cmp, value }] }
// Fields:
//   email_domain      cmp: equals            → substr of email after '@'
//   name              cmp: contains
//   field:<key>       cmp: equals            → JSON custom field
//   subscribed_after  cmp: after             → consent_at > date
//   opened_last       cmp: any_of_last_n     → opened any of the list's last N campaigns
//   clicked_last      cmp: any_of_last_n     → clicked any of the list's last N campaigns
function compileRules(rulesJson) {
  let parsed;
  try {
    parsed = typeof rulesJson === 'string' ? JSON.parse(rulesJson) : rulesJson;
  } catch {
    parsed = null;
  }
  const op = parsed && parsed.op === 'OR' ? 'OR' : 'AND';
  const rules = (parsed && Array.isArray(parsed.rules) ? parsed.rules : []).filter(Boolean);
  const clauses = [];
  const params = [];

  for (const r of rules) {
    const field = String(r.field || '');
    const value = r.value;
    if (field === 'email_domain') {
      clauses.push(`lower(substr(s.email, instr(s.email, '@') + 1)) = lower(?)`);
      params.push(String(value || ''));
    } else if (field === 'name') {
      clauses.push(`s.name LIKE ?`);
      params.push(`%${String(value || '')}%`);
    } else if (field.startsWith('field:')) {
      const key = field.slice(6);
      clauses.push(`json_extract(s.fields_json, ?) = ?`);
      params.push(`$.${key}`, String(value ?? ''));
    } else if (field === 'subscribed_after') {
      clauses.push(`s.consent_at IS NOT NULL AND s.consent_at > ?`);
      params.push(String(value || ''));
    } else if (field === 'opened_last' || field === 'clicked_last') {
      const n = Math.max(1, Math.min(50, Number(value) || 1));
      const type = field === 'opened_last' ? 'open' : 'click';
      clauses.push(
        `s.id IN (SELECT e.subscriber_id FROM events e WHERE e.type = '${type}' AND e.campaign_id IN ` +
          `(SELECT c.id FROM campaigns c WHERE c.list_id = s.list_id AND c.status = 'sent' ORDER BY c.id DESC LIMIT ${n}))`
      );
    }
  }

  if (!clauses.length) return { where: '1=1', params: [] };
  return { where: `(${clauses.join(` ${op} `)})`, params };
}

module.exports = { compileRules };
