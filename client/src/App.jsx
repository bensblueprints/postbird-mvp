import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, Users, PencilRuler, Send, Settings as SettingsIcon, Mail, LogOut } from 'lucide-react';
import { api } from './api.js';
import { Button, Input, Toast } from './components/ui.jsx';
import Dashboard from './components/Dashboard.jsx';
import Lists from './components/Lists.jsx';
import Builder from './components/Builder.jsx';
import Campaigns from './components/Campaigns.jsx';
import Settings from './components/Settings.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, comp: Dashboard },
  { id: 'lists', label: 'Lists', icon: Users, comp: Lists },
  { id: 'builder', label: 'Builder', icon: PencilRuler, comp: Builder },
  { id: 'campaigns', label: 'Campaigns', icon: Send, comp: Campaigns },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, comp: Settings }
];

function Login({ onLogin, toast }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/login', { password });
      onLogin();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-zinc-900/70 border border-zinc-800 rounded-2xl p-8"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center"><Mail size={20} /></div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Postbird</h1>
            <p className="text-xs text-zinc-500">Self-hosted email campaigns</p>
          </div>
        </div>
        <Input label="Admin password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus placeholder="••••••••" />
        <Button type="submit" loading={busy} className="w-full justify-center mt-4">Sign in</Button>
      </motion.form>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [pageProps, setPageProps] = useState({});
  const [toastState, setToastState] = useState(null);

  const toast = useCallback((msg, type = 'ok') => {
    setToastState({ msg, type });
    setTimeout(() => setToastState(null), 3500);
  }, []);

  const navigate = useCallback((id, props = {}) => {
    setPage(id);
    setPageProps(props);
  }, []);

  useEffect(() => {
    api.get('/api/me').then((d) => setAuthed(d.authed)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return null;
  if (!authed) return (<><Login onLogin={() => setAuthed(true)} toast={toast} /><Toast toast={toastState} /></>);

  const Active = NAV.find((n) => n.id === page)?.comp || Dashboard;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-zinc-800">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center"><Mail size={16} /></div>
          <span className="font-bold">Postbird</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                page === n.id ? 'bg-indigo-600/15 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              <n.icon size={17} />
              {n.label}
            </button>
          ))}
        </nav>
        <button
          onClick={async () => { await api.post('/api/logout').catch(() => {}); setAuthed(false); }}
          className="flex items-center gap-3 px-6 py-4 text-sm text-zinc-500 hover:text-zinc-200 border-t border-zinc-800"
        >
          <LogOut size={16} /> Sign out
        </button>
      </aside>
      <main className="flex-1 min-w-0 p-8 overflow-x-hidden">
        <Active toast={toast} navigate={navigate} {...pageProps} />
      </main>
      <Toast toast={toastState} />
    </div>
  );
}
