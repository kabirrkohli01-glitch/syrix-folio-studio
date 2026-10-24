import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered, Quote, AlignLeft,
  AlignCenter, AlignRight, AlignJustify, Link2, Undo2, Redo2, Search, History, Download, Wand2,
  ChevronLeft, MoreHorizontal, FileUp, Copy, Trash2, X, ChevronUp, ChevronDown, Replace, Code2,
  Minus, RotateCcw, MessageSquare, FileText,
} from 'lucide-react';
import { useApp, tileUrl } from '../App.jsx';
import { useUi, useMenu, Modal } from '../components/ui.jsx';
import { baseExtensions, docText } from '../lib/editorExtensions.js';
import { exportDocument, EXPORT_FORMATS } from '../lib/export.js';
import { collectBlocks, blocksText, applyBlockRevisions } from '../lib/blocks.js';
import { relTime, clock, dateTime, num, readingTime } from '../lib/format.js';
import { countWords } from '../../shared/text/tokenize.js';

const folio = window.folio;

function useSaver(docId, editorRef, titleRef, onSaved) {
  const [state, setState] = useState({ status: 'saved', at: Date.now(), error: null });
  const timer = useRef(null);
  const pending = useRef(false);
  const saving = useRef(null);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    const editor = editorRef.current;
    if (!editor || !pending.current) return saving.current;
    pending.current = false;
    const text = docText(editor);
    const patch = {
      title: titleRef.current,
      html: editor.getHTML(),
      json: editor.getJSON(),
      text,
      wordCount: countWords(text),
    };
    setState((s) => ({ ...s, status: 'saving' }));
    const p = folio.docs.save(docId, patch)
      .then((meta) => { setState({ status: 'saved', at: Date.now(), error: null }); onSaved?.(meta); })
      .catch((e) => {
        pending.current = true;
        setState({ status: 'error', at: Date.now(), error: e.message });
        clearTimeout(timer.current);
        timer.current = setTimeout(saveNow, 5000);
      });
    saving.current = p;
    return p;
  }, [docId, editorRef, titleRef, onSaved]);

  const schedule = useCallback(() => {
    pending.current = true;
    setState((s) => (s.status === 'unsaved' ? s : { ...s, status: 'unsaved' }));
    clearTimeout(timer.current);
    const words = editorRef.current?.storage.characterCount.words() || 0;
    timer.current = setTimeout(saveNow, words > 40000 ? 2500 : words > 10000 ? 1400 : 800);
  }, [saveNow, editorRef]);

  return { state, schedule, saveNow };
}

function SaveState({ state }) {
  const label = state.status === 'saving' ? 'Saving…'
    : state.status === 'unsaved' ? 'Editing'
      : state.status === 'error' ? 'Not saved — retrying'
        : `Saved ${clock(state.at)}`;
  return <span className={`save-state ${state.status === 'unsaved' ? 'saving' : state.status}`} data-tip={state.error || 'Changes are saved automatically'}><span className="dot" />{label}</span>;
}

function FindBar({ editor, replaceMode, onClose }) {
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState({ caseSensitive: false, wholeWord: false, regex: false });
  const [showReplace, setShowReplace] = useState(replaceMode);
  const [, force] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => { setShowReplace((v) => v || replaceMode); }, [replaceMode]);
  useEffect(() => {
    editor.commands.setSearch({ term, ...opts });
    force((x) => x + 1);
  }, [term, opts, editor]);
  useEffect(() => {
    const onTx = () => force((x) => x + 1);
    editor.on('transaction', onTx);
    return () => { editor.off('transaction', onTx); editor.commands.clearSearch(); };
  }, [editor]);

  const s = editor.storage.folioSearch;
  const goto = (dir) => {
    editor.commands.searchStep(dir);
    const hit = s.results[s.index];
    if (hit) {
      const dom = editor.view.domAtPos(hit.from);
      const el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
      el?.scrollIntoView({ block: 'center' });
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); goto(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="findbar" onKeyDown={onKey}>
      <div className="row">
        <input ref={inputRef} className="input grow" placeholder="Find" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Find" />
        <span className="count">{term ? `${s.results.length ? s.index + 1 : 0} of ${num(s.results.length)}` : ''}</span>
        <button className="btn ghost icon sm" onClick={() => goto(-1)} disabled={!s.results.length} data-tip="Previous (Shift+Enter)"><ChevronUp /></button>
        <button className="btn ghost icon sm" onClick={() => goto(1)} disabled={!s.results.length} data-tip="Next (Enter)"><ChevronDown /></button>
        <button className="btn ghost icon sm" onClick={() => setShowReplace((v) => !v)} data-tip="Replace"><Replace /></button>
        <button className="btn ghost icon sm" onClick={onClose} data-tip="Close (Esc)"><X /></button>
      </div>
      {showReplace && (
        <div className="row">
          <input className="input grow" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replace with" />
          <button className="btn sm" disabled={!s.results.length} onClick={() => editor.commands.replaceCurrent(replacement)}>Replace</button>
          <button className="btn sm" disabled={!s.results.length} onClick={() => editor.commands.replaceAll(replacement)}>All</button>
        </div>
      )}
      <div className="row" style={{ gap: 4 }}>
        <button className={`chip${opts.caseSensitive ? ' on' : ''}`} onClick={() => setOpts((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}>Match case</button>
        <button className={`chip${opts.wholeWord ? ' on' : ''}`} onClick={() => setOpts((o) => ({ ...o, wholeWord: !o.wholeWord }))}>Whole word</button>
        <button className={`chip${opts.regex ? ' on' : ''}`} onClick={() => setOpts((o) => ({ ...o, regex: !o.regex }))}>Regex</button>
      </div>
    </div>
  );
}

function LinkPopover({ editor, onClose }) {
  const current = editor.getAttributes('link').href || '';
  const [url, setUrl] = useState(current);
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  const apply = () => {
    let href = url.trim();
    if (!href) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); return; }
    if (!/^(https?:|mailto:)/i.test(href)) href = `https://${href}`;
    if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  };
  return (
    <div className="link-pop" style={{ left: Math.min(coords.left, window.innerWidth - 400), top: coords.bottom + 8 }}>
      <input className="input grow" autoFocus placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') onClose(); }} />
      <button className="btn primary sm" onClick={apply}>{current ? 'Update' : 'Add'}</button>
      {current && <button className="btn sm" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }}>Remove</button>}
    </div>
  );
}

function HistoryPanel({ docId, onRestore, onClose }) {
  const [items, setItems] = useState(null);
  const [sel, setSel] = useState(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => { folio.docs.history(docId).then(setItems).catch(() => setItems([])); }, [docId]);
  useEffect(() => {
    if (!sel) { setPreview(null); return; }
    folio.docs.getSnapshot(docId, sel).then(setPreview).catch(() => setPreview(null));
  }, [docId, sel]);
  return (
    <aside className="side-panel">
      <div className="sp-head"><History size={15} />Version history<span className="spacer" /><button className="btn ghost icon sm" onClick={onClose}><X /></button></div>
      <div className="sp-body">
        {items === null && <div className="row muted"><span className="spinner" />Loading</div>}
        {items && !items.length && <div className="note">No earlier versions yet. Folio keeps a version every few minutes while you write, and before any AI change is applied.</div>}
        {items && items.map((h) => (
          <div key={h.at} className={`hist-item${sel === h.at ? ' on' : ''}`} onClick={() => setSel(h.at)}>
            <div className="when">{dateTime(h.at)}</div>
            <div className="why">{h.reason === 'autosave' ? 'Automatic version' : h.reason.charAt(0).toUpperCase() + h.reason.slice(1)} · {num(h.wordCount)} words</div>
            {sel === h.at && <p>{preview ? (preview.text || '').slice(0, 400) : h.preview}</p>}
            {sel === h.at && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); onRestore(h.at); }}><RotateCcw size={13} />Restore this version</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

export default function Editor({ docId, visible }) {
  const app = useApp();
  const { toast, confirm } = useUi();
  const [doc, setDoc] = useState(null);
  const [title, setTitle] = useState('');
  const titleRef = useRef('');
  const editorInstance = useRef(null);
  const [find, setFind] = useState(null); // null | 'find' | 'replace'
  const [linkOpen, setLinkOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [counts, setCounts] = useState({ words: 0, chars: 0, sel: 0 });
  const [openMenu, menuNode] = useMenu();
  const [exporting, setExporting] = useState(null);
  const settings = app.settings?.editor || {};

  const onSaved = useCallback((meta) => {
    app.refreshDocs();
    if (meta?.title) app.setActiveTitle(meta.title);
  }, [app.refreshDocs, app.setActiveTitle]);
  const saver = useSaver(docId, editorInstance, titleRef, onSaved);

  const extensions = useMemo(() => baseExtensions(), []);
  const editor = useEditor({
    extensions,
    content: '',
    editorProps: {
      attributes: { spellcheck: String(settings.spellcheck !== false), 'aria-label': 'Document' },
      handleDrop: (view, event) => {
        // Files dropped onto the page are inserted at the drop point.
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length) return false;
        event.preventDefault();
        const paths = files.map((f) => folio.app.pathForFile(f)).filter(Boolean);
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertFiles(paths, pos);
        return true;
      },
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (transaction.getMeta('folioLoad')) return;
      saver.schedule();
      updateCounts(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      updateCounts(ed);
      // Only publish selections with text; plain cursor moves would otherwise
      // re-render the whole app on every keystroke.
      const { from, to } = ed.state.selection;
      if (from === to) app.setSelection((prev) => (prev.text === '' ? prev : { text: '', from: 0, to: 0, docId }));
      else {
        const text = ed.state.doc.textBetween(from, to, '\n', ' ');
        app.setSelection((prev) => (prev.text === text && prev.from === from && prev.to === to ? prev : { text, from, to, docId }));
      }
    },
  }, [docId]);
  editorInstance.current = editor;

  const countTimer = useRef(null);
  function updateCounts(ed) {
    clearTimeout(countTimer.current);
    countTimer.current = setTimeout(() => {
      const { from, to } = ed.state.selection;
      setCounts({
        words: ed.storage.characterCount.words(),
        chars: ed.storage.characterCount.characters(),
        sel: from === to ? 0 : countWords(ed.state.doc.textBetween(from, to, ' ', ' ')),
      });
    }, 120);
  }

  // Load the document.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    folio.docs.get(docId).then((d) => {
      if (cancelled || !d) return;
      setDoc(d);
      setTitle(d.title);
      titleRef.current = d.title;
      app.setActiveTitle(d.title);
      const content = d.json || d.html || '';
      editor.commands.setContent(content, { emitUpdate: false });
      editor.view.dispatch(editor.state.tr.setMeta('folioLoad', true).setMeta('addToHistory', false));
      updateCounts(editor);
      if (d.recovered) toast('This document was restored from its backup copy', { kind: 'warn', detail: 'The main file could not be read. Nothing was lost beyond the last save.' });
      if (!d.text) setTimeout(() => editor.commands.focus('end'), 50);
    }).catch((e) => toast('Could not open the document', { kind: 'error', detail: e.message }));
    return () => { cancelled = true; };
  }, [editor, docId]);

  // Flush on window close and when the editor unmounts.
  useEffect(() => {
    const off = folio.app.onFlush(async () => { await saver.saveNow(); folio.app.flushed(); });
    return () => { off(); saver.saveNow(); };
  }, [saver.saveNow]);

  const insertFiles = useCallback(async (paths, pos) => {
    if (!paths?.length || !editorInstance.current) return;
    try {
      const r = await folio.files.importPaths(paths, { insert: true });
      for (const f of r.failed) toast(`${f.name} could not be inserted`, { kind: 'error', detail: f.message });
      const html = r.imported.map((x) => x.html).join('');
      if (html) {
        const ed = editorInstance.current;
        const at = pos ?? ed.state.selection.to;
        ed.chain().focus().insertContentAt(at, html).run();
        toast(`Inserted ${r.imported.map((x) => x.name).join(', ')}`, { kind: 'ok', detail: r.imported[0].warnings?.[0] });
      }
    } catch (e) {
      toast('Could not insert the file', { kind: 'error', detail: e.message });
    }
  }, [toast]);

  const insertFromDialog = async () => {
    try {
      const r = await folio.files.importDialog({ insert: true });
      if (r.canceled) return;
      for (const f of r.failed) toast(`${f.name} could not be inserted`, { kind: 'error', detail: f.message });
      const html = r.imported.map((x) => x.html).join('');
      if (html) { editor.chain().focus().insertContent(html).run(); toast('File inserted', { kind: 'ok', detail: r.imported[0].warnings?.[0] }); }
    } catch (e) { toast('Could not insert the file', { kind: 'error', detail: e.message }); }
  };

  const doExport = async (format) => {
    await saver.saveNow();
    setExporting(format);
    try {
      const r = await exportDocument({ title: titleRef.current, html: editor.getHTML(), json: editor.getJSON(), text: docText(editor) }, format);
      if (!r.canceled) toast(`Exported ${r.path.split(/[\\/]/).pop()}`, { kind: 'ok', action: { label: 'Show', onClick: () => folio.files.showInFolder(r.path) } });
    } catch (e) {
      toast('Export failed', { kind: 'error', detail: e.message });
    } finally { setExporting(null); }
  };

  const humanize = () => {
    const { from, to } = editor.state.selection;
    const whole = from === to;
    const range = whole ? { from: 0, to: editor.state.doc.content.size } : { from, to };
    const blocks = collectBlocks(editor.state.doc, range.from, range.to);
    const text = blocksText(blocks);
    if (!text.trim()) { toast('There is no text to revise yet', { kind: 'warn' }); return; }
    app.sendToHumanizer({ text, title: titleRef.current, source: { docId, title: titleRef.current, kind: whole ? 'document' : 'selection', range, text } });
  };

  // Bridge for the humanizer and assistant to apply approved changes.
  useEffect(() => {
    if (!editor) return;
    app.editorRef.current = {
      docId,
      editor,
      title: () => titleRef.current,
      text: () => docText(editor),
      async applyRevisions(range, expectedText, revised) {
        await saver.saveNow();
        await folio.docs.snapshot(docId, 'before humanizer changes');
        const r = applyBlockRevisions(editor, range, expectedText, revised);
        if (r.ok) await saver.saveNow();
        return r;
      },
      async replaceRange(range, expectedText, replacement) {
        const { state } = editor;
        if (range.to > state.doc.content.size || state.doc.textBetween(range.from, range.to, '\n', ' ') !== expectedText) {
          return { ok: false, reason: 'The selected text has changed since the suggestion was made.' };
        }
        await saver.saveNow();
        await folio.docs.snapshot(docId, 'before assistant edit');
        const blocks = collectBlocks(state.doc, range.from, range.to);
        const paras = replacement.split(/\n+/).map((x) => x.trim()).filter(Boolean);
        if (blocks.length > 1 && blocks.length === paras.length) {
          applyBlockRevisions(editor, range, blocksText(blocks), paras);
        } else if (blocks.length <= 1 && paras.length <= 1) {
          editor.chain().focus().insertContentAt(range, { type: 'text', text: paras[0] || '' }).run();
        } else {
          editor.chain().focus().insertContentAt(range, paras.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))).run();
        }
        await saver.saveNow();
        return { ok: true };
      },
    };
    return () => { if (app.editorRef.current?.docId === docId) app.editorRef.current = null; };
  }, [editor, docId, saver.saveNow]);

  // Keyboard shortcuts while the editor view is visible.
  useEffect(() => {
    if (!visible || !editor) return undefined;
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && !e.shiftKey) { e.preventDefault(); setFind('find'); }
      else if (k === 'h' && !e.shiftKey) { e.preventDefault(); setFind('replace'); }
      else if (k === 'k') { e.preventDefault(); setLinkOpen(true); }
      else if (k === 's') { e.preventDefault(); saver.saveNow(); }
      else if (k === 'h' && e.shiftKey) { e.preventDefault(); humanize(); }
      else if (k === 'e' && !e.shiftKey) { e.preventDefault(); doExport('docx'); }
      else if (k === 'p' && e.shiftKey) { e.preventDefault(); doExport('pdf'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, editor]);

  const commitTitle = (v) => {
    const t = v.trim() || 'Untitled document';
    setTitle(t);
    titleRef.current = t;
    app.setActiveTitle(t);
    folio.docs.save(docId, { title: t }).then(onSaved).catch((e) => toast('Could not rename', { kind: 'error', detail: e.message }));
  };

  const restore = async (at) => {
    const ok = await confirm({ title: 'Restore this version?', message: 'The current text is saved as a version first, so you can switch back at any time.', confirmLabel: 'Restore' });
    if (!ok) return;
    await saver.saveNow();
    try {
      await folio.docs.restoreSnapshot(docId, at);
      const d = await folio.docs.get(docId);
      editor.commands.setContent(d.json || d.html || '', { emitUpdate: false });
      updateCounts(editor);
      app.refreshDocs();
      toast('Version restored', { kind: 'ok' });
      setHistoryOpen(false);
    } catch (e) { toast('Could not restore', { kind: 'error', detail: e.message }); }
  };

  if (!editor) return null;
  const blockValue = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';
  const setBlock = (v) => {
    const c = editor.chain().focus();
    if (v === 'p') c.setParagraph().run(); else c.toggleHeading({ level: Number(v[1]) }).run();
  };
  const tb = (active, onClick, icon, tip, disabled) => (
    <button type="button" className={`tb${active ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick} data-tip={tip} aria-label={tip} disabled={disabled}>{icon}</button>
  );

  const docMenu = (e) => openMenu(e, [
    { label: 'Insert a file…', icon: <FileUp />, onClick: insertFromDialog },
    { label: 'Version history', icon: <History />, onClick: () => setHistoryOpen(true) },
    { label: 'Duplicate', icon: <Copy />, onClick: async () => { const d = await folio.docs.duplicate(docId); app.refreshDocs(); toast(`Created “${d.title}”`, { kind: 'ok', action: { label: 'Open', onClick: () => app.openDoc(d.id) } }); } },
    'sep',
    { label: 'Move to trash', icon: <Trash2 />, danger: true, onClick: async () => {
      if (!(await confirm({ title: 'Move to trash?', message: `“${titleRef.current}” can be restored from the trash for 30 days.`, confirmLabel: 'Move to trash', danger: true }))) return;
      await saver.saveNow();
      await folio.docs.trash(docId);
      app.refreshDocs();
      app.setActiveDocId(null);
      app.setView('library');
    } },
  ], 'right');

  const pageClass = `page${settings.page === 'paper' ? ' paper' : settings.page === 'flat' ? ' flat' : ''}`;

  return (
    <>
      <div className="ed-head">
        <button className="btn ghost icon sm" onClick={() => app.setView('library')} data-tip="All documents"><ChevronLeft /></button>
        <input className="ed-title" value={title} onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; }} onBlur={(e) => commitTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); editor.commands.focus(); } }} aria-label="Document title" style={{ width: `${Math.max(12, title.length + 2)}ch` }} />
        <SaveState state={saver.state} />
        <span className="spacer" />
        <button className="btn sm" onClick={humanize} data-tip="Revise the selection, or the whole document (Ctrl+Shift+H)"><Wand2 />Humanize</button>
        <button className={`btn sm syrix${app.assistantOpen ? ' active' : ''}`} onClick={() => app.setAssistantOpen(!app.assistantOpen)} data-tip="Ask SYRIX about this document (Ctrl+J)"><img src={tileUrl} alt="" />SYRIX</button>
        <button className="btn sm" onClick={(e) => openMenu(e, EXPORT_FORMATS.map((f) => ({ label: f.label, icon: <Download />, onClick: () => doExport(f.id), hint: f.id === 'docx' ? 'Ctrl+E' : f.id === 'pdf' ? 'Ctrl+Shift+P' : undefined })), 'right')} disabled={Boolean(exporting)}>
          {exporting ? <span className="spinner" /> : <Download />}Export
        </button>
        <button className="btn ghost icon sm" onClick={docMenu} aria-label="More"><MoreHorizontal /></button>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Formatting">
        <select className="tb-select" value={blockValue} onChange={(e) => setBlock(e.target.value)} aria-label="Text style">
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <span className="sep" />
        {tb(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold />, 'Bold (Ctrl+B)')}
        {tb(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic />, 'Italic (Ctrl+I)')}
        {tb(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon />, 'Underline (Ctrl+U)')}
        {tb(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <Strikethrough />, 'Strikethrough')}
        {tb(editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), <Code2 />, 'Inline code')}
        <span className="sep" />
        {tb(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List />, 'Bulleted list (Ctrl+Shift+8)')}
        {tb(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered />, 'Numbered list (Ctrl+Shift+7)')}
        {tb(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote />, 'Quote')}
        {tb(false, () => editor.chain().focus().setHorizontalRule().run(), <Minus />, 'Divider')}
        <span className="sep" />
        {tb(editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run(), <AlignLeft />, 'Align left (Ctrl+Shift+L)')}
        {tb(editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run(), <AlignCenter />, 'Centre (Ctrl+Shift+E)')}
        {tb(editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run(), <AlignRight />, 'Align right (Ctrl+Shift+R)')}
        {tb(editor.isActive({ textAlign: 'justify' }), () => editor.chain().focus().setTextAlign('justify').run(), <AlignJustify />, 'Justify (Ctrl+Shift+J)')}
        <span className="sep" />
        {tb(editor.isActive('link'), () => setLinkOpen(true), <Link2 />, 'Link (Ctrl+K)')}
        <span className="sep" />
        {tb(false, () => editor.chain().focus().undo().run(), <Undo2 />, 'Undo (Ctrl+Z)', !editor.can().undo())}
        {tb(false, () => editor.chain().focus().redo().run(), <Redo2 />, 'Redo (Ctrl+Y)', !editor.can().redo())}
        <span className="spacer" />
        {tb(Boolean(find), () => setFind(find ? null : 'find'), <Search />, 'Find and replace (Ctrl+F / Ctrl+H)')}
        {tb(historyOpen, () => setHistoryOpen((v) => !v), <History />, 'Version history')}
      </div>

      <div className="ed-wrap" style={{ position: 'relative' }}>
        <div className="ed-scroll" data-own-drop>
          <div className={pageClass} style={{ '--page-width': `${settings.width || 760}px`, '--doc-size': `${settings.fontSize || 18}px` }} onMouseDown={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end'); }}>
            <EditorContent editor={editor} />
          </div>
        </div>
        {find && <FindBar editor={editor} replaceMode={find === 'replace'} onClose={() => { setFind(null); editor.commands.focus(); }} />}
        {historyOpen && <HistoryPanel docId={docId} onRestore={restore} onClose={() => setHistoryOpen(false)} />}
      </div>

      <BubbleMenu editor={editor} options={{ placement: 'top' }} shouldShow={({ editor: ed, state }) => visible && !state.selection.empty && ed.isEditable && !find}>
        <div className="bubble">
          <button className="tb" onMouseDown={(e) => e.preventDefault()} onClick={humanize}><Wand2 size={14} />Humanize</button>
          <button className="tb" onMouseDown={(e) => e.preventDefault()} onClick={() => app.setAssistantOpen(true)}><MessageSquare size={14} />Ask SYRIX</button>
          <button className={`tb${editor.isActive('bold') ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold"><Bold size={14} /></button>
          <button className={`tb${editor.isActive('italic') ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic"><Italic size={14} /></button>
          <button className={`tb${editor.isActive('link') ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setLinkOpen(true)} aria-label="Link"><Link2 size={14} /></button>
        </div>
      </BubbleMenu>

      {linkOpen && <LinkPopover editor={editor} onClose={() => setLinkOpen(false)} />}

      <div className="statusbar">
        <span><b>{num(counts.words)}</b> words</span>
        <span><b>{num(counts.chars)}</b> characters</span>
        <span>{readingTime(counts.words)}</span>
        {counts.sel > 0 && <span className="accent">{num(counts.sel)} selected</span>}
        <span className="spacer" />
        {doc?.source && <span><FileText size={12} style={{ verticalAlign: -2 }} /> Imported from {doc.source.name}</span>}
        <span>Created {relTime(doc?.createdAt)}</span>
      </div>
      {menuNode}
    </>
  );
}
