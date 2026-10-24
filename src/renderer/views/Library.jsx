import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, FileUp, MoreHorizontal, Pin, PinOff, Copy, Trash2, RotateCcw, LayoutGrid, List as ListIcon, Download, FileText, Pencil } from 'lucide-react';
import { useApp } from '../App.jsx';
import { useUi, useMenu, Empty, Seg, Modal } from '../components/ui.jsx';
import { relTime, num } from '../lib/format.js';
import { exportDocument, EXPORT_FORMATS } from '../lib/export.js';

const folio = window.folio;

export default function Library() {
  const app = useApp();
  const { toast, confirm } = useUi();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('updated');
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('folio.layout') || 'grid'; } catch { return 'grid'; } });
  const [tab, setTab] = useState('docs');
  const [trash, setTrash] = useState([]);
  const [renaming, setRenaming] = useState(null);
  const [openMenu, menuNode] = useMenu();

  useEffect(() => { try { localStorage.setItem('folio.layout', layout); } catch { /* storage unavailable */ } }, [layout]);
  useEffect(() => { if (tab === 'trash') folio.docs.list({ trashed: true }).then(setTrash).catch(() => {}); }, [tab, app.docs]);

  const list = useMemo(() => {
    const src = tab === 'trash' ? trash : app.docs;
    const needle = q.trim().toLowerCase();
    let out = needle ? src.filter((d) => d.title.toLowerCase().includes(needle) || (d.preview || '').toLowerCase().includes(needle)) : src;
    out = [...out];
    if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'created') out.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === 'words') out.sort((a, b) => b.wordCount - a.wordCount);
    else out.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
    return out;
  }, [app.docs, trash, q, sort, tab]);

  const exportDoc = async (id, format) => {
    try {
      const d = await folio.docs.get(id);
      const r = await exportDocument(d, format);
      if (!r.canceled) toast(`Exported ${r.path.split(/[\\/]/).pop()}`, { kind: 'ok', action: { label: 'Show', onClick: () => folio.files.showInFolder(r.path) } });
    } catch (e) { toast('Export failed', { kind: 'error', detail: e.message }); }
  };

  const menuFor = (e, d) => {
    e.stopPropagation();
    if (tab === 'trash') {
      openMenu(e, [
        { label: 'Restore', icon: <RotateCcw />, onClick: async () => { await folio.docs.restore(d.id); await app.refreshDocs(); setTrash(await folio.docs.list({ trashed: true })); toast('Document restored', { kind: 'ok' }); } },
        { label: 'Delete permanently', icon: <Trash2 />, danger: true, onClick: async () => {
          if (!(await confirm({ title: 'Delete permanently?', message: `“${d.title}” and its version history will be deleted. This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
          await folio.docs.destroy(d.id);
          setTrash(await folio.docs.list({ trashed: true }));
        } },
      ], 'right');
      return;
    }
    openMenu(e, [
      { label: 'Open', icon: <FileText />, onClick: () => app.openDoc(d.id) },
      { label: 'Rename', icon: <Pencil />, onClick: () => setRenaming({ id: d.id, title: d.title }) },
      { label: d.pinned ? 'Unpin' : 'Pin to top', icon: d.pinned ? <PinOff /> : <Pin />, onClick: async () => { await folio.docs.save(d.id, { pinned: !d.pinned }); app.refreshDocs(); } },
      { label: 'Duplicate', icon: <Copy />, onClick: async () => { await folio.docs.duplicate(d.id); app.refreshDocs(); } },
      'sep',
      ...EXPORT_FORMATS.map((f) => ({ label: `Export as ${f.label}`, icon: <Download />, onClick: () => exportDoc(d.id, f.id) })),
      'sep',
      { label: 'Move to trash', icon: <Trash2 />, danger: true, onClick: async () => {
        if (app.activeDocId === d.id) { app.setActiveDocId(null); }
        await folio.docs.trash(d.id);
        await app.refreshDocs();
        toast(`Moved “${d.title}” to trash`, { action: { label: 'Undo', onClick: async () => { await folio.docs.restore(d.id); app.refreshDocs(); } } });
      } },
    ], 'right');
  };

  const open = (d) => { if (tab !== 'trash') app.openDoc(d.id); };

  const doRename = async () => {
    const t = renaming.title.trim();
    if (!t) return;
    await folio.docs.save(renaming.id, { title: t });
    if (app.activeDocId === renaming.id) app.setActiveTitle(t);
    setRenaming(null);
    app.refreshDocs();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Documents</h1>
          <div className="lede">{num(app.docs.length)} document{app.docs.length === 1 ? '' : 's'} · stored on this computer</div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => app.importDocs()}><FileUp />Import</button>
        <button className="btn primary" onClick={() => app.newDoc()}><Plus />New document</button>
      </div>
      <div className="lib-toolbar">
        <div className="search"><Search /><input className="input" placeholder="Search titles and text" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Seg value={tab} onChange={setTab} options={[['docs', 'All'], ['trash', 'Trash']]} />
        <span className="spacer" />
        <select className="select" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="updated">Last edited</option>
          <option value="created">Date created</option>
          <option value="title">Title</option>
          <option value="words">Length</option>
        </select>
        <Seg value={layout} onChange={setLayout} options={[['grid', <LayoutGrid key="g" size={14} />, 'Grid'], ['list', <ListIcon key="l" size={14} />, 'List']]} />
      </div>
      <div className="page-scroll">
        <div className="page-pad">
          {tab === 'trash' && <div className="note" style={{ marginBottom: 12 }}>Documents in the trash are deleted permanently after 30 days.</div>}
          {!list.length && (q
            ? <Empty icon={<Search />} title="No matches">Nothing matches “{q}”.</Empty>
            : tab === 'trash'
              ? <Empty icon={<Trash2 />} title="Trash is empty" />
              : <Empty icon={<FileText />} title="No documents yet" action={<button className="btn primary" onClick={() => app.newDoc()}><Plus />New document</button>}>Create a document or drop Word, PDF, Markdown or text files here.</Empty>)}
          {list.length > 0 && layout === 'grid' && (
            <div className="doc-grid">
              {tab === 'docs' && !q && <button className="doc-card new" onClick={() => app.newDoc()}><Plus />New document</button>}
              {list.map((d) => (
                <div key={d.id} className="doc-card" onClick={() => open(d)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(d); }}>
                  <h3>{d.pinned && <Pin size={13} className="pin" style={{ marginRight: 6 }} />}{d.title}</h3>
                  <p>{d.preview || 'Empty document'}</p>
                  <div className="meta"><span>{num(d.wordCount)} words</span><span>·</span><span>{tab === 'trash' ? `Deleted ${relTime(d.trashedAt)}` : relTime(d.updatedAt)}</span></div>
                  <button className="btn ghost icon sm more" onClick={(e) => menuFor(e, d)} aria-label="Document actions"><MoreHorizontal /></button>
                </div>
              ))}
            </div>
          )}
          {list.length > 0 && layout === 'list' && (
            <div className="doc-list">
              {list.map((d) => (
                <div key={d.id} className="doc-row" onClick={() => open(d)}>
                  <span className="t ellipsis">{d.pinned && <Pin size={12} className="pin" style={{ marginRight: 6 }} />}{d.title}</span>
                  <span className="muted">{num(d.wordCount)} words</span>
                  <span className="muted">{relTime(tab === 'trash' ? d.trashedAt : d.updatedAt)}</span>
                  <button className="btn ghost icon sm" onClick={(e) => menuFor(e, d)} aria-label="Document actions"><MoreHorizontal /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {renaming && (
        <Modal title="Rename document" onClose={() => setRenaming(null)} footer={<><button className="btn" onClick={() => setRenaming(null)}>Cancel</button><button className="btn primary" onClick={doRename}>Rename</button></>}>
          <input className="input" autoFocus value={renaming.title} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') doRename(); }} />
        </Modal>
      )}
      {menuNode}
    </>
  );
}
