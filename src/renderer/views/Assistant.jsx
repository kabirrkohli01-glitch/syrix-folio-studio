import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Square, TextSelect, Check, Trash2, Copy, FileText, Sparkles } from 'lucide-react';
import { useApp, tileUrl } from '../App.jsx';
import { useUi } from '../components/ui.jsx';
import { DiffView } from './humanizer/Review.jsx';
import { newRunId } from '../lib/format.js';

const folio = window.folio;

const QUICK = [
  ['explain', 'Explain'], ['summarise', 'Summarise'], ['brainstorm', 'Brainstorm'], ['clarify', 'Clarify a concept'],
  ['grammar', 'Fix grammar'], ['revise', 'Suggest a revision'], ['feedback', 'Review this'],
];

/** Minimal, safe markdown: paragraphs, bullet/numbered lists, **bold**, *italic*, `code`. */
function Markdown({ text }) {
  const blocks = useMemo(() => {
    const out = [];
    let list = null;
    for (const raw of String(text).split('\n')) {
      const line = raw.trimEnd();
      const b = line.match(/^\s*[-*•]\s+(.*)$/);
      const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (b || n) {
        const type = b ? 'ul' : 'ol';
        if (!list || list.type !== type) { list = { type, items: [] }; out.push(list); }
        list.items.push((b || n)[1]);
        continue;
      }
      list = null;
      if (!line.trim()) { out.push({ type: 'gap' }); continue; }
      const h = line.match(/^#{1,4}\s+(.*)$/);
      out.push({ type: 'p', text: h ? `**${h[1]}**` : line });
    }
    // Merge consecutive lines into paragraphs.
    const merged = [];
    for (const blk of out) {
      const last = merged[merged.length - 1];
      if (blk.type === 'p' && last && last.type === 'p' && !last.closed) last.text += `\n${blk.text}`;
      else if (blk.type === 'gap') { if (last) last.closed = true; }
      else merged.push({ ...blk });
    }
    return merged;
  }, [text]);
  const inline = (s) => {
    const parts = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
    let last = 0; let m; let k = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('**')) parts.push(<b key={k++}>{t.slice(2, -2)}</b>);
      else if (t.startsWith('`')) parts.push(<code key={k++} className="mono">{t.slice(1, -1)}</code>);
      else parts.push(<i key={k++}>{t.slice(1, -1)}</i>);
      last = m.index + t.length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  return blocks.map((b, i) => (b.type === 'p'
    ? <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{inline(b.text)}</p>
    : b.type === 'ul' ? <ul key={i}>{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>
      : <ol key={i}>{b.items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol>));
}

function stripEdit(text) {
  return String(text).replace(/<<<EDIT[\s\S]*?(EDIT>>>|$)/, '').trim();
}

export default function Assistant({ onClose }) {
  const app = useApp();
  const { toast } = useUi();
  const docId = app.view === 'editor' || app.editorRef.current ? app.activeDocId : null;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(null); // { runId, text }
  const [loaded, setLoaded] = useState(false);
  const bodyRef = useRef(null);
  const sel = app.selection?.docId === docId ? app.selection : { text: '' };

  useEffect(() => {
    setLoaded(false);
    if (!docId) { setMessages([]); setLoaded(true); return; }
    folio.threads.get(docId).then((t) => { setMessages(t?.messages || []); setLoaded(true); }).catch(() => { setMessages([]); setLoaded(true); });
  }, [docId]);

  useEffect(() => {
    if (loaded && docId) folio.threads.save(docId, messages).catch(() => {});
  }, [messages, loaded, docId]);

  useEffect(() => folio.assistant.onEvent((e) => {
    if (e.type === 'token') setBusy((b) => (b && b.runId === e.runId ? { ...b, text: b.text + e.text } : b));
    if (e.type === 'status' && e.seconds) setBusy((b) => (b && b.runId === e.runId ? { ...b, wait: e.seconds } : b));
  }), []);

  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [messages, busy?.text]);

  const send = async (action = null, override = null) => {
    const message = (override ?? input).trim();
    if (!action && !message) return;
    if (busy) return;
    const ed = app.editorRef.current;
    const docText = ed && ed.docId === docId ? ed.text() : '';
    const selection = sel.text || '';
    if (action && QUICK.find(([a]) => a === action) && ['explain', 'clarify', 'grammar', 'revise'].includes(action) && !selection) {
      toast('Select some text in the document first', { kind: 'warn' });
      return;
    }
    const label = action ? QUICK.find(([a]) => a === action)[1] + (message ? `: ${message}` : '') : message;
    const userMsg = { role: 'user', content: label, at: Date.now(), selection: selection ? selection.slice(0, 300) : null };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, userMsg]);
    setInput('');
    const runId = newRunId();
    setBusy({ runId, text: '' });
    const range = selection ? { from: sel.from, to: sel.to } : null;
    try {
      const r = await folio.assistant.send(runId, {
        history, message: action ? message : message, action,
        doc: { title: ed?.title?.() || app.activeTitle || 'Untitled', text: docText, selectionOffset: undefined },
        selection,
      });
      setMessages((m) => [...m, { role: 'assistant', content: r.text, at: Date.now(), model: r.model, edit: r.edit ? { text: r.edit, original: selection, range, docId, status: 'pending' } : null }]);
    } catch (e) {
      if (e.kind !== 'aborted') setMessages((m) => [...m, { role: 'assistant', content: '', error: e.message, at: Date.now() }]);
    } finally {
      setBusy(null);
    }
  };

  const applyEdit = async (idx) => {
    const msg = messages[idx];
    const ed = app.editorRef.current;
    if (!ed || ed.docId !== msg.edit.docId) { toast('Open the document this suggestion belongs to first', { kind: 'warn' }); return; }
    const r = await ed.replaceRange(msg.edit.range, msg.edit.original, msg.edit.text);
    if (!r.ok) { toast('Could not apply the edit', { kind: 'error', detail: r.reason }); return; }
    setMessages((m) => m.map((x, i) => (i === idx ? { ...x, edit: { ...x.edit, status: 'applied' } } : x)));
    toast('Edit applied — Ctrl+Z to undo', { kind: 'ok' });
  };

  const discardEdit = (idx) => setMessages((m) => m.map((x, i) => (i === idx ? { ...x, edit: { ...x.edit, status: 'discarded' } } : x)));

  return (
    <aside className="assistant" aria-label="SYRIX assistant">
      <div className="as-head">
        <img src={tileUrl} alt="" />
        <div className="grow">
          <div className="t">SYRIX</div>
          <div className="s ellipsis">{docId ? `Working with “${app.activeTitle}”` : 'Open a document to discuss it'}</div>
        </div>
        {messages.length > 0 && <button className="btn ghost icon sm" onClick={() => { setMessages([]); if (docId) folio.threads.clear(docId).catch(() => {}); }} data-tip="Clear conversation"><Trash2 /></button>}
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close assistant"><X /></button>
      </div>

      <div className="as-body" ref={bodyRef}>
        {!messages.length && !busy && (
          <div className="col" style={{ gap: 12 }}>
            <div className="note">
              Ask about your document, or select text and use a quick action. SYRIX reads the open document and your selection; suggested edits are only applied when you approve them.
            </div>
            {!docId && <div className="callout"><FileText /><div>No document is open. You can still ask general writing questions.</div></div>}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'user' && m.selection && <div className="context-tag"><TextSelect />“{m.selection.slice(0, 80)}{m.selection.length > 80 ? '…' : ''}”</div>}
            {m.error ? (
              <div className="callout error" style={{ fontSize: 12.5 }}>{m.error}</div>
            ) : (
              <div className="bubble-text">{m.role === 'assistant' ? <Markdown text={stripEdit(m.content)} /> : m.content}</div>
            )}
            {m.edit && (
              <div className="edit-card">
                <div className="ec-head"><Sparkles size={13} />Suggested edit {m.edit.status === 'applied' ? '· applied' : m.edit.status === 'discarded' ? '· discarded' : ''}</div>
                <div className="ec-body">{m.edit.original ? <DiffView a={m.edit.original} b={m.edit.text} mode="both" /> : m.edit.text}</div>
                {m.edit.status === 'pending' && (
                  <div className="ec-foot">
                    <button className="btn sm primary" onClick={() => applyEdit(i)} disabled={!m.edit.range}><Check />Apply to selection</button>
                    <button className="btn sm" onClick={() => navigator.clipboard.writeText(m.edit.text).then(() => toast('Copied', { kind: 'ok' }))}><Copy />Copy</button>
                    <button className="btn sm ghost" onClick={() => discardEdit(i)}>Discard</button>
                  </div>
                )}
              </div>
            )}
            {m.role === 'assistant' && m.model && <div className="meta">{m.model.split(':').slice(1).join(':')}</div>}
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="bubble-text">{busy.text ? <Markdown text={stripEdit(busy.text)} /> : <span className="typing"><i /><i /><i /></span>}</div>
            {busy.wait && !busy.text && <div className="meta">Waiting for the free-tier allowance…</div>}
          </div>
        )}
      </div>

      <div className="as-actions">
        {QUICK.map(([a, l]) => <button key={a} className="chip" onClick={() => send(a, '')} disabled={Boolean(busy)}>{l}</button>)}
      </div>
      <div className="as-input">
        {sel.text ? <div className="sel-pill"><TextSelect />{sel.text.split(/\s+/).length} words selected</div> : null}
        <div className="box">
          <textarea
            rows={1}
            value={input}
            placeholder={sel.text ? 'Ask about the selection…' : 'Ask SYRIX…'}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            aria-label="Message SYRIX"
          />
          {busy
            ? <button className="btn icon sm" onClick={() => folio.assistant.cancel(busy.runId)} aria-label="Stop"><Square size={12} /></button>
            : <button className="btn primary icon sm" onClick={() => send()} disabled={!input.trim()} aria-label="Send"><Send /></button>}
        </div>
      </div>
    </aside>
  );
}
