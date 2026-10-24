import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Wand2, UserRound, FlaskConical, Newspaper, Settings as SettingsIcon, PanelLeftClose,
  PanelLeftOpen, Home as HomeIcon,
} from 'lucide-react';
import { UiProvider, TooltipLayer, useUi } from './components/ui.jsx';
import Home from './views/Home.jsx';
import Library from './views/Library.jsx';
import Editor from './views/Editor.jsx';
import Humanizer from './views/Humanizer.jsx';
import Profiles from './views/Profiles.jsx';
import Lab from './views/Lab.jsx';
import News from './views/News.jsx';
import Settings from './views/Settings.jsx';
import Assistant from './views/Assistant.jsx';
import markUrl from './assets/syrix-mark.png';
import tileUrl from './assets/syrix-tile.png';
import folioLogoUrl from './assets/folio-logo.png';

const folio = window.folio;
const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
export { markUrl, tileUrl, folioLogoUrl };

const NAV = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'library', label: 'Documents', icon: FileText },
  { id: 'humanizer', label: 'Humanizer', icon: Wand2, feature: true },
  { id: 'profiles', label: 'Writing profiles', icon: UserRound },
];
const NAV_RESEARCH = [
  { id: 'lab', label: 'Detector lab', icon: FlaskConical },
  { id: 'news', label: 'AI & detector news', icon: Newspaper },
];

function Shell() {
  const { toast } = useUi();
  const [view, setView] = useState('home');
  const [collapsed, setCollapsed] = useState(false);
  const [docs, setDocs] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [activeTitle, setActiveTitle] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [humanizerSeed, setHumanizerSeed] = useState(null);
  const [selection, setSelection] = useState({ text: '', from: 0, to: 0 });
  const editorRef = useRef(null); // { editor, applyRange, getText, docId }

  const refreshDocs = useCallback(async () => {
    try { setDocs(await folio.docs.list()); } catch (e) { toast('Could not load documents', { kind: 'error', detail: e.message }); }
  }, [toast]);

  useEffect(() => {
    refreshDocs();
    folio.settings.get().then(setSettings).catch(() => {});
  }, [refreshDocs]);

  const updateSettings = useCallback(async (patch) => {
    const next = await folio.settings.update(patch);
    setSettings(next);
    return next;
  }, []);

  const openDoc = useCallback((id) => {
    setActiveDocId(id);
    setView('editor');
  }, []);

  const newDoc = useCallback(async (opts = {}) => {
    const d = await folio.docs.create({ title: 'Untitled document', ...opts });
    await refreshDocs();
    openDoc(d.id);
    return d;
  }, [refreshDocs, openDoc]);

  const importDocs = useCallback(async (paths) => {
    try {
      const r = paths ? await folio.files.importPaths(paths) : await folio.files.importDialog();
      if (r.canceled) return;
      for (const f of r.failed) toast(`${f.name} could not be imported`, { kind: 'error', detail: f.message });
      if (r.imported.length) {
        await refreshDocs();
        const warns = r.imported.flatMap((x) => x.warnings || []);
        toast(r.imported.length === 1 ? `Imported “${r.imported[0].title}”` : `Imported ${r.imported.length} documents`, { kind: 'ok', detail: warns.length ? warns[0] : undefined });
        if (r.imported.length === 1) openDoc(r.imported[0].id);
        else setView('library');
      }
    } catch (e) {
      toast('Import failed', { kind: 'error', detail: e.message });
    }
  }, [toast, refreshDocs, openDoc]);

  const sendToHumanizer = useCallback((seed) => {
    setHumanizerSeed({ ...seed, at: Date.now() });
    setView('humanizer');
  }, []);

  // Global shortcuts that work from any view.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && !e.shiftKey) { e.preventDefault(); newDoc(); }
      else if (k === 'o' && !e.shiftKey) { e.preventDefault(); importDocs(); }
      else if (k === 'j') { e.preventDefault(); setAssistantOpen((v) => !v); }
      else if (k === '\\') { e.preventDefault(); setCollapsed((v) => !v); }
      else if (e.key === ',') { e.preventDefault(); setView('settings'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newDoc, importDocs]);

  // Files dropped anywhere outside the editor are imported as new documents.
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => { if (!hasFiles(e)) return; depth++; setDragging(true); };
    const leave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.defaultPrevented && e.__folioHandled) return;
      if (e.target.closest?.('[data-own-drop]')) return;
      const paths = [...e.dataTransfer.files].map((f) => folio.app.pathForFile(f)).filter(Boolean);
      if (paths.length) importDocs(paths);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [importDocs]);

  const ctx = useMemo(() => ({
    view, setView, docs, refreshDocs, openDoc, newDoc, importDocs, activeDocId, setActiveDocId,
    activeTitle, setActiveTitle, assistantOpen, setAssistantOpen, settings, updateSettings,
    humanizerSeed, setHumanizerSeed, sendToHumanizer, editorRef, selection, setSelection,
  }), [view, docs, refreshDocs, openDoc, newDoc, importDocs, activeDocId, activeTitle, assistantOpen, settings, updateSettings, humanizerSeed, sendToHumanizer, selection]);

  const navButton = (n) => {
    const Icon = n.icon;
    const count = n.id === 'library' ? docs.length : null;
    return (
      <button key={n.id} className={`nav-item${view === n.id || (n.id === 'library' && view === 'editor') ? ' active' : ''}${n.feature ? ' feature' : ''}`} onClick={() => setView(n.id)} data-tip={collapsed ? n.label : undefined}>
        <Icon /><span>{n.label}</span>
        {n.feature && <span className="tag">Core</span>}
        {count ? <span className="count">{count}</span> : null}
      </button>
    );
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="titlebar">
          <div className="brand"><img src={folioLogoUrl} alt="" />SYRIX Folio</div>
          <div className="center ellipsis">{view === 'editor' && activeTitle ? activeTitle : ''}</div>
        </header>
        <div className={`body${collapsed ? ' collapsed' : ''}`}>
          <nav className="sidebar" aria-label="Main">
            {NAV.map(navButton)}
            <div className="nav-section">Research</div>
            {NAV_RESEARCH.map(navButton)}
            <div className="nav-section">App</div>
            {navButton({ id: 'settings', label: 'Settings', icon: SettingsIcon })}
            <span className="spacer" />
            <button className="nav-item" onClick={() => setCollapsed((v) => !v)} data-tip={collapsed ? 'Expand sidebar' : 'Collapse sidebar (Ctrl+\\)'}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}<span>Collapse</span>
            </button>
            <button className={`syrix-btn${assistantOpen ? ' on' : ''}`} onClick={() => setAssistantOpen((v) => !v)} data-tip={collapsed ? 'Ask SYRIX (Ctrl+J)' : undefined} aria-pressed={assistantOpen}>
              <img src={tileUrl} alt="" />
              <span className="txt"><span className="t">Ask SYRIX</span><br /><span className="s">Writing assistant</span></span>
              <span className="kbd">Ctrl J</span>
            </button>
            <div className="side-foot">
              <div className="txt"><b>Powered by SYRIX</b>Made by Kabirr Kohli</div>
            </div>
          </nav>

          <main className="main">
            <section className="view" hidden={view !== 'home'}><Home /></section>
            <section className="view" hidden={view !== 'library'}><Library /></section>
            {/* The editor stays mounted while a document is open so undo history and cursor survive view changes. */}
            <section className="view" hidden={view !== 'editor'}>{activeDocId && <Editor key={activeDocId} docId={activeDocId} visible={view === 'editor'} />}</section>
            <section className="view" hidden={view !== 'humanizer'}><Humanizer visible={view === 'humanizer'} /></section>
            {view === 'profiles' && <section className="view"><Profiles /></section>}
            {view === 'lab' && <section className="view"><Lab /></section>}
            {view === 'news' && <section className="view"><News /></section>}
            {view === 'settings' && <section className="view"><Settings /></section>}
            {dragging && <div className="dropzone"><FileText />Drop files to import them as documents</div>}
          </main>

          {assistantOpen && <Assistant onClose={() => setAssistantOpen(false)} />}
        </div>
      </div>
      <TooltipLayer />
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  );
}
