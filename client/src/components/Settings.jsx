import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Server, ShieldCheck, Globe, Webhook, Save, PlugZap } from 'lucide-react';
import { api } from '../api.js';
import { Button, Input, Select, Textarea, Card } from './ui.jsx';

export default function Settings({ toast }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => { api.get('/api/settings').then(setS).catch(() => {}); }, []);
  if (!s) return null;

  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.put('/api/settings', s);
      setS(saved);
      toast('Settings saved');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <Button onClick={save} loading={busy}><Save size={15} /> Save all</Button>
      </div>

      <Card className="p-6 mb-5">
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Server size={17} className="text-indigo-400" /> SMTP (bring your own)</h2>
        <p className="text-xs text-zinc-500 mb-4">Any SMTP provider works — Amazon SES, Postmark, Mailgun, Brevo, even Gmail (500/day cap). Deliverability is your provider's job; Postbird handles everything else.</p>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="col-span-2"><Input label="Host" value={s.smtp_host} onChange={set('smtp_host')} placeholder="email-smtp.us-east-1.amazonaws.com" /></div>
          <Input label="Port" value={s.smtp_port} onChange={set('smtp_port')} placeholder="587" />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Input label="Username" value={s.smtp_user} onChange={set('smtp_user')} autoComplete="off" />
          <Input label="Password" type="password" value={s.smtp_pass} onChange={set('smtp_pass')} autoComplete="new-password" />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <Select label="TLS" value={s.smtp_secure} onChange={set('smtp_secure')}>
            <option value="0">STARTTLS (port 587)</option>
            <option value="1">Implicit TLS (port 465)</option>
          </Select>
          <Select label="Connection pool" value={s.smtp_pool_size} onChange={set('smtp_pool_size')}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n} connection{n > 1 ? 's' : ''}</option>)}
          </Select>
        </div>
        <Button variant="subtle" loading={testBusy} onClick={async () => {
          setTestBusy(true);
          try {
            await api.put('/api/settings', s);
            await api.post('/api/settings/smtp-test');
            toast('SMTP connection verified ✔');
          } catch (e) { toast(e.message, 'error'); } finally { setTestBusy(false); }
        }}><PlugZap size={15} /> Test connection</Button>
      </Card>

      <Card className="p-6 mb-5 border-amber-500/20">
        <h2 className="font-semibold mb-1 flex items-center gap-2"><ShieldCheck size={17} className="text-amber-400" /> Compliance (required)</h2>
        <p className="text-xs text-zinc-500 mb-4">CAN-SPAM requires your physical mailing address in every email. <b className="text-amber-400/90">Sending is blocked while this is empty.</b> A PO box or registered agent address works.</p>
        <Textarea label="Physical mailing address" rows={2} value={s.physical_address} onChange={set('physical_address')} placeholder="Acme Inc, 123 Main St, Springfield, IL 62704, USA" className="font-sans" />
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Input label="Default from name" value={s.default_from_name} onChange={set('default_from_name')} />
          <Input label="Default from email" value={s.default_from_email} onChange={set('default_from_email')} />
        </div>
      </Card>

      <Card className="p-6 mb-5">
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Globe size={17} className="text-sky-400" /> Base URL</h2>
        <p className="text-xs text-zinc-500 mb-4">Tracking pixels, click redirects, confirmation and unsubscribe links are built from this. Must be reachable by your recipients. Currently effective: <code className="text-indigo-300">{s.base_url_effective}</code></p>
        <Input label="Base URL override" value={s.base_url} onChange={set('base_url')} placeholder="https://mail.yourdomain.com" />
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Webhook size={17} className="text-emerald-400" /> Bounce webhook</h2>
        <p className="text-xs text-zinc-500">Point your provider's bounce/complaint webhook at <code className="text-indigo-300">POST {s.base_url_effective}/api/hooks/bounce</code>. Accepts SES-SNS, Postmark, Mailgun and generic <code>{'{ email, type }'}</code> payloads — see the README for exact shapes. Hard bounces and complaints are suppressed from all future sends automatically.</p>
      </Card>
    </motion.div>
  );
}
