import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Send, Mail, ListChecks, ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { Card, Badge, statusTone, Empty, Button } from './ui.jsx';

function Stat({ icon: Icon, label, value }) {
  return (
    <Card className="p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-indigo-600/15 text-indigo-400 flex items-center justify-center"><Icon size={19} /></div>
      <div>
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    </Card>
  );
}

export default function Dashboard({ navigate }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/api/dashboard').then(setData).catch(() => {});
    const t = setInterval(() => api.get('/api/dashboard').then(setData).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) return null;
  const rate = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat icon={ListChecks} label="Lists" value={data.totals.lists} />
        <Stat icon={Users} label="Active subscribers" value={data.totals.subscribers} />
        <Stat icon={Send} label="Campaigns" value={data.totals.campaigns} />
        <Stat icon={Mail} label="Emails delivered" value={data.totals.sent} />
      </div>

      <h2 className="font-semibold text-zinc-300 mb-3">Recent campaigns</h2>
      {data.campaigns.length === 0 ? (
        <Card>
          <Empty icon={Send} title="No campaigns yet" sub="Create a list, build a template, then send your first campaign.">
            <Button onClick={() => navigate('campaigns')}>Create a campaign <ArrowRight size={15} /></Button>
          </Empty>
        </Card>
      ) : (
        <Card className="divide-y divide-zinc-800">
          {data.campaigns.map((c) => {
            const sent = c.outbox?.sent || 0;
            return (
              <button
                key={c.id}
                onClick={() => navigate('campaigns', { openReport: c.id })}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-900/60 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.subject || `Campaign #${c.id}`}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{c.created_at}</div>
                </div>
                <div className="text-xs text-zinc-400 w-20 text-right">{sent} sent</div>
                <div className="text-xs text-zinc-400 w-24 text-right">{rate(c.opens_unique, sent)} opens</div>
                <div className="text-xs text-zinc-400 w-24 text-right">{rate(c.clicks_unique, sent)} clicks</div>
                <Badge tone={statusTone[c.status]}>{c.status}</Badge>
              </button>
            );
          })}
        </Card>
      )}
    </motion.div>
  );
}
