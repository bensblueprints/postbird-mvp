import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Send, Plus, ChevronLeft, CheckCircle2, XCircle, Pause, Play, Ban, Trash2,
  BarChart3, Link2, Users, MailOpen, MousePointerClick, UserMinus, Clock
} from 'lucide-react';
import { api } from '../api.js';
import { Button, Input, Select, Card, Badge, statusTone, Empty } from './ui.jsx';

// ---------------- Report ----------------
function Report({ campaignId, back }) {
  const [report, setReport] = useState(null);

  useEffect(() => {
    const load = () => api.get(`/api/campaigns/${campaignId}/report`).then(setReport).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [campaignId]);

  if (!report) return null;
  const c = report.campaign;
  const sent = c.outbox?.sent || 0;
  const total = Object.values(c.outbox || {}).reduce((a, b) => a + b, 0);
  const pct = (n) => (sent ? `${Math.round((n / sent) * 100)}%` : '—');

  const funnel = [
    { label: 'Recipients', value: total, icon: Users },
    { label: 'Delivered', value: sent, icon: Send },
    { label: 'Unique opens', value: c.opens_unique, sub: pct(c.opens_unique), icon: MailOpen },
    { label: 'Unique clicks', value: c.clicks_unique, sub: pct(c.clicks_unique), icon: MousePointerClick },
    { label: 'Unsubscribes', value: report.unsubs, icon: UserMinus }
  ];

  return (
    <div>
      <button onClick={back} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-200 mb-3"><ChevronLeft size={16} /> All campaigns</button>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">{c.subject || `Campaign #${c.id}`}</h1>
        <Badge tone={statusTone[c.status]}>{c.status}</Badge>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {funnel.map((f) => (
          <Card key={f.label} className="p-4">
            <f.icon size={16} className="text-indigo-400 mb-2" />
            <div className="text-2xl font-bold">{f.value}{f.sub && <span className="text-sm font-normal text-zinc-500 ml-1.5">{f.sub}</span>}</div>
            <div className="text-xs text-zinc-500">{f.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="font-semibold text-zinc-300 mb-3 flex items-center gap-2"><Link2 size={16} /> Clicked links</h2>
          <Card>
            {report.urls.length === 0 ? (
              <Empty icon={MousePointerClick} title="No clicks yet" />
            ) : (
              <div className="divide-y divide-zinc-800">
                {report.urls.map((u, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-indigo-300 truncate">{u.url}</span>
                    <span className="text-xs text-zinc-400 shrink-0">{u.unique_clicks} unique · {u.total} total</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
        <div>
          <h2 className="font-semibold text-zinc-300 mb-3 flex items-center gap-2"><Users size={16} /> Recipient activity</h2>
          <Card className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-900">
                <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Opens</th>
                  <th className="px-4 py-2.5 font-medium text-right">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {report.recipients.map((r) => (
                  <tr key={r.outbox_id} className="border-b border-zinc-800/60">
                    <td className="px-4 py-2 truncate max-w-[220px]">{r.email}</td>
                    <td className="px-4 py-2"><Badge tone={statusTone[r.status]}>{r.status}</Badge></td>
                    <td className="px-4 py-2 text-right text-zinc-400">{r.opens}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{r.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------- Wizard ----------------
function Wizard({ back, toast, onSent, existing }) {
  const [step, setStep] = useState(0);
  const [lists, setLists] = useState([]);
  const [segments, setSegments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [settings, setSettings] = useState(null);
  const [preview, setPreview] = useState('');
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [c, setC] = useState(existing || {
    list_id: '', segment_id: '', template_id: '', subject: '',
    from_name: '', from_email: '', reply_to: '', throttle_per_min: 30
  });

  useEffect(() => {
    api.get('/api/lists').then(setLists);
    api.get('/api/templates').then(setTemplates);
    api.get('/api/settings').then(setSettings);
  }, []);

  useEffect(() => {
    if (c.list_id) api.get(`/api/lists/${c.list_id}/segments`).then(setSegments);
    else setSegments([]);
  }, [c.list_id]);

  useEffect(() => {
    if (!c.list_id) return setCount(null);
    const seg = segments.find((s) => s.id === Number(c.segment_id));
    api.post('/api/segments/preview', {
      list_id: Number(c.list_id),
      rules: seg ? JSON.parse(seg.rules_json) : { op: 'AND', rules: [] }
    }).then((r) => setCount(r.count)).catch(() => setCount(null));
  }, [c.list_id, c.segment_id, segments]);

  useEffect(() => {
    if (step === 2 && c.template_id) {
      api.post(`/api/templates/${c.template_id}/render`, {}).then((r) => setPreview(r.html)).catch(() => {});
      api.get('/api/settings').then(setSettings);
    }
  }, [step, c.template_id]);

  const list = lists.find((l) => l.id === Number(c.list_id));
  const canAudience = !!c.list_id;
  const canContent = !!(c.template_id && c.subject.trim() && (c.from_email || settings?.default_from_email));

  const checklist = settings ? [
    { ok: !!settings.physical_address?.trim(), label: 'Physical mailing address set (CAN-SPAM)', fix: 'Settings → Compliance' },
    { ok: !!settings.smtp_host?.trim(), label: 'SMTP configured', fix: 'Settings → SMTP' },
    { ok: true, label: 'Unsubscribe link + List-Unsubscribe headers (added automatically to every send)' },
    { ok: true, label: 'Compliance footer enforced (non-removable)' },
    { ok: (count ?? 0) > 0, label: `${count ?? '…'} subscribed recipients in audience` }
  ] : [];
  const allOk = checklist.every((x) => x.ok);

  const doSend = async () => {
    setBusy(true);
    try {
      const body = { ...c, list_id: Number(c.list_id), template_id: Number(c.template_id), segment_id: c.segment_id ? Number(c.segment_id) : null };
      const created = existing?.id ? await api.put(`/api/campaigns/${existing.id}`, body) : await api.post('/api/campaigns', body);
      const res = await api.post(`/api/campaigns/${created.id}/send`, schedule ? { scheduled_at: schedule.replace('T', ' ') + ':00' } : {});
      toast(res.scheduled ? 'Campaign scheduled' : `Sending to ${res.queued} recipients`);
      onSent(created.id);
    } catch (e) {
      toast(e.message, 'error');
    } finally { setBusy(false); }
  };

  const steps = ['Audience', 'Content', 'Review & send'];

  return (
    <div>
      <button onClick={back} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-200 mb-3"><ChevronLeft size={16} /> All campaigns</button>
      <h1 className="text-2xl font-bold mb-5">New campaign</h1>
      <div className="flex gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${i === step ? 'bg-indigo-600/15 text-indigo-300' : i < step ? 'text-emerald-400' : 'text-zinc-600'}`}>
            {i < step ? <CheckCircle2 size={15} /> : <span className="w-5 h-5 rounded-full border border-current text-[11px] flex items-center justify-center">{i + 1}</span>}
            {s}
          </div>
        ))}
      </div>

      <Card className="p-6 max-w-2xl">
        {step === 0 && (
          <div className="space-y-4">
            <Select label="List" value={c.list_id} onChange={(e) => setC({ ...c, list_id: e.target.value, segment_id: '' })}>
              <option value="">Choose a list…</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.counts.subscribed || 0} subscribed)</option>)}
            </Select>
            <Select label="Segment (optional)" value={c.segment_id} onChange={(e) => setC({ ...c, segment_id: e.target.value })} disabled={!c.list_id}>
              <option value="">Entire list</option>
              {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            {count !== null && <p className="text-sm text-zinc-400">Audience: <span className="font-bold text-indigo-400">{count}</span> subscribed recipients (pending, unsubscribed, bounced and complained are always excluded).</p>}
            <Button disabled={!canAudience} onClick={() => setStep(1)}>Next: content</Button>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <Select label="Template" value={c.template_id} onChange={(e) => setC({ ...c, template_id: e.target.value })}>
              <option value="">Choose a template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <Input label="Subject" value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} placeholder="Supports {{name}} merge tags" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="From name" value={c.from_name} onChange={(e) => setC({ ...c, from_name: e.target.value })} placeholder={list?.from_name || settings?.default_from_name || ''} />
              <Input label="From email" value={c.from_email} onChange={(e) => setC({ ...c, from_email: e.target.value })} placeholder={list?.from_email || settings?.default_from_email || 'you@yourdomain.com'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Reply-to (optional)" value={c.reply_to} onChange={(e) => setC({ ...c, reply_to: e.target.value })} />
              <Input label="Throttle (emails/minute)" type="number" min="1" value={c.throttle_per_min} onChange={(e) => setC({ ...c, throttle_per_min: e.target.value })} />
            </div>
            <p className="text-xs text-zinc-500">Throttle default 30/min is safe for most SMTP providers. Check your provider's rate limits (SES/Postmark/Gmail guidance in the README).</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <Button disabled={!canContent} onClick={() => setStep(2)}>Next: review</Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Compliance checklist</h3>
              <div className="space-y-1.5">
                {checklist.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {item.ok ? <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 shrink-0" /> : <XCircle size={16} className="text-red-400 mt-0.5 shrink-0" />}
                    <span className={item.ok ? 'text-zinc-300' : 'text-red-300'}>{item.label}{!item.ok && item.fix && <span className="text-zinc-500"> — fix in {item.fix}</span>}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-zinc-800 rounded-lg overflow-hidden">
              <iframe title="preview" srcDoc={preview} className="w-full bg-white" style={{ height: 320 }} />
            </div>
            <Input label="Schedule for later (optional — leave empty to send now)" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!allOk} loading={busy} onClick={doSend}>
                {schedule ? <><Clock size={15} /> Schedule campaign</> : <><Send size={15} /> Send now</>}
              </Button>
            </div>
            {!allOk && <p className="text-xs text-red-400">Sending is blocked until every compliance item passes.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------- Index ----------------
export default function Campaigns({ toast, openReport }) {
  const [campaigns, setCampaigns] = useState([]);
  const [view, setView] = useState(openReport ? { report: openReport } : null); // null | {wizard} | {report:id}

  const refresh = useCallback(() => api.get('/api/campaigns').then(setCampaigns).catch(() => {}), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  if (view?.wizard) return <Wizard back={() => setView(null)} toast={toast} onSent={(id) => setView({ report: id })} />;
  if (view?.report) return <Report campaignId={view.report} back={() => { setView(null); refresh(); }} />;

  const act = async (id, action) => {
    try { await api.post(`/api/campaigns/${id}/${action}`); refresh(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <Button onClick={() => setView({ wizard: true })}><Plus size={15} /> New campaign</Button>
      </div>
      {campaigns.length === 0 ? (
        <Card><Empty icon={Send} title="No campaigns yet" sub="Pick an audience, choose a template, pass the compliance checklist, hit send.">
          <Button onClick={() => setView({ wizard: true })}><Plus size={15} /> Create campaign</Button>
        </Empty></Card>
      ) : (
        <Card className="divide-y divide-zinc-800">
          {campaigns.map((cp) => {
            const total = Object.values(cp.outbox || {}).reduce((a, b) => a + b, 0);
            const done = (cp.outbox?.sent || 0) + (cp.outbox?.failed || 0) + (cp.outbox?.bounced || 0);
            const progress = total ? Math.round((done / total) * 100) : 0;
            return (
              <div key={cp.id} className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setView({ report: cp.id })} className="flex-1 min-w-0 text-left">
                    <div className="font-medium truncate hover:text-indigo-300">{cp.subject || `Campaign #${cp.id}`}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {cp.created_at}{cp.scheduled_at ? ` · scheduled ${cp.scheduled_at}` : ''} · {cp.opens_unique} opens · {cp.clicks_unique} clicks
                    </div>
                  </button>
                  <Badge tone={statusTone[cp.status]}>{cp.status}</Badge>
                  {cp.status === 'sending' && <Button variant="subtle" onClick={() => act(cp.id, 'pause')}><Pause size={14} /></Button>}
                  {cp.status === 'paused' && <Button variant="subtle" onClick={() => act(cp.id, 'send')}><Play size={14} /></Button>}
                  {['sending', 'paused', 'scheduled'].includes(cp.status) && <Button variant="danger" onClick={() => { if (confirm('Cancel this campaign?')) act(cp.id, 'cancel'); }}><Ban size={14} /></Button>}
                  {['draft', 'sent', 'canceled'].includes(cp.status) && (
                    <button onClick={async () => { if (confirm('Delete campaign?')) { await api.del(`/api/campaigns/${cp.id}`).catch((e) => toast(e.message, 'error')); refresh(); } }}
                      className="text-zinc-600 hover:text-red-400 p-1.5"><Trash2 size={15} /></button>
                  )}
                  <button onClick={() => setView({ report: cp.id })} className="text-zinc-500 hover:text-indigo-300 p-1.5"><BarChart3 size={16} /></button>
                </div>
                {['sending', 'paused'].includes(cp.status) && total > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div className="h-full bg-indigo-500" animate={{ width: `${progress}%` }} transition={{ duration: 0.6 }} />
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">{done} / {total} sent ({progress}%)</div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </motion.div>
  );
}
