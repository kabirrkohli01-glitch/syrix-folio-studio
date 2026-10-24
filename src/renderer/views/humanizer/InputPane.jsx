import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, ShieldCheck } from 'lucide-react';
import { analyze, readingEaseLabel, formalityLabel } from '../../../shared/text/stylometry.js';
import { findIssues, ISSUE_LABELS } from '../../../shared/text/issues.js';
import { extractProtected } from '../../../shared/text/protect.js';
import { alignment } from '../../../shared/profile/profile.js';
import { num } from '../../lib/format.js';

/** Text area with an aligned mirror layer that underlines detected issues. */
export function HighlightedInput({ value, onChange, issues, focus, placeholder, disabled }) {
  const taRef = useRef(null);
  const mirrorRef = useRef(null);

  const html = useMemo(() => {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Non-overlapping spans, earliest first; longer spans win ties.
    const spans = [];
    let last = -1;
    for (const i of [...issues].sort((a, b) => a.start - b.start || b.end - a.end)) {
      if (i.start < last) continue;
      if (i.type === 'uniform-rhythm' || i.type === 'passive') continue;
      spans.push(i);
      last = i.end;
    }
    let out = '';
    let pos = 0;
    for (const s of spans) {
      out += esc(value.slice(pos, s.start));
      const isFocus = focus && focus.start === s.start && focus.end === s.end;
      out += `<mark class="${s.severity}${isFocus ? ' focus' : ''}">${esc(value.slice(s.start, s.end))}</mark>`;
      pos = s.end;
    }
    out += esc(value.slice(pos));
    return `${out}\n`;
  }, [value, issues, focus]);

  const sync = () => { if (mirrorRef.current && taRef.current) mirrorRef.current.scrollTop = taRef.current.scrollTop; };
  useEffect(sync, [html]);

  useEffect(() => {
    if (!focus || !taRef.current) return;
    const ta = taRef.current;
    ta.focus();
    ta.setSelectionRange(focus.start, focus.end);
    // Scroll the match into view using the mirror's rendered position.
    const mark = mirrorRef.current?.querySelector('mark.focus');
    if (mark) ta.scrollTop = Math.max(0, mark.offsetTop - ta.clientHeight / 3);
    sync();
  }, [focus]);

  return (
    <div className="hl-box">
      <div className="hl-mirror" ref={mirrorRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
      <textarea ref={taRef} className="hl-text" value={value} placeholder={placeholder} spellCheck onScroll={sync} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label="Text to revise" />
    </div>
  );
}

export function useAnalysis(text) {
  const [state, setState] = useState({ features: null, issues: [], protectedCounts: null });
  useEffect(() => {
    const t = setTimeout(() => {
      if (!text.trim()) { setState({ features: null, issues: [], protectedCounts: null }); return; }
      const p = extractProtected(text);
      setState({
        features: analyze(text),
        issues: findIssues(text),
        protectedCounts: { numbers: p.numbers.filter((x) => !x.spelled).length, names: p.entities.length, quotes: p.quotes.length, citations: p.citations.length, links: p.links.length },
      });
    }, 250);
    return () => clearTimeout(t);
  }, [text]);
  return state;
}

export function AnalysisPanel({ analysis, profile, onFocusIssue, focus }) {
  const [open, setOpen] = useState(null);
  const { features: f, issues, protectedCounts: pc } = analysis;
  if (!f) {
    return (
      <aside className="analysis">
        <div className="card-title">Analysis</div>
        <div className="note">Paste or type text to see its readability, rhythm, formality and the specific phrases worth revising.</div>
      </aside>
    );
  }
  const groups = {};
  for (const i of issues) (groups[i.type] = groups[i.type] || []).push(i);
  const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  const align = profile?.analysis ? alignment(f, profile.analysis) : null;

  return (
    <aside className="analysis" aria-label="Analysis">
      <div className="card-title" style={{ marginBottom: 0 }}>Analysis</div>
      <div className="stat-grid">
        <div className="stat"><div className="k">Words</div><div className="v">{num(f.wordCount)}</div><div className="s">{f.sentenceCount} sentences · {f.paragraphCount} ¶</div></div>
        <div className="stat"><div className="k">Reading ease</div><div className="v">{Math.round(f.readingEase)}</div><div className="s">{readingEaseLabel(f.readingEase)} · grade {f.gradeLevel}</div></div>
        <div className="stat"><div className="k">Sentence length</div><div className="v">{f.avgSentenceLength}</div><div className="s">words on average</div></div>
        <div className="stat"><div className="k">Variation</div><div className="v">{f.sentenceLengthVariation}</div><div className="s">{f.sentenceLengthVariation < 0.3 ? 'Very even rhythm' : f.sentenceLengthVariation < 0.45 ? 'Moderate' : 'Varied rhythm'}</div></div>
        <div className="stat"><div className="k">Formality</div><div className="v">{f.formality}</div><div className="s">{formalityLabel(f.formality)} (estimate)</div></div>
        <div className="stat"><div className="k">Formulaic</div><div className="v">{f.formulaicCount}</div><div className="s">stock phrases</div></div>
        {align && <div className="stat" style={{ gridColumn: 'span 2' }}><div className="k">Match with “{profile.name}”</div><div className="v">{align.score}<span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> / 100</span></div><div className="s">{align.reliable ? 'Measured on style features' : 'Short text — treat as a rough guide'}</div></div>}
      </div>

      <div>
        <div className="card-title">What to revise</div>
        {!order.length && <div className="note">No common problems detected. A light edit or a profile match may still help.</div>}
        <div className="issue-list">
          {order.map((type) => (
            <div key={type}>
              <button className="issue-row" onClick={() => setOpen(open === type ? null : type)}>
                <span className={`dot ${groups[type][0].severity}`} />
                {open === type ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {ISSUE_LABELS[type] || type}
                <span className="n">{groups[type].length}</span>
              </button>
              {open === type && (
                <div className="issue-detail">
                  <div>{groups[type][0].message.replace(/\(\d+ words\)/, '').replace(/"[^"]+"/, '').trim()}</div>
                  {groups[type].slice(0, 12).map((i) => (
                    <button key={`${i.start}-${i.end}`} onClick={() => onFocusIssue(i)} style={focus && focus.start === i.start ? { borderColor: 'var(--accent-line)' } : undefined}>
                      “{i.text.length > 70 ? `${i.text.slice(0, 70)}…` : i.text}”
                    </button>
                  ))}
                  {groups[type].length > 12 && <div className="muted">+{groups[type].length - 12} more</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {pc && (
        <div>
          <div className="card-title"><ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Protected details</div>
          <div className="note">
            {num(pc.numbers)} number{pc.numbers === 1 ? '' : 's'}, {num(pc.names)} name{pc.names === 1 ? '' : 's'} or term{pc.names === 1 ? '' : 's'}, {pc.quotes} quotation{pc.quotes === 1 ? '' : 's'}, {pc.citations} citation{pc.citations === 1 ? '' : 's'} and {pc.links} link{pc.links === 1 ? '' : 's'} will be checked after the rewrite.
          </div>
        </div>
      )}
    </aside>
  );
}
