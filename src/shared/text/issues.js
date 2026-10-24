// Locates revision targets in a passage and returns them with character
// offsets so the interface can highlight them in place. Severity is advisory:
// "warn" items usually read badly, "info" items depend on context.

import { splitSentenceSpans, wordSpans, normWords } from './tokenize.js';
import { formulaicSpans, isPassive, openingTransition } from './stylometry.js';
import { FUNCTION_WORDS, COMMON_ERRORS, FILLERS } from './lexicon.js';

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ERROR_RES = COMMON_ERRORS.map((e) => ({ ...e, re: new RegExp(`(?<![A-Za-z'])${esc(e.p)}(?![A-Za-z'])`, 'gi') }));
const FILLER_RES = FILLERS.map((f) => ({ f, re: new RegExp(`(?<![A-Za-z'])${esc(f)}(?![A-Za-z'])`, 'gi') }));

const FUNCTION_SET = new Set(FUNCTION_WORDS);

function paragraphSpans(text) {
  const out = [];
  const re = /[^\n]+/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].trim()) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function findIssues(text) {
  const src = String(text || '');
  const issues = [];
  const paras = paragraphSpans(src);

  for (const s of formulaicSpans(src)) {
    const f = s.entry;
    issues.push({
      type: 'formulaic', category: f.c, severity: f.c === 'Construction' ? 'info' : 'warn',
      start: s.start, end: s.end, text: src.slice(s.start, s.end), message: `${f.c}: ${f.note}`,
    });
  }

  for (const e of ERROR_RES) {
    e.re.lastIndex = 0;
    let m;
    while ((m = e.re.exec(src))) {
      issues.push({ type: 'error', severity: e.soft ? 'info' : 'warn', start: m.index, end: m.index + m[0].length, text: m[0], fix: e.fix, message: `Likely ${e.soft ? 'usage issue' : 'error'}: “${m[0]}” → “${e.fix}”.` });
    }
  }

  for (const f of FILLER_RES) {
    f.re.lastIndex = 0;
    let m;
    while ((m = f.re.exec(src))) {
      issues.push({ type: 'filler', severity: 'warn', start: m.index, end: m.index + m[0].length, text: m[0], message: `Filler: “${m[0]}” adds nothing in written prose.` });
    }
  }

  for (const para of paras) {
    const sents = splitSentenceSpans(para.text).map((s) => ({ ...s, start: s.start + para.start, end: s.end + para.start }));
    const lens = sents.map((s) => normWords(s.text).length);

    sents.forEach((s, i) => {
      if (lens[i] >= 35) {
        issues.push({ type: 'long-sentence', severity: 'warn', start: s.start, end: s.end, text: s.text, message: `Long sentence (${lens[i]} words). Consider splitting it.` });
      }
      if (isPassive(s.text)) {
        issues.push({ type: 'passive', severity: 'info', start: s.start, end: s.end, text: s.text, message: 'Passive construction. Fine when the actor is unknown or unimportant.' });
      }
      const t = openingTransition(s.text);
      if (t && i > 0 && openingTransition(sents[i - 1].text)) {
        issues.push({ type: 'stacked-transition', severity: 'warn', start: s.start, end: s.start + t.length, text: s.text.slice(0, t.length), message: `Consecutive sentences open with formal connectives ("${t}"). Let the logic carry the link.` });
      }
    });

    // Three or more consecutive sentences starting with the same word.
    for (let i = 2; i < sents.length; i++) {
      const a = normWords(sents[i - 2].text)[0];
      const b = normWords(sents[i - 1].text)[0];
      const c = normWords(sents[i].text)[0];
      if (a && a === b && b === c) {
        const w = wordSpans(sents[i].text)[0];
        issues.push({ type: 'repeated-opener', severity: 'warn', start: sents[i].start, end: sents[i].start + (w ? w.end : 1), text: c, message: `Three sentences in a row start with "${c}".` });
      }
    }

    // Uniform rhythm: many sentences of nearly identical length.
    if (lens.length >= 4) {
      const m = lens.reduce((a, b) => a + b, 0) / lens.length;
      const v = Math.sqrt(lens.reduce((a, b) => a + (b - m) ** 2, 0) / (lens.length - 1));
      if (m > 0 && v / m < 0.22) {
        issues.push({ type: 'uniform-rhythm', severity: 'info', start: para.start, end: para.end, text: para.text.slice(0, 60), message: `Sentence lengths in this paragraph are very even (about ${Math.round(m)} words each). Varying them improves rhythm.` });
      }
    }
  }

  // Content words repeated three or more times within a 40-word window.
  const ws = wordSpans(src);
  const lower = ws.map((w) => w.text.toLowerCase());
  const flagged = new Set();
  for (let i = 0; i < ws.length; i++) {
    const w = lower[i];
    if (w.length < 5 || FUNCTION_SET.has(w) || /^\d/.test(w)) continue;
    const hits = [i];
    for (let j = i + 1; j < Math.min(ws.length, i + 40); j++) if (lower[j] === w) hits.push(j);
    if (hits.length >= 3) {
      for (const h of hits.slice(1)) {
        if (flagged.has(h)) continue;
        flagged.add(h);
        issues.push({ type: 'word-repetition', severity: 'info', start: ws[h].start, end: ws[h].end, text: ws[h].text, message: `"${ws[h].text}" is used ${hits.length} times in quick succession.` });
      }
    }
  }

  // Repeated multi-word phrases across the passage (second and later uses).
  const content = ws.map((w, i) => ({ ...w, lw: lower[i] }));
  const seen = new Map();
  for (let i = 0; i + 3 < content.length; i++) {
    const g = content.slice(i, i + 4);
    if (g.filter((x) => !FUNCTION_SET.has(x.lw)).length < 2) continue;
    const key = g.map((x) => x.lw).join(' ');
    if (seen.has(key)) {
      issues.push({ type: 'repeated-phrase', severity: 'warn', start: g[0].start, end: g[3].end, text: src.slice(g[0].start, g[3].end), message: 'This phrase has already been used earlier in the passage.' });
    } else {
      seen.set(key, i);
    }
  }

  issues.sort((a, b) => a.start - b.start || b.end - a.end);
  return issues;
}

export const ISSUE_LABELS = {
  error: 'Spelling and grammar',
  filler: 'Filler words',
  formulaic: 'Formulaic wording',
  'long-sentence': 'Long sentence',
  passive: 'Passive voice',
  'stacked-transition': 'Stacked transitions',
  'repeated-opener': 'Repeated openers',
  'uniform-rhythm': 'Uniform rhythm',
  'word-repetition': 'Word repetition',
  'repeated-phrase': 'Repeated phrase',
};

export function summariseIssues(issues) {
  const counts = {};
  for (const i of issues) counts[i.type] = (counts[i.type] || 0) + 1;
  return Object.entries(counts).map(([type, count]) => ({ type, label: ISSUE_LABELS[type] || type, count }))
    .sort((a, b) => b.count - a.count);
}
