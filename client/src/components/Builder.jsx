import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, Reorder } from 'framer-motion';
import {
  Plus, Type, AlignLeft, Image as ImageIcon, MousePointerClick, Minus, MoveVertical,
  Columns2, ShieldCheck, Trash2, GripVertical, Monitor, Smartphone, Code2, Send, ChevronLeft, Save, PencilRuler
} from 'lucide-react';
import { api } from '../api.js';
import { Button, Input, Select, Textarea, Card, Modal, Empty, Badge } from './ui.jsx';

const PALETTE = [
  { type: 'heading', label: 'Heading', icon: Type, make: () => ({ type: 'heading', text: 'Your headline here' }) },
  { type: 'text', label: 'Text', icon: AlignLeft, make: () => ({ type: 'text', text: 'Write something worth reading. Use **bold**, *italic* and [links](https://example.com).' }) },
  { type: 'image', label: 'Image', icon: ImageIcon, make: () => ({ type: 'image', src: '', alt: '' }) },
  { type: 'button', label: 'Button', icon: MousePointerClick, make: () => ({ type: 'button', text: 'Call to action', href: 'https://example.com' }) },
  { type: 'divider', label: 'Divider', icon: Minus, make: () => ({ type: 'divider' }) },
  { type: 'spacer', label: 'Spacer', icon: MoveVertical, make: () => ({ type: 'spacer', styles: { height: 24 } }) },
  { type: 'columns', label: '2 columns', icon: Columns2, make: () => ({ type: 'columns', left: 'Left column', right: 'Right column' }) },
  { type: 'footer', label: 'Footer', icon: ShieldCheck, make: () => ({ type: 'footer', text: 'You are receiving this because you subscribed.' }) }
];

let uid = 1;
const withKeys = (blocks) => blocks.map((b) => ({ ...b, _k: b._k || `k${uid++}` }));
const stripKeys = (blocks) => blocks.map(({ _k, ...b }) => b);

function BlockEditor({ block, onChange, toast }) {
  const set = (patch) => onChange({ ...block, ...patch });
  const setStyle = (patch) => onChange({ ...block, styles: { ...(block.styles || {}), ...patch } });
  const s = block.styles || {};
  const fileRef = useRef();

  return (
    <div className="space-y-3">
      {(block.type === 'heading' || block.type === 'text') && (
        <Textarea label="Text" rows={block.type === 'text' ? 4 : 2} value={block.text || ''} onChange={(e) => set({ text: e.target.value })} />
      )}
      {block.type === 'footer' && (
        <>
          <Textarea label="Footer note (address + unsubscribe link are appended automatically)" rows={2} value={block.text || ''} onChange={(e) => set({ text: e.target.value })} />
          <p className="text-xs text-amber-400/90 flex items-start gap-1.5"><ShieldCheck size={13} className="mt-0.5 shrink-0" />
            Compliance: the footer always renders your physical mailing address and an unsubscribe link. It cannot be removed from campaign sends.</p>
        </>
      )}
      {block.type === 'image' && (
        <>
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Input label="Image URL" value={block.src || ''} onChange={(e) => set({ src: e.target.value })} placeholder="https://…" /></div>
            <Button variant="subtle" onClick={() => fileRef.current?.click()}>Upload</Button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
              const f = e.target.files[0];
              if (!f) return;
              try { const { url } = await api.upload(f); set({ src: url }); } catch (err) { toast(err.message, 'error'); }
            }} />
          </div>
          <Input label="Alt text (accessibility + images-off clients)" value={block.alt || ''} onChange={(e) => set({ alt: e.target.value })} />
          <Input label="Link (optional)" value={block.href || ''} onChange={(e) => set({ href: e.target.value })} placeholder="https://…" />
        </>
      )}
      {block.type === 'button' && (
        <>
          <Input label="Label" value={block.text || ''} onChange={(e) => set({ text: e.target.value })} />
          <Input label="URL" value={block.href || ''} onChange={(e) => set({ href: e.target.value })} placeholder="https://…" />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Button color" type="color" value={s.bgColor || '#4f46e5'} onChange={(e) => setStyle({ bgColor: e.target.value })} className="h-9 p-1" />
            <Input label="Text color" type="color" value={s.color || '#ffffff'} onChange={(e) => setStyle({ color: e.target.value })} className="h-9 p-1" />
          </div>
        </>
      )}
      {block.type === 'columns' && (
        <>
          <Textarea label="Left column" rows={3} value={block.left || ''} onChange={(e) => set({ left: e.target.value })} />
          <Textarea label="Right column" rows={3} value={block.right || ''} onChange={(e) => set({ right: e.target.value })} />
        </>
      )}
      {block.type === 'spacer' && (
        <Input label="Height (px)" type="number" value={s.height || 24} onChange={(e) => setStyle({ height: Number(e.target.value) || 24 })} />
      )}
      {['heading', 'text', 'button', 'image'].includes(block.type) && (
        <Select label="Alignment" value={s.align || 'left'} onChange={(e) => setStyle({ align: e.target.value })}>
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </Select>
      )}
      {['heading', 'text'].includes(block.type) && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Font size (px)" type="number" value={s.size || (block.type === 'heading' ? 28 : 15)} onChange={(e) => setStyle({ size: Number(e.target.value) || undefined })} />
          <Input label="Color" type="color" value={s.color || '#27272a'} onChange={(e) => setStyle({ color: e.target.value })} className="h-9 p-1" />
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ template, back, toast }) {
  const [name, setName] = useState(template.name);
  const [blocks, setBlocks] = useState(withKeys(template.blocks || []));
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState({ html: '', text: '' });
  const [tab, setTab] = useState('desktop');
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const rerender = useCallback(() => {
    api.post(`/api/templates/${template.id}/render`, { blocks: stripKeys(blocks) })
      .then(setPreview).catch(() => {});
  }, [blocks, template.id]);

  useEffect(() => {
    const t = setTimeout(rerender, 300);
    return () => clearTimeout(t);
  }, [rerender]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/templates/${template.id}`, { name, blocks: stripKeys(blocks) });
      setDirty(false);
      toast('Template saved');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const update = (next) => { setBlocks(next); setDirty(true); };
  const sel = blocks.find((b) => b._k === selected);

  return (
    <div>
      <button onClick={back} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-200 mb-3"><ChevronLeft size={16} /> All templates</button>
      <div className="flex items-center gap-3 mb-5">
        <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }}
          className="text-xl font-bold bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-indigo-500 focus:outline-none px-1 flex-1 min-w-0" />
        {dirty && <Badge tone="yellow">unsaved</Badge>}
        <Button variant="subtle" onClick={() => setTestOpen(true)}><Send size={15} /> Send test</Button>
        <Button onClick={save} loading={busy}><Save size={15} /> Save</Button>
      </div>

      <div className="grid grid-cols-[180px_1fr_300px] gap-4 items-start">
        {/* Palette */}
        <Card className="p-3 space-y-1 sticky top-6">
          <div className="text-xs font-medium text-zinc-500 px-1 mb-2">Blocks</div>
          {PALETTE.map((p) => (
            <button key={p.type}
              onClick={() => { const b = { ...p.make(), _k: `k${uid++}` }; update([...blocks, b]); setSelected(b._k); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition-colors">
              <p.icon size={15} className="text-zinc-500" /> {p.label}
            </button>
          ))}
        </Card>

        {/* Canvas */}
        <div>
          <div className="flex gap-1 mb-3">
            {[['desktop', Monitor], ['mobile', Smartphone], ['source', Code2], ['textalt', AlignLeft]].map(([t, I]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${tab === t ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <I size={13} /> {{ desktop: 'Edit / Desktop', mobile: 'Mobile', source: 'HTML', textalt: 'Plain text' }[t]}
              </button>
            ))}
          </div>

          {tab === 'desktop' && (
            <div className="bg-zinc-200 rounded-xl p-6 min-h-[400px]">
              <div className="mx-auto" style={{ maxWidth: 600 }}>
                {blocks.length === 0 && (
                  <div className="text-center text-zinc-500 py-20 border-2 border-dashed border-zinc-400 rounded-xl bg-white/50">
                    Click a block on the left to start building
                  </div>
                )}
                <Reorder.Group axis="y" values={blocks} onReorder={update} className="space-y-1">
                  {blocks.map((b) => (
                    <Reorder.Item key={b._k} value={b}
                      className={`group relative bg-white rounded-lg overflow-hidden cursor-grab active:cursor-grabbing border-2 ${selected === b._k ? 'border-indigo-500' : 'border-transparent hover:border-indigo-300'}`}
                      onClick={() => setSelected(b._k)}>
                      <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-zinc-400 z-10"><GripVertical size={14} /></div>
                      <BlockPreview block={b} />
                      <button
                        onClick={(e) => { e.stopPropagation(); update(blocks.filter((x) => x._k !== b._k)); if (selected === b._k) setSelected(null); }}
                        className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 bg-white/90 rounded p-1 text-zinc-500 hover:text-red-500 z-10">
                        <Trash2 size={13} />
                      </button>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              </div>
            </div>
          )}
          {tab === 'mobile' && (
            <div className="bg-zinc-200 rounded-xl p-6 flex justify-center">
              <iframe title="mobile" srcDoc={preview.html} className="bg-white rounded-3xl border-8 border-zinc-800" style={{ width: 375, height: 640 }} />
            </div>
          )}
          {tab === 'source' && (
            <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-xs text-emerald-300/90 overflow-auto max-h-[600px] whitespace-pre-wrap">{preview.html}</pre>
          )}
          {tab === 'textalt' && (
            <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-300 overflow-auto max-h-[600px] whitespace-pre-wrap">{preview.text}</pre>
          )}
        </div>

        {/* Style panel */}
        <Card className="p-4 sticky top-6">
          <div className="text-xs font-medium text-zinc-500 mb-3">{sel ? `Edit ${sel.type}` : 'Select a block to edit'}</div>
          {sel ? (
            <BlockEditor block={sel} toast={toast} onChange={(nb) => update(blocks.map((b) => (b._k === sel._k ? { ...nb, _k: sel._k } : b)))} />
          ) : (
            <p className="text-sm text-zinc-600">Click any block in the canvas. Drag the grip to reorder. Merge tags: <code className="text-indigo-300">{'{{name}}'}</code> <code className="text-indigo-300">{'{{email}}'}</code></p>
          )}
        </Card>
      </div>

      <Modal open={testOpen} onClose={() => setTestOpen(false)} title="Send a test email">
        <div className="space-y-3">
          <Input label="Send to" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <p className="text-xs text-zinc-500">Uses your SMTP settings. Unsaved changes are saved first.</p>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.put(`/api/templates/${template.id}`, { name, blocks: stripKeys(blocks) });
              setDirty(false);
              await api.post(`/api/templates/${template.id}/test-send`, { to: testTo });
              toast('Test email sent');
              setTestOpen(false);
            } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
          }}>Send test</Button>
        </div>
      </Modal>
    </div>
  );
}

// Lightweight in-canvas visual approximation (real output comes from the compiler preview tabs)
function BlockPreview({ block }) {
  const s = block.styles || {};
  const align = { textAlign: s.align || 'left' };
  switch (block.type) {
    case 'heading': return <div className="px-8 py-3 font-bold text-zinc-900" style={{ fontSize: s.size || 28, ...align, color: s.color }}>{block.text}</div>;
    case 'text': return <div className="px-8 py-3 text-zinc-700 whitespace-pre-wrap" style={{ fontSize: s.size || 15, ...align, color: s.color }}>{block.text}</div>;
    case 'image': return block.src
      ? <div className="px-8 py-3" style={align}><img src={block.src} alt={block.alt || ''} className="max-w-full inline-block" /></div>
      : <div className="mx-8 my-3 py-10 border-2 border-dashed border-zinc-300 rounded text-center text-zinc-400 text-sm">Image — set a URL or upload</div>;
    case 'button': return <div className="px-8 py-3" style={align}><span className="inline-block px-7 py-3 rounded-md font-bold text-sm" style={{ background: s.bgColor || '#4f46e5', color: s.color || '#fff' }}>{block.text}</span></div>;
    case 'divider': return <div className="px-8 py-4"><div className="border-t border-zinc-300" /></div>;
    case 'spacer': return <div style={{ height: s.height || 24 }} className="bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,#f4f4f5_6px,#f4f4f5_12px)]" />;
    case 'columns': return <div className="px-8 py-3 grid grid-cols-2 gap-4 text-sm text-zinc-700"><div className="whitespace-pre-wrap">{block.left}</div><div className="whitespace-pre-wrap">{block.right}</div></div>;
    case 'footer': return (
      <div className="px-8 py-4 text-center text-xs text-zinc-500 bg-zinc-50">
        {block.text && <div>{block.text}</div>}
        <div className="mt-1">{'{{physical_address}}'} · <span className="underline">Unsubscribe</span></div>
        <div className="mt-1 text-[10px] text-amber-600 font-medium">⚖ compliance footer — always included in sends</div>
      </div>
    );
    default: return null;
  }
}

export default function Builder({ toast }) {
  const [templates, setTemplates] = useState([]);
  const [active, setActive] = useState(null);

  const refresh = useCallback(() => api.get('/api/templates').then(setTemplates).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);

  const open = async (id) => setActive(await api.get(`/api/templates/${id}`));

  if (active) return <TemplateEditor template={active} back={() => { setActive(null); refresh(); }} toast={toast} />;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Email Builder</h1>
        <Button onClick={async () => {
          const t = await api.post('/api/templates', {
            name: 'Untitled template',
            blocks: [
              { type: 'heading', text: 'Hello {{name}} 👋' },
              { type: 'text', text: 'Start writing your email here.' },
              { type: 'button', text: 'Call to action', href: 'https://example.com' },
              { type: 'footer', text: 'You are receiving this because you subscribed.' }
            ]
          });
          open(t.id);
        }}><Plus size={15} /> New template</Button>
      </div>
      {templates.length === 0 ? (
        <Card><Empty icon={PencilRuler} title="No templates yet" sub="Templates are reusable block layouts compiled to bulletproof, table-based email HTML." /></Card>
      ) : (
        <Card className="divide-y divide-zinc-800">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-900/60">
              <button onClick={() => open(t.id)} className="font-medium hover:text-indigo-300 text-left flex-1">{t.name}</button>
              <span className="text-xs text-zinc-600 mr-4">{t.updated_at}</span>
              <button onClick={async () => { if (confirm('Delete template?')) { await api.del(`/api/templates/${t.id}`); refresh(); } }}
                className="text-zinc-600 hover:text-red-400"><Trash2 size={15} /></button>
            </div>
          ))}
        </Card>
      )}
    </motion.div>
  );
}
