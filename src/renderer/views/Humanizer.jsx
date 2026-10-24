import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Wand2, FileText, History, Plus, Copy, FilePlus2, CornerDownLeft, Square, Lock, Cloud, RotateCw,
  ClipboardPaste, Trash2,
} from 'lucide-react';
import { useApp } from '../App.jsx';
import { useUi, useMenu, Progress } from '../components/ui.jsx';
import { DEFAULT_CONTROLS, applyPreset } from '../../shared/humanizer/controls.js';
import { splitParagraphs, countWords } from '../../shared/text/tokenize.js';
import Controls from './humanizer/Controls.jsx';
import { HighlightedInput, useAnalysis, AnalysisPanel } from './humanizer/InputPane.jsx';
import { MetricsStrip, CheckSummary, ParagraphCard, Composer, ReviewBar } from './humanizer/Review.jsx';
import { relTime, newRunId, num } from '../lib/format.js';

const folio = window.folio;
const STAGES = [['analyse', 'Analyse'], ['rewrite', 'Rewrite'], ['repair', 'Repair'], ['audit', 'Meaning check'], ['done', 'Review']];

function describeTarget(t) {
  if (!t) return '';
  if (t.provider === 'ollama') return `${t.model} on this computer (Ollama)`;
  if (t.provider === 'groq') return `Groq free tier · ${t.model}`;
  return `OpenRouter free model · ${t.model}`;
}

export default function Humanizer({ visible }) {
  const app = useApp();
  const { toast, confirm } = useUi();
  const [openMenu, menuNode] = useMenu();

  const [controls, setControls] = useState(DEFAULT_CONTROLS);
  const [presetId, setPresetId] = useState('natural');
  const [pipeline, setPipeline] = useState({ audit: true, autoRepair: true });
  const [profiles, setProfiles] = useState([]);
  const [profile, setProfile] = useState(null);
  const [chain, setChain] = useState([]);

  const [text, setText] = useState('');
  const [source, setSource] = useState(null);
  const [session, setSession] = useState(null);
  const [versionIdx, setVersionIdx] = useState(0);
  const [decisions, setDecisions] = useState({}); // { [n]: { [i]: 'accepted' | 'rejected' | 'edited' } }
  const [edits, setEdits] = useState({}); // { [n]: { [i]: text } }
  const [viewMode, setViewMode] = useState('side');
  const [compare, setCompare] = useState('original');
  const [run, setRun] = useState(null); // { id, stage, detail, progress, wait, partial }
  const [focus, setFocus] = useState(null);
  const runRef = useRef(null);
  const lastRunReq = useRef(null);

  const analysis = useAnalysis(text);

  // Settings, profiles and the provider chain.
  useEffect(() => {
    const s = app.settings?.humanizer;
    if (s) {
      setControls({ ...DEFAULT_CONTROLS, ...(s.controls || {}) });
      setPresetId(s.defaultPreset || 'natural');
      setPipeline({ audit: s.audit !== false, autoRepair: s.autoRepair !== false });
    }
  }, [Boolean(app.settings)]);
  useEffect(() => {
    if (!visible) return;
    folio.profiles.list().then(setProfiles).catch(() => {});
    folio.providers.chain('rewrite').then(setChain).catch(() => {});
  }, [visible, app.settings]);
  // Match the writer's voice by default once they have a profile with samples,
  // until they choose otherwise.
  useEffect(() => {
    if (controls.profileId || app.settings?.humanizer?.profileChoiceMade) return;
    const p = profiles.find((x) => x.sampleCount > 0);
    if (p) setControls((c) => ({ ...c, profileId: p.id }));
  }, [profiles]);
  useEffect(() => {
    if (!controls.profileId) { setProfile(null); return; }
    folio.profiles.get(controls.profileId).then(setProfile).catch(() => setProfile(null));
  }, [controls.profileId]);

  // Remember controls between sessions.
  const saveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { folio.settings.update({ humanizer: { controls, defaultPreset: presetId, audit: pipeline.audit, autoRepair: pipeline.autoRepair } }).catch(() => {}); }, 800);
  }, [controls, presetId, pipeline]);

  // Text handed over from the editor, or a past session reopened.
  useEffect(() => {
    const seed = app.humanizerSeed;
    if (!seed) return;
    if (seed.profileId) setControls((c) => ({ ...c, profileId: seed.profileId }));
    if (seed.keepText) { app.setHumanizerSeed(null); return; }
    if (seed.sessionId) {
      folio.sessions.get(seed.sessionId).then((s) => { if (s) loadSession(s); }).catch(() => {});
    } else {
      setSession(null);
      setText(seed.text || '');
      setSource(seed.source || null);
      setDecisions({});
      setEdits({});
    }
    app.setHumanizerSeed(null);
  }, [app.humanizerSeed]);

  const loadSession = (s) => {
    setSession(s);
    setText(s.original);
    setSource(s.source || null);
    setVersionIdx(Math.max(0, (s.versions?.length || 1) - 1));
    setDecisions(s.decisions || {});
    setEdits(s.edits || {});
    const last = s.versions?.[s.versions.length - 1];
    if (last?.controls) setControls({ ...DEFAULT_CONTROLS, ...last.controls });
  };

  // Persist decisions so a reopened session shows the same choices.
  useEffect(() => {
    if (!session?.id) return;
    const t = setTimeout(() => folio.sessions.update(session.id, { decisions, edits }).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [decisions, edits, session?.id]);

  // Pipeline events.
  useEffect(() => folio.humanizer.onEvent((e) => {
    const cur = runRef.current;
    if (!cur || e.runId !== cur.id) return;
    if (e.type === 'session') {
      runRef.current = { ...cur, sessionId: e.sessionId };
    } else if (e.type === 'stage') {
      setRun((r) => r && { ...r, stage: e.stage, detail: e.detail, progress: e.progress, wait: null });
    } else if (e.type === 'status') {
      if (e.type === 'status' && e.seconds) setRun((r) => r && { ...r, wait: { seconds: e.seconds, model: e.model, until: Date.now() + e.seconds * 1000 } });
      if (e.type === 'status' && e.reason) setRun((r) => r && { ...r, detail: `Switched to ${e.model} (${e.reason === 'rate' ? 'free-tier limit reached' : 'previous model unavailable'})` });
    } else if (e.type === 'paragraph') {
      setRun((r) => r && { ...r, partial: { ...(r.partial || {}), [e.index]: e.text } });
    } else if (e.type === 'done') {
      runRef.current = null;
      const s = e.session;
      const prevN = session?.versions?.length ? session.versions[session.versions.length - 1].n : null;
      const newV = s.versions[s.versions.length - 1];
      // Carry decisions over for paragraphs a scoped rewrite did not touch.
      if (newV.scope && prevN) {
        setDecisions((d) => {
          const prev = d[prevN] || {};
          return { ...d, [newV.n]: Object.fromEntries(Object.entries(prev).filter(([i]) => !newV.scope.includes(Number(i)))) };
        });
        setEdits((d) => {
          const prev = d[prevN] || {};
          return { ...d, [newV.n]: Object.fromEntries(Object.entries(prev).filter(([i]) => !newV.scope.includes(Number(i)))) };
        });
      }
      setSession(s);
      setVersionIdx(s.versions.length - 1);
      setRun(null);
      if (newV.error) toast('Some paragraphs could not be revised', { kind: 'error', detail: newV.error.message });
    } else if (e.type === 'error' || e.type === 'cancelled') {
      runRef.current = null;
      setRun(null);
      if (e.type === 'error') toast('The revision did not complete', { kind: 'error', detail: e.error?.message, action: lastRunReq.current ? { label: 'Retry', onClick: () => start(lastRunReq.current) } : undefined });
      else toast('Revision cancelled');
      // A first round that failed leaves the session without versions; reload to show the input.
      if (cur.sessionId && !session) folio.sessions.get(cur.sessionId).then((s) => { if (s?.versions?.length) loadSession(s); }).catch(() => {});
    }
  }), [session]);

  // Countdown for free-tier waits.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!run?.wait) return undefined;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [run?.wait]);

  const start = useCallback(async (req) => {
    const id = newRunId();
    runRef.current = { id };
    lastRunReq.current = req;
    setRun({ id, stage: 'analyse', detail: 'Preparing', progress: 0.02, partial: {} });
    try {
      await folio.humanizer.run(id, { audit: pipeline.audit, autoRepair: pipeline.autoRepair, ...req });
    } catch (e) {
      runRef.current = null;
      setRun(null);
      toast('Could not start the revision', { kind: 'error', detail: e.message });
    }
  }, [pipeline, toast]);

  const startFresh = () => {
    if (!text.trim()) { toast('Add some text to revise first', { kind: 'warn' }); return; }
    if (countWords(text) > 15000) { toast('That is a lot of text for one pass', { kind: 'warn', detail: 'Revise up to about 15,000 words at a time — the free-tier limits make longer runs slow.' }); return; }
    setDecisions({});
    setEdits({});
    const originalSource = source && source.text === text ? source : null;
    if (source && !originalSource) setSource(null);
    start({ text, controls, title: originalSource?.title || undefined, source: originalSource || null });
  };

  const version = session?.versions?.[versionIdx] || null;
  const originals = session?.originalParagraphs || [];
  const prevVersion = version && versionIdx > 0 ? session.versions[versionIdx - 1] : null;
  const vDec = (version && decisions[version.n]) || {};
  const vEdits = (version && edits[version.n]) || {};
  const busy = Boolean(run);

  const setDecision = (i, d) => setDecisions((all) => ({ ...all, [version.n]: { ...(all[version.n] || {}), [i]: d } }));
  const setEdit = (i, t) => {
    setEdits((all) => {
      const cur = { ...(all[version.n] || {}) };
      if (t == null) delete cur[i]; else cur[i] = t;
      return { ...all, [version.n]: cur };
    });
    setDecision(i, t == null ? null : 'edited');
  };

  const merged = useMemo(() => {
    if (!version) return [];
    return originals.map((o, i) => {
      const d = vDec[i];
      if (d === 'edited' && vEdits[i] != null) return vEdits[i];
      if (d === 'accepted') return vEdits[i] ?? version.paragraphs[i].text;
      return o;
    });
  }, [version, originals, vDec, vEdits]);
  const acceptedCount = Object.values(vDec).filter((d) => d === 'accepted' || d === 'edited').length;
  const changedCount = version ? version.paragraphs.filter((p, i) => p.text !== originals[i] && p.status === 'ok').length : 0;

  const acceptAll = () => {
    const errors = version.paragraphs.some((p) => (p.issues || []).some((x) => x.severity === 'error' && !x.resolved));
    const next = {};
    version.paragraphs.forEach((p, i) => {
      if (p.status !== 'ok' || p.text === originals[i]) return;
      if ((p.issues || []).some((x) => x.severity === 'error' && !x.resolved)) return;
      next[i] = vEdits[i] != null ? 'edited' : 'accepted';
    });
    setDecisions((all) => ({ ...all, [version.n]: next }));
    if (errors) toast('Paragraphs with changed details were left for you to review', { kind: 'warn' });
  };

  const revise = (feedback) => start({ sessionId: session.id, controls, feedback });
  const regenerate = () => start({ sessionId: session.id, controls, regenerate: true });
  const regenerateOne = (i, note) => start({ sessionId: session.id, controls, scope: [i], feedback: note ? { text: note } : undefined });
  const retryFailed = () => {
    const failed = version.paragraphs.map((p, i) => (p.status === 'failed' ? i : -1)).filter((i) => i >= 0);
    if (failed.length) start({ sessionId: session.id, controls, scope: failed });
  };

  const resultText = merged.join('\n\n');

  const applyToDocument = async () => {
    if (!source?.docId) return;
    if (!acceptedCount) { toast('Accept or edit at least one paragraph first', { kind: 'warn' }); return; }
    const ok = await confirm({
      title: 'Apply to document?',
      message: `${acceptedCount} paragraph${acceptedCount === 1 ? '' : 's'} in “${source.title}” will be replaced with your accepted revisions. Paragraphs you did not accept keep their original text.\n\nA version of the document is saved first, and you can also undo with Ctrl+Z.`,
      confirmLabel: 'Apply changes',
    });
    if (!ok) return;
    if (app.editorRef.current?.docId !== source.docId) {
      app.openDoc(source.docId);
      for (let i = 0; i < 40 && app.editorRef.current?.docId !== source.docId; i++) await new Promise((r) => setTimeout(r, 75));
      await new Promise((r) => setTimeout(r, 250));
    }
    const ed = app.editorRef.current;
    if (!ed || ed.docId !== source.docId) { toast('The document could not be opened', { kind: 'error' }); return; }
    const r = await ed.applyRevisions(source.range, source.text, merged);
    if (r.ok) {
      folio.sessions.update(session.id, { appliedAt: Date.now() }).catch(() => {});
      toast(`Applied ${r.changed} paragraph${r.changed === 1 ? '' : 's'} to “${source.title}”`, { kind: 'ok' });
      app.setView('editor');
    } else {
      toast('The revision could not be applied in place', { kind: 'error', detail: `${r.reason} Copy the result or save it as a new document instead.` });
    }
  };

  const copyResult = async () => {
    try { await navigator.clipboard.writeText(resultText); toast('Result copied', { kind: 'ok', detail: acceptedCount ? undefined : 'No paragraphs were accepted, so this is the original text.' }); } catch (e) { toast('Could not copy', { kind: 'error', detail: e.message }); }
  };
  const saveAsDoc = async () => {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title = `${session.title.slice(0, 50)}${session.title.length > 50 ? '…' : ''} (revised)`;
    await app.newDoc({ title, html: merged.map((p) => `<p>${esc(p)}</p>`).join(''), text: merged.join('\n'), wordCount: countWords(resultText) });
  };

  const showHistory = async (e) => {
    const target = e.currentTarget;
    const list = await folio.sessions.list().catch(() => []);
    openMenu({ currentTarget: target }, [
      { label: 'New revision', icon: <Plus />, onClick: () => { setSession(null); setText(''); setSource(null); setDecisions({}); setEdits({}); } },
      list.length ? 'sep' : null,
      ...list.slice(0, 14).map((s) => ({ label: `${s.title.slice(0, 46)}${s.title.length > 46 ? '…' : ''}`, icon: <History />, hint: relTime(s.updatedAt), onClick: () => folio.sessions.get(s.id).then(loadSession) })),
      session ? 'sep' : null,
      session ? { label: 'Delete this revision session', icon: <Trash2 />, danger: true, onClick: async () => { await folio.sessions.remove(session.id); setSession(null); } } : null,
    ], 'right');
  };

  const pasteFromClipboard = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) setText(t); } catch { toast('Clipboard is not available', { kind: 'warn' }); }
  };

  const local = chain[0]?.provider === 'ollama';
  const words = analysis.features?.wordCount || 0;
  const stageIdx = run ? STAGES.findIndex(([s]) => s === run.stage) : -1;
  const waitLeft = run?.wait ? Math.max(0, Math.ceil((run.wait.until - Date.now()) / 1000)) : 0;

  return (
    <>
      <div className="hz">
        <Controls
          controls={controls}
          onChange={(c) => {
            if (c.profileId !== controls.profileId) folio.settings.update({ humanizer: { profileChoiceMade: true } }).catch(() => {});
            setControls(c);
          }}
          presetId={presetId}
          onPreset={(id) => { setPresetId(id); setControls(applyPreset(controls, id)); }}
          profiles={profiles}
          onManageProfiles={() => app.setView('profiles')}
          pipeline={pipeline}
          onPipeline={setPipeline}
        />
        <div className="hz-main">
          <div className="hz-top">
            <Wand2 size={18} className="accent" />
            <h1>Humanizer</h1>
            {source?.docId && <span className="source-chip" data-tip="Accepted changes can be applied back to this document"><FileText />{source.kind === 'selection' ? 'Selection from' : 'Whole of'} “<span className="ellipsis">{source.title}</span>”</span>}
            {session && <span className="source-chip">{num(session.analysis?.wordCount || 0)} words · {session.versions.length} version{session.versions.length === 1 ? '' : 's'}</span>}
            <span className="spacer" />
            <button className="btn sm ghost" onClick={showHistory}><History />Sessions</button>
            {session && !busy && <button className="btn sm" onClick={() => { setSession(null); setDecisions({}); setEdits({}); }}><CornerDownLeft />Edit input</button>}
          </div>

          {run && (
            <div className="run-panel" role="status" aria-live="polite">
              <div className="stage">
                <span className="spinner" />
                <span className="grow">{run.wait && waitLeft > 0 ? `Waiting ${waitLeft}s for the free-tier allowance on ${run.wait.model}…` : run.detail}</span>
                <button className="btn sm" onClick={() => folio.humanizer.cancel(run.id)}><Square size={12} />Cancel</button>
              </div>
              <Progress value={run.progress} />
              <div className="run-steps">{STAGES.map(([s, l], i) => <span key={s} className={i === stageIdx ? 'on' : i < stageIdx ? 'done' : ''}>{l}{i < STAGES.length - 1 ? ' ·' : ''}</span>)}</div>
            </div>
          )}

          {!session || !version ? (
            <div className="hz-input">
              <div className="hz-editor-wrap">
                <HighlightedInput value={text} onChange={(v) => { setText(v); setFocus(null); }} issues={analysis.issues} focus={focus} disabled={busy} placeholder="Paste or type the text you want to revise. Each line break starts a new paragraph." />
                <div className="hz-input-foot">
                  <button className="btn ghost sm" onClick={pasteFromClipboard} disabled={busy}><ClipboardPaste />Paste</button>
                  {text && <button className="btn ghost sm" onClick={() => { setText(''); setSource(null); }} disabled={busy}>Clear</button>}
                  <span className="note" data-tip={local ? 'Local-only mode: nothing leaves this computer.' : 'Only the text you revise (and profile excerpts, if a profile is selected) is sent. Nothing is stored by Folio outside this computer.'}>
                    {local ? <Lock size={12} /> : <Cloud size={12} />} {chain[0] ? (local ? "Runs on this computer" : "Free AI · Groq") : "No AI connected"}
                  </span>
                  <span className="spacer" />
                  <button className="btn primary lg" onClick={startFresh} disabled={busy || !text.trim()}><Wand2 />Revise</button>
                </div>
              </div>
              <AnalysisPanel analysis={analysis} profile={profile} focus={focus} onFocusIssue={setFocus} />
            </div>
          ) : (
            <>
              <div className="review">
                <ReviewBar
                  session={session} versionIdx={versionIdx} setVersionIdx={setVersionIdx}
                  viewMode={viewMode} setViewMode={setViewMode} compare={compare} setCompare={setCompare}
                  onAcceptAll={acceptAll}
                  onRejectAll={() => setDecisions((all) => ({ ...all, [version.n]: {} }))}
                />
                <MetricsStrip version={version} profileName={version.profileName} />
                <CheckSummary version={version} />
                <div className="paras">
                  {version.paragraphs.map((p, i) => (
                    <ParagraphCard
                      key={`${version.n}-${i}`}
                      index={i}
                      original={originals[i]}
                      para={busy && run.partial?.[i] && (run.partial[i] !== p.text) ? { ...p, text: run.partial[i], issues: [] } : p}
                      prevText={prevVersion ? prevVersion.paragraphs[i]?.text : null}
                      decision={vDec[i]}
                      edit={vEdits[i]}
                      onDecide={(d) => setDecision(i, d)}
                      onEdit={(t) => setEdit(i, t)}
                      onRegenerate={(note) => regenerateOne(i, note)}
                      viewMode={viewMode}
                      compare={compare}
                      busy={busy}
                    />
                  ))}
                </div>
              </div>
              <div className="row" style={{ padding: '10px 20px', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
                <span className="note">{acceptedCount} of {changedCount} changed paragraph{changedCount === 1 ? '' : 's'} accepted. Unaccepted paragraphs keep their original text.</span>
                <span className="spacer" />
                {version.paragraphs.some((p) => p.status === 'failed') && <button className="btn sm" onClick={retryFailed} disabled={busy}><RotateCw />Retry failed</button>}
                <button className="btn sm" onClick={copyResult}><Copy />Copy result</button>
                <button className="btn sm" onClick={saveAsDoc}><FilePlus2 />Save as document</button>
                {source?.docId && <button className="btn sm primary" onClick={applyToDocument} disabled={!acceptedCount || busy}><FileText />Apply to document</button>}
              </div>
              <Composer onRevise={revise} onRegenerate={regenerate} busy={busy} notes={version.feedback} />
            </>
          )}
        </div>
      </div>
      {menuNode}
    </>
  );
}
