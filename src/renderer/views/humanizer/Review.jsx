import React, { useMemo, useState } from 'react';
import {
  Check, X, Pencil, RefreshCw, AlertCircle, AlertTriangle, Info, ShieldCheck, Send, Wrench, Heading,
  CheckCheck, Undo2,
} from 'lucide-react';
import { wordDiff } from '../../../shared/humanizer/diff.js';
import { FEEDBACK_CHIPS } from '../../../shared/humanizer/controls.js';
import { readingEaseLabel, formalityLabel } from '../../../shared/text/stylometry.js';
import { Seg } from '../../components/ui.jsx';
import { num } from '../../lib/format.js';

const SEV_ICON = { error: <AlertCircle />, warn: <AlertTriangle />, info: <Info /> };

export function DiffView({ a, b, mode }) {
  const parts = useMemo(() => wordDiff(a, b), [a, b]);
  if (mode === 'orig') return <>{parts.filter((p) => !p.added).map((p, i) => (p.removed ? <span key={i} className="d-del">{p.value}</span> : <span key={i}>{p.value}</span>))}</>;
  if (mode === 'new') return <>{parts.filter((p) => !p.removed).map((p, i) => (p.added ? <span key={i} className="d-add">{p.value}</span> : <span key={i}>{p.value}</span>))}</>;
  return <>{parts.map((p, i) => (p.added ? <ins key={i} className="d-add">{p.value}</ins> : p.removed ? <del key={i} className="d-del">{p.value}</del> : <span key={i}>{p.value}</span>))}</>;
}

function Metric({ k, from, to, fmt = (x) => x, better, sub }) {
  const cls = better == null || from === to ? '' : better ? 'better' : 'worse';
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v"><span className="from">{fmt(from)}</span><span className="arrow">→</span><span className={`to ${cls}`}>{fmt(to)}</span></div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function MetricsStrip({ version, profileName }) {
  const b = version.metrics.before;
  const a = version.metrics.after;
  const count = (list) => list.reduce((s, x) => s + (['formulaic', 'stacked-transition', 'repeated-phrase', 'repeated-opener', 'long-sentence'].includes(x.type) ? x.count : 0), 0);
  const ib = count(version.metrics.issuesBefore);
  const ia = count(version.metrics.issuesAfter);
  const pa = version.metrics.profileAlignment;
  return (
    <div className="metrics">
      <Metric k="Reading ease" from={Math.round(b.readingEase)} to={Math.round(a.readingEase)} better={a.readingEase > b.readingEase} sub={readingEaseLabel(a.readingEase)} />
      <Metric k="Avg sentence" from={b.avgSentenceLength} to={a.avgSentenceLength} sub="words" />
      <Metric k="Variation" from={b.sentenceLengthVariation} to={a.sentenceLengthVariation} better={a.sentenceLengthVariation > b.sentenceLengthVariation} sub="sentence-length spread" />
      <Metric k="Formality" from={b.formality} to={a.formality} sub={formalityLabel(a.formality)} />
      <Metric k="Writing issues" from={ib} to={ia} better={ia < ib} sub="stock phrases, repeats, long sentences" />
      <Metric k="Words" from={num(b.wordCount)} to={num(a.wordCount)} sub={`${a.wordCount >= b.wordCount ? '+' : ''}${Math.round(((a.wordCount - b.wordCount) / Math.max(1, b.wordCount)) * 100)}%`} />
      {pa && pa.after && <Metric k={`Match: ${profileName}`} from={pa.before.score} to={pa.after.score} better={pa.after.score > pa.before.score} sub="profile alignment / 100" />}
    </div>
  );
}

export function CheckSummary({ version }) {
  const all = version.paragraphs.flatMap((p) => p.issues || []).filter((i) => !i.resolved && !i.styleOnly);
  const errors = all.filter((i) => i.severity === 'error').length;
  const warns = all.filter((i) => i.severity === 'warn').length;
  const repaired = version.paragraphs.filter((p) => p.repaired).length;
  const failed = version.paragraphs.filter((p) => p.status === 'failed').length;
  return (
    <div className="check-summary col" style={{ gap: 8 }}>
      {version.error && (
        <div className="callout error"><AlertCircle /><div><b>{failed} paragraph{failed === 1 ? '' : 's'} could not be revised.</b> {version.error.message} The rest of the result is shown; use “Retry failed” to try again.</div></div>
      )}
      {errors > 0 ? (
        <div className="callout error"><AlertCircle /><div><b>{errors} protected detail{errors === 1 ? '' : 's'} changed.</b> Review the paragraphs marked in red before accepting them.</div></div>
      ) : warns > 0 ? (
        <div className="callout warn"><AlertTriangle /><div><b>All protected details are intact.</b> {warns} possible change{warns === 1 ? '' : 's'} in meaning flagged for review.{repaired ? ` ${repaired} paragraph${repaired === 1 ? ' was' : 's were'} repaired automatically.` : ''}</div></div>
      ) : (
        <div className="callout ok"><ShieldCheck /><div><b>Meaning check passed.</b> Numbers, names, quotations and citations are intact{version.auditErrors?.length ? '' : ' and no meaning changes were found'}.{repaired ? ` ${repaired} paragraph${repaired === 1 ? ' was' : 's were'} repaired automatically.` : ''}</div></div>
      )}
      {version.auditErrors?.length > 0 && <div className="callout warn"><AlertTriangle /><div>The second-model meaning check did not complete: {version.auditErrors[0]} Local checks still ran.</div></div>}
      {version.targetResults?.length > 0 && (
        <div className="note">Targets for this round: {version.targetResults.map((t) => `${FEEDBACK_CHIPS.find((c) => c.id === t.id)?.label || t.id} ${t.met ? '✓' : '— partly met'}`).join(' · ')}</div>
      )}
    </div>
  );
}

export function ParagraphCard({ index, original, para, prevText, decision, edit, onDecide, onEdit, onRegenerate, viewMode, compare, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [note, setNote] = useState('');
  const base = compare === 'previous' && prevText != null ? prevText : original;
  const shown = edit ?? para.text;
  const unchanged = shown === original;
  const issues = (para.issues || []);
  const visibleIssues = issues.filter((i) => i.severity !== 'info' || i.resolved);

  if (para.status === 'heading') {
    return (
      <div className="para">
        <div className="para-head"><span className="num">¶{index + 1}</span><Heading size={13} />Heading — kept as written</div>
        <div className="para-cols single"><div className="para-col" style={{ fontWeight: 600 }}>{original}</div></div>
      </div>
    );
  }

  const cls = decision === 'accepted' ? ' accepted' : decision === 'rejected' ? ' rejected' : decision === 'edited' ? ' edited' : '';
  const errorCount = issues.filter((i) => i.severity === 'error' && !i.resolved).length;
  const warnCount = issues.filter((i) => i.severity === 'warn' && !i.resolved && !i.styleOnly).length;

  return (
    <div className={`para${cls}`}>
      <div className="para-head">
        <span className="num">¶{index + 1}</span>
        {para.status === 'failed' && <span className="badge neg">Not revised</span>}
        {para.status === 'kept' && <span className="badge">Carried over</span>}
        {para.repaired && <span className="badge info" data-tip="A first draft changed a protected detail or the meaning, and was corrected automatically."><Wrench />Repaired</span>}
        {errorCount > 0 && <span className="badge neg">{errorCount} detail{errorCount === 1 ? '' : 's'} changed</span>}
        {warnCount > 0 && <span className="badge accent">{warnCount} to review</span>}
        {para.status === 'ok' && !unchanged && <span className="muted" data-tip="Share of the original wording that survives in this paragraph">{Math.round((para.similarity || 0) * 100)}% wording kept</span>}
        {unchanged && para.status === 'ok' && <span className="muted">No changes</span>}
        <span className="spacer" />
        {decision === 'accepted' && <span className="badge pos"><Check />Accepted</span>}
        {decision === 'rejected' && <span className="badge">Original kept</span>}
        {decision === 'edited' && <span className="badge info"><Pencil />Edited</span>}
      </div>

      {editing ? (
        <div style={{ padding: 12 }}>
          <textarea className="textarea para-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
      ) : viewMode === 'clean' ? (
        <div className="para-cols single"><div className="para-col">{shown}</div></div>
      ) : viewMode === 'inline' ? (
        <div className="para-cols single"><div className="para-col"><DiffView a={base} b={shown} mode="both" /></div></div>
      ) : (
        <div className="para-cols">
          <div className="para-col orig"><div className="col-label">{compare === 'previous' && prevText != null ? 'Previous version' : 'Original'}</div><DiffView a={base} b={shown} mode="orig" /></div>
          <div className="para-col"><div className="col-label">{edit != null ? 'Your edit' : 'Revised'}</div><DiffView a={base} b={shown} mode="new" /></div>
        </div>
      )}

      {visibleIssues.length > 0 && !editing && (
        <div className="para-issues">
          {visibleIssues.map((i, k) => (
            <div key={k} className={`p-issue ${i.resolved ? 'info' : i.severity}`}>
              {i.resolved ? <Wrench /> : SEV_ICON[i.severity]}
              <span>{i.message}{i.original && !i.resolved && i.source === 'audit' ? <span className="muted"> Original: “{i.original}”</span> : null}</span>
              <span className="src">{i.source === 'audit' ? 'Meaning check' : 'Fact check'}</span>
            </div>
          ))}
        </div>
      )}

      {regenOpen && (
        <div className="row" style={{ padding: '0 12px 10px' }}>
          <input className="input grow" autoFocus placeholder="Optional note for this paragraph, e.g. “shorter” or “keep the first sentence”" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { onRegenerate(note); setRegenOpen(false); setNote(''); } if (e.key === 'Escape') setRegenOpen(false); }} />
          <button className="btn sm primary" onClick={() => { onRegenerate(note); setRegenOpen(false); setNote(''); }}>Rewrite</button>
        </div>
      )}

      <div className="para-actions">
        {editing ? (
          <>
            <button className="btn sm primary" onClick={() => { onEdit(draft.trim()); setEditing(false); }}><Check />Save edit</button>
            <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className={`btn sm${decision === 'accepted' ? ' active' : ''}`} onClick={() => onDecide(decision === 'accepted' ? null : 'accepted')} disabled={para.status === 'failed' || unchanged}><Check />Accept</button>
            <button className={`btn sm${decision === 'rejected' ? ' active' : ''}`} onClick={() => onDecide(decision === 'rejected' ? null : 'rejected')}><X />Keep original</button>
            <button className="btn sm ghost" onClick={() => { setDraft(shown); setEditing(true); }}><Pencil />Edit</button>
            <button className="btn sm ghost" onClick={() => setRegenOpen((v) => !v)} disabled={busy}><RefreshCw />Rewrite this</button>
            {edit != null && <button className="btn sm ghost" onClick={() => onEdit(null)}><Undo2 />Discard edit</button>}
          </>
        )}
      </div>
    </div>
  );
}

export function Composer({ onRevise, onRegenerate, busy, notes }) {
  const [chips, setChips] = useState([]);
  const [text, setText] = useState('');
  const [more, setMore] = useState(false);
  const MAIN = ['clearer', 'less-formal', 'concise', 'vary', 'keep-wording', 'profile'];
  const toggle = (id) => setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const send = () => {
    if (!chips.length && !text.trim()) return;
    onRevise({ chipIds: chips, text: text.trim() });
    setChips([]);
    setText('');
  };
  return (
    <div className="composer">
      {notes?.length > 0 && (
        <div className="notes-trail"><span>Notes so far:</span>{notes.map((n, i) => <span key={i} className="badge" data-tip={n}>{n.length > 38 ? `${n.slice(0, 38)}…` : n}</span>)}</div>
      )}
      <div className="chips">
        {FEEDBACK_CHIPS.filter((c) => more || MAIN.includes(c.id)).map((c) => <button key={c.id} className={`chip${chips.includes(c.id) ? ' on' : ''}`} onClick={() => toggle(c.id)} data-tip={c.instruction}>{c.label}</button>)}
        <button className="chip" onClick={() => setMore((v) => !v)}>{more ? 'Fewer' : 'More…'}</button>
      </div>
      <div className="row">
        <input className="input grow" placeholder="Tell Folio what to change in the next version…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} disabled={busy} />
        <button className="btn primary" onClick={send} disabled={busy || (!chips.length && !text.trim())}><Send />Revise</button>
        <button className="btn" onClick={onRegenerate} disabled={busy} data-tip="A different take with the same settings"><RefreshCw />Regenerate</button>
      </div>
    </div>
  );
}

export function ReviewBar({ session, versionIdx, setVersionIdx, viewMode, setViewMode, compare, setCompare, onAcceptAll, onRejectAll }) {
  return (
    <div className="review-bar">
      <span className="label">Version</span>
      <div className="versions">
        {session.versions.map((v, i) => (
          <button key={v.n} className={i === versionIdx ? 'on' : ''} onClick={() => setVersionIdx(i)} data-tip={v.newFeedback?.length ? `Notes: ${v.newFeedback.join(', ')}` : v.regenerate ? 'Regenerated' : v.scope ? `Rewrote ¶${v.scope.map((x) => x + 1).join(', ')}` : 'First revision'}>v{v.n}</button>
        ))}
      </div>
      <span className="spacer" />
      {versionIdx > 0 && <Seg value={compare} onChange={setCompare} options={[['original', 'vs original'], ['previous', 'vs previous']]} />}
      <Seg value={viewMode} onChange={setViewMode} options={[['side', 'Side by side'], ['inline', 'Inline'], ['clean', 'Clean']]} />
      <button className="btn sm" onClick={onAcceptAll}><CheckCheck />Accept all</button>
      <button className="btn sm ghost" onClick={onRejectAll}>Clear</button>
    </div>
  );
}
