import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, Upload, Download, Trash2, ChevronLeft, Filter, X, Search, ShieldCheck, Globe } from 'lucide-react';
import { api } from '../api.js';
import { Button, Input, Select, Textarea, Card, Badge, statusTone, Modal, Empty } from './ui.jsx';

// ---------------- Import wizard ----------------
function ImportModal({ list, open, onClose, toast, onDone }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/lists/${list.id}/import`, { csv });
      setResult(r);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { setResult(null); setCsv(''); onClose(); }} title={`Import subscribers → ${list?.name}`} wide>
      {!result ? (
        <>
          <p className="text-sm text-zinc-400 mb-3">
            Paste CSV with an <code className="text-indigo-300">email</code> column (a <code className="text-indigo-300">name</code> column and any extra
            columns become custom fields). Duplicates and invalid emails are rejected with a report.
          </p>
          <Textarea rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'email,name,plan\nalice@example.com,Alice,pro\nbob@example.com,Bob,free'} />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={run} loading={busy} disabled={!csv.trim()}>Import</Button>
            <label className="text-sm text-zinc-400 cursor-pointer hover:text-zinc-200">
              …or choose a .csv file
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => {
                const f = e.target.files[0];
                if (f) f.text().then(setCsv);
              }} />
            </label>
          </div>
        </>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Card className="p-4 text-center"><div className="text-3xl font-bold text-emerald-400">{result.imported}</div><div className="text-xs text-zinc-500 mt-1">imported</div></Card>
            <Card className="p-4 text-center"><div className="text-3xl font-bold text-red-400">{result.rejected}</div><div className="text-xs text-zinc-500 mt-1">rejected</div></Card>
          </div>
          {result.rejects.length > 0 && (
            <div className="max-h-48 overflow-y-auto text-sm border border-zinc-800 rounded-lg divide-y divide-zinc-800">
              {result.rejects.map((r, i) => (
                <div key={i} className="px-3 py-2 flex justify-between gap-3">
                  <span className="text-zinc-300 truncate">line {r.line}: {r.email || '(empty)'}</span>
                  <span className="text-zinc-500 shrink-0">{r.reason}</span>
                </div>
              ))}
            </div>
          )}
          <Button className="mt-4" onClick={() => { setResult(null); setCsv(''); onClose(); }}>Done</Button>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Subscriber drawer ----------------
function SubscriberDrawer({ sub, onClose, toast, refresh }) {
  const [activity, setActivity] = useState([]);
  useEffect(() => {
    if (sub) api.get(`/api/subscribers/${sub.id}/activity`).then(setActivity).catch(() => {});
  }, [sub]);
  if (!sub) return null;
  const fields = (() => { try { return JSON.parse(sub.fields_json || '{}'); } catch { return {}; } })();
  return (
    <AnimatePresence>
      <motion.div
        key="drawer"
        initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }}
        transition={{ type: 'tween', duration: 0.2 }}
        className="fixed right-0 top-0 bottom-0 w-[400px] bg-zinc-950 border-l border-zinc-800 z-40 p-6 overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold truncate">{sub.email}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-zinc-500">Status</span><Badge tone={statusTone[sub.status]}>{sub.status}</Badge></div>
          {sub.name && <div className="flex justify-between"><span className="text-zinc-500">Name</span><span>{sub.name}</span></div>}
          <div className="flex justify-between"><span className="text-zinc-500">Added</span><span className="text-zinc-300">{sub.created_at}</span></div>
          {sub.consent_at && <div className="flex justify-between"><span className="text-zinc-500">Consent</span><span className="text-zinc-300">{sub.consent_at}{sub.consent_ip ? ` · ${sub.consent_ip}` : ''}</span></div>}
          {sub.unsub_at && <div className="flex justify-between"><span className="text-zinc-500">Unsubscribed</span><span className="text-zinc-300">{sub.unsub_at}</span></div>}
          {Object.keys(fields).length > 0 && (
            <div className="pt-2">
              <div className="text-xs font-medium text-zinc-500 mb-1">Custom fields</div>
              {Object.entries(fields).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-zinc-500">{k}</span><span className="text-zinc-300">{String(v)}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-6">
          <div className="text-xs font-medium text-zinc-500 mb-2">Activity timeline</div>
          {activity.length === 0 ? (
            <div className="text-sm text-zinc-600">No activity yet.</div>
          ) : (
            <div className="space-y-2">
              {activity.map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-sm">
                  <Badge tone={{ open: 'blue', click: 'indigo', unsub: 'yellow', bounce: 'red', complaint: 'red' }[e.type] || 'zinc'}>{e.type}</Badge>
                  <div className="min-w-0">
                    <div className="text-zinc-300 truncate">{e.campaign_subject || e.url || ''}</div>
                    <div className="text-xs text-zinc-600">{e.created_at}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="danger" className="mt-6"
          onClick={async () => {
            if (!confirm(`Delete ${sub.email}?`)) return;
            await api.del(`/api/subscribers/${sub.id}`).catch((e) => toast(e.message, 'error'));
            onClose(); refresh();
          }}
        >
          <Trash2 size={15} /> Delete subscriber
        </Button>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------- Segment editor ----------------
const FIELD_OPTIONS = [
  { value: 'email_domain', label: 'Email domain is' },
  { value: 'name', label: 'Name contains' },
  { value: 'field', label: 'Custom field equals' },
  { value: 'subscribed_after', label: 'Subscribed after (date)' },
  { value: 'opened_last', label: 'Opened any of last N campaigns' },
  { value: 'clicked_last', label: 'Clicked any of last N campaigns' }
];

export function SegmentEditor({ list, segment, onSaved, onCancel, toast }) {
  const initial = (() => { try { return JSON.parse(segment?.rules_json || '{"op":"AND","rules":[]}'); } catch { return { op: 'AND', rules: [] }; } })();
  const [name, setName] = useState(segment?.name || '');
  const [op, setOp] = useState(initial.op || 'AND');
  const [rules, setRules] = useState(initial.rules?.length ? initial.rules.map((r) => ({
    kind: r.field?.startsWith('field:') ? 'field' : r.field,
    key: r.field?.startsWith('field:') ? r.field.slice(6) : '',
    value: r.value
  })) : [{ kind: 'email_domain', key: '', value: '' }]);
  const [preview, setPreview] = useState(null);

  const toRules = useCallback(() => ({
    op,
    rules: rules.filter((r) => r.kind).map((r) => ({
      field: r.kind === 'field' ? `field:${r.key}` : r.kind,
      cmp: 'auto',
      value: r.value
    }))
  }), [op, rules]);

  useEffect(() => {
    const t = setTimeout(() => {
      api.post('/api/segments/preview', { list_id: list.id, rules: toRules() })
        .then(setPreview).catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [toRules, list.id]);

  const save = async () => {
    if (!name.trim()) return toast('Give the segment a name', 'error');
    try {
      if (segment) await api.put(`/api/segments/${segment.id}`, { name, rules: toRules() });
      else await api.post(`/api/lists/${list.id}/segments`, { name, rules: toRules() });
      onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="flex items-end gap-3 mb-4">
        <div className="flex-1"><Input label="Segment name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gmail power users" /></div>
        <Select label="Match" value={op} onChange={(e) => setOp(e.target.value)} className="w-28">
          <option value="AND">ALL rules</option>
          <option value="OR">ANY rule</option>
        </Select>
      </div>
      <div className="space-y-2 mb-4">
        {rules.map((r, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Select value={r.kind} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, kind: e.target.value } : x))} className="w-64">
              {FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {r.kind === 'field' && (
              <Input value={r.key} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="field name" className="w-36" />
            )}
            <Input
              value={r.value ?? ''}
              onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
              placeholder={{ email_domain: 'gmail.com', name: 'jo', field: 'value', subscribed_after: '2026-01-01', opened_last: '3', clicked_last: '3' }[r.kind]}
              className="flex-1"
            />
            <button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-red-400 p-2"><X size={16} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setRules([...rules, { kind: 'email_domain', key: '', value: '' }])}><Plus size={15} /> Add rule</Button>
        <div className="text-sm text-zinc-400">
          Live count: <span className="font-bold text-indigo-400">{preview ? preview.count : '…'}</span> subscribers
        </div>
      </div>
      {preview?.sample?.length > 0 && (
        <div className="mt-3 text-xs text-zinc-500 truncate">Sample: {preview.sample.map((s) => s.email).join(', ')}</div>
      )}
      <div className="flex gap-2 mt-5">
        <Button onClick={save}>Save segment</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------- List detail ----------------
function ListDetail({ list, back, toast }) {
  const [subs, setSubs] = useState({ total: 0, subscribers: [] });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState({ email: '', name: '' });
  const [segments, setSegments] = useState([]);
  const [segEdit, setSegEdit] = useState(null); // null | 'new' | segment
  const [tab, setTab] = useState('subscribers');

  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    api.get(`/api/lists/${list.id}/subscribers?${params}`).then(setSubs).catch(() => {});
    api.get(`/api/lists/${list.id}/segments`).then(setSegments).catch(() => {});
  }, [list.id, q, status]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <button onClick={back} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-200 mb-3"><ChevronLeft size={16} /> All lists</button>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">{list.name}
            {!!list.double_opt_in && <Badge tone="green"><span className="inline-flex items-center gap-1"><ShieldCheck size={11} /> double opt-in</span></Badge>}
          </h1>
          <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
            <Globe size={12} /> Public signup: <code className="text-indigo-300">POST /api/public/lists/{list.id}/subscribe</code>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => window.open(`/api/lists/${list.id}/export.csv`)}><Download size={15} /> Export</Button>
          <Button variant="subtle" onClick={() => setImportOpen(true)}><Upload size={15} /> Import CSV</Button>
          <Button onClick={() => setAddOpen(true)}><Plus size={15} /> Add subscriber</Button>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-zinc-800">
        {['subscribers', 'segments'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${tab === t ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'subscribers' && (
        <>
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-2.5 text-zinc-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or name…"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
              <option value="">All statuses</option>
              {['subscribed', 'pending', 'unsubscribed', 'bounced', 'complained'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <div className="flex items-center text-sm text-zinc-500 px-2">{subs.total} total</div>
          </div>
          <Card>
            {subs.subscribers.length === 0 ? (
              <Empty icon={Users} title="No subscribers" sub="Import a CSV or add subscribers manually." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.subscribers.map((s) => (
                    <tr key={s.id} onClick={() => setDrawer(s)} className="border-b border-zinc-800/60 hover:bg-zinc-900/60 cursor-pointer">
                      <td className="px-4 py-2.5">{s.email}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{s.name}</td>
                      <td className="px-4 py-2.5"><Badge tone={statusTone[s.status]}>{s.status}</Badge></td>
                      <td className="px-4 py-2.5 text-zinc-500 text-xs">{s.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {tab === 'segments' && (
        <div>
          {segEdit ? (
            <Card className="p-5">
              <SegmentEditor
                list={list}
                segment={segEdit === 'new' ? null : segEdit}
                toast={toast}
                onSaved={() => { setSegEdit(null); refresh(); toast('Segment saved'); }}
                onCancel={() => setSegEdit(null)}
              />
            </Card>
          ) : (
            <>
              <Button className="mb-3" onClick={() => setSegEdit('new')}><Plus size={15} /> New segment</Button>
              {segments.length === 0 ? (
                <Card><Empty icon={Filter} title="No segments" sub="Segments are saved filters — target Gmail users, recent openers, custom fields…" /></Card>
              ) : (
                <Card className="divide-y divide-zinc-800">
                  {segments.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-4 py-3">
                      <button onClick={() => setSegEdit(s)} className="font-medium hover:text-indigo-300 text-left">{s.name}</button>
                      <button onClick={async () => { if (confirm('Delete segment?')) { await api.del(`/api/segments/${s.id}`); refresh(); } }}
                        className="text-zinc-600 hover:text-red-400"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </Card>
              )}
            </>
          )}
        </div>
      )}

      <ImportModal list={list} open={importOpen} onClose={() => setImportOpen(false)} toast={toast} onDone={refresh} />
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add subscriber">
        <div className="space-y-3">
          <Input label="Email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} placeholder="person@example.com" />
          <Input label="Name (optional)" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <p className="text-xs text-zinc-500">Manually added subscribers are marked consented by you, the operator — only add people who gave you permission.</p>
          <Button onClick={async () => {
            try {
              await api.post(`/api/lists/${list.id}/subscribers`, add);
              setAddOpen(false); setAdd({ email: '', name: '' }); refresh(); toast('Subscriber added');
            } catch (e) { toast(e.message, 'error'); }
          }}>Add</Button>
        </div>
      </Modal>
      {drawer && <SubscriberDrawer sub={drawer} onClose={() => setDrawer(null)} toast={toast} refresh={refresh} />}
    </div>
  );
}

// ---------------- Lists index ----------------
export default function Lists({ toast }) {
  const [lists, setLists] = useState([]);
  const [active, setActive] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', double_opt_in: true, from_name: '', from_email: '' });

  const refresh = useCallback(() => api.get('/api/lists').then(setLists).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);

  if (active) return <ListDetail list={active} back={() => { setActive(null); refresh(); }} toast={toast} />;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Lists</h1>
        <Button onClick={() => setCreateOpen(true)}><Plus size={15} /> New list</Button>
      </div>
      {lists.length === 0 ? (
        <Card><Empty icon={Users} title="No lists yet" sub="A list is an audience. Create one, then import or collect subscribers.">
          <Button onClick={() => setCreateOpen(true)}><Plus size={15} /> Create your first list</Button>
        </Empty></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {lists.map((l) => (
            <Card key={l.id} className="p-5 hover:border-zinc-600 transition-colors cursor-pointer" >
              <div onClick={() => setActive(l)}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{l.name}</h3>
                  {!!l.double_opt_in && <Badge tone="green">double opt-in</Badge>}
                </div>
                <div className="text-3xl font-bold">{l.counts.subscribed || 0}</div>
                <div className="text-xs text-zinc-500 mb-3">active subscribers</div>
                <div className="flex gap-2 flex-wrap">
                  {['pending', 'unsubscribed', 'bounced', 'complained'].map((s) => (l.counts[s] ? <Badge key={s} tone={statusTone[s]}>{l.counts[s]} {s}</Badge> : null))}
                </div>
              </div>
              <div className="flex justify-end mt-2">
                <button onClick={async (e) => { e.stopPropagation(); if (confirm(`Delete list "${l.name}" and all its subscribers?`)) { await api.del(`/api/lists/${l.id}`); refresh(); } }}
                  className="text-zinc-600 hover:text-red-400"><Trash2 size={15} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New list">
        <div className="space-y-3">
          <Input label="List name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Newsletter" autoFocus />
          <Input label="Default from name" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="Ben from Postbird" />
          <Input label="Default from email" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} placeholder="ben@yourdomain.com" />
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={form.double_opt_in} onChange={(e) => setForm({ ...form, double_opt_in: e.target.checked })} className="accent-indigo-500" />
            Double opt-in (recommended — new signups confirm by email before receiving campaigns)
          </label>
          <Button onClick={async () => {
            try {
              await api.post('/api/lists', { ...form, double_opt_in: form.double_opt_in ? 1 : 0 });
              setCreateOpen(false); setForm({ name: '', double_opt_in: true, from_name: '', from_email: '' }); refresh();
            } catch (e) { toast(e.message, 'error'); }
          }}>Create list</Button>
        </div>
      </Modal>
    </motion.div>
  );
}
