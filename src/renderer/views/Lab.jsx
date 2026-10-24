import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, ExternalLink, Database, Play, Plus, Trash2, Download, AlertTriangle, Info, Square, ChevronRight, ChevronDown } from 'lucide-react';
import { useUi, Modal, Seg, Progress, Empty } from '../components/ui.jsx';
import { METHODS, RESEARCH, VENDOR, LIMITS } from './lab/findings.js';
import { dateTime, num, pct } from '../lib/format.js';

const folio = window.folio;
const open = (url) => folio.app.openExternal(url);

function SourceLink({ url, label = 'Source' }) {
  return <a href={url} onClick={(e) => { e.preventDefault(); open(url); }}>{label} <ExternalLink size={11} style={{ verticalAlign: -1 }} /></a>;
}

function Research() {
  return (
    <div className="page-pad prose" style={{ paddingTop: 20 }}>
      <div className="callout" style={{ marginBottom: 18 }}><Info /><div>This page summarises published work. Each entry reports what its source says; Folio’s own measurements are on the Evaluation tab and come only from tests run on this computer.</div></div>

      <h2>How AI-text detectors work</h2>
      {METHODS.map((m) => <div key={m.name} className="finding"><div className="f-head"><b>{m.name}</b></div><p>{m.text}</p></div>)}

      <h2>Independent research</h2>
      {RESEARCH.map((r) => (
        <div key={r.title} className="finding">
          <div className="f-head"><b>{r.title}</b>{r.tags.map((t) => <span key={t} className="badge">{t}</span>)}</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{r.who} · {r.where}</div>
          <p>{r.finding}</p>
          <div className="src row"><SourceLink url={r.url} label="Read the paper" />{r.alt && <SourceLink url={r.alt} label="Preprint" />}</div>
        </div>
      ))}

      <h2>Vendor statements</h2>
      <p className="muted">Claims made by the companies that build detectors, about their own products.</p>
      {VENDOR.map((r) => (
        <div key={r.title} className="finding">
          <div className="f-head"><b>{r.title}</b><span className="badge accent">Vendor claim</span></div>
          <p>{r.finding}</p>
          <div className="src row"><SourceLink url={r.url} />{r.alt && <SourceLink url={r.alt} label="Coverage" />}</div>
        </div>
      ))}

      <h2>Limitations to keep in mind</h2>
      {LIMITS.map(([k, v]) => <div key={k} className="finding"><div className="f-head"><b>{k}</b></div><p>{v}</p></div>)}
    </div>
  );
}

function MetricsTable({ results, detectors }) {
  return (
    <table className="data">
      <thead>
        <tr><th>Detector</th><th>AUROC (95% CI)</th><th>Detected at 1% FPR</th><th>Detected at 5% FPR</th><th>Best threshold: accuracy</th><th>False positives</th><th>False negatives</th></tr>
      </thead>
      <tbody>
        {detectors.map((d) => {
          const r = results[d.id];
          if (!r) return null;
          return (
            <tr key={d.id}>
              <td><b className="dim">{d.name}</b></td>
              <td><div className="row"><span className="mono">{r.auroc == null ? '—' : r.auroc.toFixed(3)}</span>{r.aurocCI && <span className="muted mono">[{r.aurocCI[0].toFixed(2)}–{r.aurocCI[1].toFixed(2)}]</span>}</div><div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${Math.max(0, (r.auroc - 0.5) * 200)}%` }} /></div></td>
              <td className="mono">{r.at1 ? `${pct(r.at1.tpr)}` : '—'}{r.at1 && <div className="muted" style={{ fontSize: 11 }}>actual FPR {pct(r.at1.achievedFpr, 1)}</div>}</td>
              <td className="mono">{r.at5 ? `${pct(r.at5.tpr)}` : '—'}{r.at5 && <div className="muted" style={{ fontSize: 11 }}>actual FPR {pct(r.at5.achievedFpr, 1)}</div>}</td>
              <td className="mono">{pct(r.best.accuracy)}</td>
              <td className="mono">{r.best.fp} of {r.human} human <div className="muted" style={{ fontSize: 11 }}>{pct(r.best.fpr)}</div></td>
              <td className="mono">{r.best.fn} of {r.ai} AI <div className="muted" style={{ fontSize: 11 }}>{pct(r.best.fnr)}</div></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RunView({ runId, state, onDelete }) {
  const { toast } = useUi();
  const [run, setRun] = useState(null);
  const [showSamples, setShowSamples] = useState(false);
  const [sortBy, setSortBy] = useState('binoculars');
  useEffect(() => { folio.lab.getRun(runId).then(setRun).catch(() => setRun(null)); }, [runId]);
  const sampleMap = useMemo(() => Object.fromEntries(state.samples.map((s) => [s.id, s])), [state.samples]);
  if (!run) return <div className="row muted"><span className="spinner" />Loading run</div>;
  const c = run.conditions;
  const rows = [...(run.sampleScores || [])].sort((a, b) => b.scores[sortBy] - a.scores[sortBy]);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="callout warn"><AlertTriangle /><div>
        These are small open models (GPT-2 and DistilGPT-2) implementing published methods. The results describe these detectors on this corpus only; they say nothing direct about commercial products. Thresholds are chosen on the same samples they are scored on, so detection rates are optimistic, and with {c.samples} samples the confidence intervals are wide.
      </div></div>
      <div className="card card-pad">
        <div className="card-title">Test conditions</div>
        <div className="note" style={{ lineHeight: 1.8 }}>
          Run {dateTime(run.createdAt)} · {c.samples} samples ({c.human} human, {c.ai} AI) · text types: {Object.entries(c.textTypes).map(([t, n]) => `${state.types[t] || t} (${n})`).join(', ')}<br />
          Scoring models: {c.models.observer}, {c.models.performer} · {c.quantisation} · first {c.maxTokens} tokens of each sample<br />
          AI samples generated by: {c.generators.join(', ') || 'samples added by the writer'} · {c.preprocessing}
        </div>
      </div>
      <div className="card card-pad">
        <div className="card-title">All samples</div>
        <MetricsTable results={run.overall} detectors={c.detectors} />
      </div>
      {Object.entries(run.byType).map(([t, res]) => (
        <div key={t} className="card card-pad">
          <div className="card-title">{state.types[t] || (t === 'own' ? 'Samples added by the writer' : t)}</div>
          <MetricsTable results={res} detectors={c.detectors} />
        </div>
      ))}
      <div className="card card-pad">
        <button className="btn ghost sm" onClick={() => setShowSamples((v) => !v)}>{showSamples ? <ChevronDown /> : <ChevronRight />}Per-sample scores ({rows.length})</button>
        {showSamples && (
          <>
            <div className="row" style={{ margin: '10px 0' }}><span className="label">Sort by</span><Seg value={sortBy} onChange={setSortBy} options={c.detectors.map((d) => [d.id, d.name.split(' (')[0]])} /></div>
            <table className="data">
              <thead><tr><th>Label</th><th>Type</th><th>Topic</th><th>Words</th>{c.detectors.map((d) => <th key={d.id}>{d.name.split(' (')[0]}</th>)}<th>Provenance</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const s = sampleMap[r.id];
                  return (
                    <tr key={r.id}>
                      <td><span className={`badge ${r.label === 'ai' ? 'accent' : 'pos'}`}>{r.label === 'ai' ? 'AI' : 'Human'}</span></td>
                      <td>{r.textType}</td>
                      <td>{r.topic || '—'}</td>
                      <td className="mono">{r.words}</td>
                      {c.detectors.map((d) => <td key={d.id} className="mono">{r.scores[d.id].toFixed(3)}</td>)}
                      <td>{s?.provenance?.url ? <SourceLink url={s.provenance.url} label="Revision" /> : s?.provenance?.model ? <span className="muted">{s.provenance.model}</span> : <span className="muted">{s?.provenance?.source || 'removed'}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="row">
        <button className="btn sm" onClick={async () => { const r = await folio.lab.exportRun(runId); if (r.path) toast('Run exported', { kind: 'ok', action: { label: 'Show', onClick: () => folio.files.showInFolder(r.path) } }); }}><Download />Export results (JSON)</button>
        <button className="btn sm danger" onClick={onDelete}><Trash2 />Delete run</button>
      </div>
    </div>
  );
}

function AddSamples({ onClose, onAdded }) {
  const { toast } = useUi();
  const [label, setLabel] = useState('human');
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const add = async () => {
    const r = await folio.lab.addSamples([{ label, text, note, textType: 'own' }]);
    if (r.added) { toast('Sample added', { kind: 'ok' }); onAdded(); onClose(); } else toast('Sample not added', { kind: 'warn', detail: 'Samples need at least 40 words and must not duplicate an existing sample.' });
  };
  return (
    <Modal title="Add a labelled sample" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!text.trim() || !note.trim()} onClick={add}>Add sample</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="row"><span className="label">This text was written by</span><Seg value={label} onChange={setLabel} options={[['human', 'A person, without AI'], ['ai', 'An AI model']]} /></div>
        <input className="input" placeholder="Provenance (required): who wrote it, when, and how you know — e.g. “My 2019 coursework, written before AI tools”" value={note} onChange={(e) => setNote(e.target.value)} />
        <textarea className="textarea" style={{ minHeight: 240, fontFamily: 'var(--serif)' }} placeholder="Paste the sample text (at least 40 words)" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="note">Only add samples whose authorship you are certain of. Uncertain labels make every metric meaningless.</div>
      </div>
    </Modal>
  );
}

function Evaluation() {
  const { toast, confirm } = useUi();
  const [state, setState] = useState(null);
  const [progress, setProgress] = useState(null);
  const [topicsN, setTopicsN] = useState(12);
  const [activeRun, setActiveRun] = useState(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => folio.lab.state().then((s) => { setState(s); if (!activeRun && s.runs[0]) setActiveRun(s.runs[0].id); }).catch((e) => toast('Could not load the lab', { kind: 'error', detail: e.message }));
  useEffect(() => { refresh(); }, []);
  useEffect(() => folio.lab.onEvent((e) => { if (e.type === 'progress') setProgress(e); }), []);

  const build = async () => {
    setProgress({ detail: 'Starting', progress: 0 });
    try {
      const all = ['Photosynthesis', 'Volcano', 'Roman Empire', 'Jazz', 'Penicillin', 'Great Barrier Reef', 'Printing press', 'Black hole', 'Honey bee', 'Industrial Revolution', 'Chess', 'Tea', 'Antarctica', 'Vaccine', 'Football', 'Renaissance', 'Coral reef', 'Internet', 'Tiger', 'Pyramid', 'Electricity', 'Climate', 'Bicycle', 'Shakespeare', 'Rainforest'];
      const b = await folio.lab.buildCorpus({ topics: all.slice(0, topicsN), types: ['encyclopedic', 'simple'] });
      toast(`Corpus updated: ${b.added} new sample${b.added === 1 ? '' : 's'}`, { kind: b.errors.length ? 'warn' : 'ok', detail: b.errors.length ? `${b.errors.length} item(s) skipped — ${b.errors[0]}` : undefined });
    } catch (e) { if (e.kind !== 'aborted') toast('Corpus build stopped', { kind: 'error', detail: e.message }); }
    setProgress(null);
    refresh();
  };

  const evaluate = async () => {
    if (!state.modelsDownloaded) {
      const ok = await confirm({ title: 'Download detector models?', message: 'The first evaluation downloads two open models (GPT-2 and DistilGPT-2, about 520 MB in total) from Hugging Face. They are free, stored on this computer and run locally — no text is sent anywhere during scoring.', confirmLabel: 'Download and run' });
      if (!ok) return;
    }
    setProgress({ detail: 'Starting', progress: 0 });
    try {
      const run = await folio.lab.runEvaluation({});
      setActiveRun(run.id);
      toast('Evaluation complete', { kind: 'ok' });
    } catch (e) { if (e.kind !== 'aborted') toast('Evaluation stopped', { kind: 'error', detail: e.message }); }
    setProgress(null);
    refresh();
  };

  if (!state) return <div className="page-pad row muted" style={{ paddingTop: 20 }}><span className="spinner" />Loading</div>;
  const typeKeys = [...new Set([...Object.keys(state.types), ...state.samples.map((s) => s.textType)])];

  return (
    <div className="page-pad" style={{ paddingTop: 20 }}>
      <div className="callout" style={{ marginBottom: 16 }}><Info /><div>
        A reproducible test of open detection methods. Human samples are Wikipedia text from revisions dated before public AI chat tools existed; AI samples are generated for the same topics by the configured free model. Every sample keeps its provenance, and every run records its conditions.
      </div></div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <Database size={16} className="accent" /><b>Corpus</b><span className="muted">{state.samples.length} samples</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setAdding(true)} disabled={Boolean(progress)}><Plus />Add your own sample</button>
        </div>
        <table className="data" style={{ marginBottom: 12 }}>
          <thead><tr><th>Text type</th><th>Human</th><th>AI</th></tr></thead>
          <tbody>
            {typeKeys.map((t) => (
              <tr key={t}><td>{state.types[t] || (t === 'own' ? 'Added by the writer' : t)}</td><td className="mono">{state.counts[`${t}:human`] || 0}</td><td className="mono">{state.counts[`${t}:ai`] || 0}</td></tr>
            ))}
          </tbody>
        </table>
        {progress ? (
          <div className="col">
            <div className="row"><span className="spinner" /><span className="grow">{progress.detail}</span><button className="btn sm" onClick={() => folio.lab.cancel()}><Square size={12} />Stop</button></div>
            <Progress value={progress.progress} />
          </div>
        ) : (
          <div className="row">
            <span className="label">Topics</span>
            <Seg value={topicsN} onChange={setTopicsN} options={[[6, '6'], [12, '12'], [25, '25']]} />
            <button className="btn sm" onClick={build}><Database />Build reference corpus</button>
            <span className="spacer" />
            <button className="btn primary" onClick={evaluate} disabled={state.samples.length < 6}><Play />Run evaluation</button>
          </div>
        )}
        <div className="note" style={{ marginTop: 10 }}>Building fetches Wikipedia revisions (free, no key) and generates matching AI samples with your configured free model. Existing samples are kept, so building again only fills gaps.</div>
      </div>

      {state.runs.length > 0 ? (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <FlaskConical size={16} className="accent" /><b>Results</b>
            <select className="select" style={{ width: 280, marginLeft: 8 }} value={activeRun || ''} onChange={(e) => setActiveRun(e.target.value)}>
              {state.runs.map((r) => <option key={r.id} value={r.id}>{dateTime(r.createdAt)} · {r.conditions.samples} samples</option>)}
            </select>
          </div>
          {activeRun && <RunView key={activeRun} runId={activeRun} state={state} onDelete={async () => { if (await confirm({ title: 'Delete this run?', message: 'Its results will be removed.', danger: true, confirmLabel: 'Delete' })) { await folio.lab.removeRun(activeRun); setActiveRun(null); refresh(); } }} />}
        </>
      ) : (
        <Empty icon={<FlaskConical />} title="No evaluation runs yet">Build the reference corpus, then run an evaluation. Results appear here with their test conditions.</Empty>
      )}

      {state.samples.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary className="label" style={{ cursor: 'pointer' }}>Samples and provenance ({state.samples.length})</summary>
          <table className="data" style={{ marginTop: 10 }}>
            <thead><tr><th>Label</th><th>Type</th><th>Topic</th><th>Words</th><th>Provenance</th><th>Preview</th><th /></tr></thead>
            <tbody>
              {state.samples.map((s) => (
                <tr key={s.id}>
                  <td><span className={`badge ${s.label === 'ai' ? 'accent' : 'pos'}`}>{s.label === 'ai' ? 'AI' : 'Human'}</span></td>
                  <td>{s.textType}</td>
                  <td>{s.topic || '—'}</td>
                  <td className="mono">{num(s.words)}</td>
                  <td style={{ maxWidth: 260 }}>{s.provenance.url ? <><SourceLink url={s.provenance.url} label={s.provenance.source} /><div className="muted" style={{ fontSize: 11 }}>revision of {dateTime(s.provenance.revisionTimestamp)}</div></> : s.provenance.model ? <><span>{s.provenance.model}</span><div className="muted" style={{ fontSize: 11 }}>generated {dateTime(s.provenance.generatedAt)}</div></> : <span className="muted">{s.provenance.note}</span>}</td>
                  <td style={{ maxWidth: 360 }} className="muted">{s.preview}…</td>
                  <td><button className="btn ghost icon sm" onClick={async () => { await folio.lab.removeSample(s.id); refresh(); }} data-tip="Remove sample"><Trash2 /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {adding && <AddSamples onClose={() => setAdding(false)} onAdded={refresh} />}
    </div>
  );
}

export default function Lab() {
  const [tab, setTab] = useState('research');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Detector lab</h1>
          <div className="lede">How AI-text detectors work, what independent research has found, and a reproducible test you can run yourself.</div>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'research' ? 'on' : ''} onClick={() => setTab('research')}>Research</button>
        <button className={tab === 'eval' ? 'on' : ''} onClick={() => setTab('eval')}>Evaluation</button>
      </div>
      <div className="page-scroll">{tab === 'research' ? <Research /> : <Evaluation />}</div>
    </>
  );
}
