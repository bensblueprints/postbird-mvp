import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';

export function Button({ children, variant = 'primary', className = '', loading, ...props }) {
  const styles = {
    primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-300 border border-zinc-700',
    danger: 'bg-red-600/80 hover:bg-red-600 text-white',
    subtle: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
  };
  return (
    <button
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</span>}
      <input
        className={`w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 ${className}`}
        {...props}
      />
    </label>
  );
}

export function Select({ label, children, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</span>}
      <select
        className={`w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</span>}
      <textarea
        className={`w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono ${className}`}
        {...props}
      />
    </label>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`bg-zinc-900/60 border border-zinc-800 rounded-xl ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'zinc' }) {
  const tones = {
    zinc: 'bg-zinc-800 text-zinc-300',
    green: 'bg-emerald-500/15 text-emerald-400',
    yellow: 'bg-amber-500/15 text-amber-400',
    red: 'bg-red-500/15 text-red-400',
    blue: 'bg-sky-500/15 text-sky-400',
    indigo: 'bg-indigo-500/15 text-indigo-400'
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${tones[tone] || tones.zinc}`}>{children}</span>;
}

export const statusTone = {
  subscribed: 'green', pending: 'yellow', unsubscribed: 'zinc', bounced: 'red', complained: 'red',
  draft: 'zinc', scheduled: 'blue', sending: 'indigo', paused: 'yellow', sent: 'green', canceled: 'red',
  queued: 'blue', failed: 'red'
};

export function Modal({ open, onClose, title, children, wide }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto`}
            initial={{ scale: 0.95, y: 12, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 12, opacity: 0 }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-900 rounded-t-2xl">
              <h3 className="font-semibold text-zinc-100">{title}</h3>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ icon: Icon, title, sub, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && <Icon size={36} className="text-zinc-600 mb-3" />}
      <div className="text-zinc-300 font-medium">{title}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1 max-w-sm">{sub}</div>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Toast({ toast }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
          className={`fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
            toast.type === 'error' ? 'bg-red-950 border-red-800 text-red-200' : 'bg-emerald-950 border-emerald-800 text-emerald-200'
          }`}
        >
          {toast.msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
