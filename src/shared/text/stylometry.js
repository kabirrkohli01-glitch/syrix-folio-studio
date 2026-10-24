// Style measurement. One feature vector describes a passage, and the same
// vector is aggregated across samples to build a writing profile, so the
// humanizer's before/after numbers and the profile targets are directly
// comparable.

import { splitParagraphs, splitSentences, words, normWords } from './tokenize.js';
import {
  FUNCTION_WORDS, TRANSITIONS, FORMULAIC, HEDGES, BOOSTERS, FIRST_PERSON,
  SECOND_PERSON, UK_US, NOMINAL_SUFFIX, IRREGULAR_PARTICIPLES,
} from './lexicon.js';

export function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
const per = (count, total, unit) => (total ? (count / total) * unit : 0);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Moving-average type–token ratio: length-independent lexical diversity. */
export function mattr(tokens, window = 50) {
  if (tokens.length === 0) return 0;
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  const counts = new Map();
  let distinct = 0;
  for (let i = 0; i < window; i++) {
    const c = (counts.get(tokens[i]) || 0) + 1;
    counts.set(tokens[i], c);
    if (c === 1) distinct++;
  }
  let total = distinct;
  let windows = 1;
  for (let i = window; i < tokens.length; i++) {
    const out = tokens[i - window];
    const co = counts.get(out) - 1;
    counts.set(out, co);
    if (co === 0) distinct--;
    const c = (counts.get(tokens[i]) || 0) + 1;
    counts.set(tokens[i], c);
    if (c === 1) distinct++;
    total += distinct;
    windows++;
  }
  return total / windows / window;
}

const BE_FORMS = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', "isn't", "aren't", "wasn't", "weren't"]);

/** Heuristic passive detection: a form of "be" followed (within one adverb) by a participle. */
export function isPassive(sentence) {
  const ws = normWords(sentence);
  for (let i = 0; i < ws.length - 1; i++) {
    if (!BE_FORMS.has(ws[i])) continue;
    for (let k = i + 1; k <= Math.min(i + 2, ws.length - 1); k++) {
      const w = ws[k];
      if (/^[a-z]{3,}ed$/.test(w) || IRREGULAR_PARTICIPLES.has(w)) {
        if (w === 'been' && k === i + 1) continue; // "has been" handled by next word
        return true;
      }
      if (!/ly$/.test(w)) break;
    }
  }
  return false;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const FORMULAIC_RES = FORMULAIC.map((f) => ({
  ...f,
  re: f.rx
    ? new RegExp(f.rx, 'gi')
    : new RegExp(`(?<![A-Za-z])${escapeRe(f.p).replace(/'/g, "['’]")}(?![A-Za-z])`, 'gi'),
}));
export { FORMULAIC_RES };

/**
 * Formulaic phrase matches with overlaps merged, so "in today's world" counts
 * once even though both it and "in today's" are listed.
 */
export function formulaicSpans(src) {
  const spans = [];
  for (const f of FORMULAIC_RES) {
    f.re.lastIndex = 0;
    let m;
    while ((m = f.re.exec(src))) spans.push({ start: m.index, end: m.index + m[0].length, entry: f, text: m[0] });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) { if (s.end > last.end) last.end = s.end; continue; }
    out.push({ ...s });
  }
  return out;
}

const FORMAL_SET = new Set(TRANSITIONS.formal);
const FUNCTION_SET = new Set(FUNCTION_WORDS);
const HEDGE_SET = new Set(HEDGES);
const BOOSTER_SET = new Set(BOOSTERS);
const FP_SET = new Set(FIRST_PERSON);
const SP_SET = new Set(SECOND_PERSON);

/** Return the formal transition a sentence opens with, if any. */
export function openingTransition(sentence) {
  const lower = sentence.toLowerCase().replace(/^[^a-z]+/, '');
  for (const t of TRANSITIONS.formal) {
    if (lower.startsWith(t) && /^[\s,]/.test(lower.slice(t.length) || ' ')) return t;
  }
  return null;
}

/**
 * Compute the full feature vector for a passage.
 * All rates are per 100 words unless the name says otherwise.
 */
export function analyze(text) {
  const src = String(text || '');
  const paragraphs = splitParagraphs(src);
  const sentences = paragraphs.flatMap((p) => splitSentences(p));
  const tokens = normWords(src);
  const rawWords = words(src);
  const n = tokens.length;
  const sentLens = sentences.map((s) => words(s).length).filter((x) => x > 0);

  const syl = rawWords.map(syllables);
  const totalSyl = syl.reduce((a, b) => a + b, 0);
  const longWords = syl.filter((x) => x >= 3).length;
  const avgSentLen = mean(sentLens);
  const fre = n && sentLens.length ? 206.835 - 1.015 * (n / sentLens.length) - 84.6 * (totalSyl / n) : 0;
  const fk = n && sentLens.length ? 0.39 * (n / sentLens.length) + 11.8 * (totalSyl / n) - 15.59 : 0;

  // "'s" is only counted after pronouns; elsewhere it is usually possessive.
  const contractions = tokens.filter((w) => /n't$|'re$|'ve$|'ll$|'m$|'d$/.test(w)
    || /^(it|that|there|here|what|who|let|he|she)'s$/.test(w)).length;

  const punct = {
    comma: (src.match(/,/g) || []).length,
    semicolon: (src.match(/;/g) || []).length,
    colon: (src.match(/:(?!\/\/)/g) || []).length,
    dash: (src.match(/—|–|(?<=\s)-(?=\s)|--/g) || []).length,
    parenthesis: (src.match(/\(/g) || []).length,
    exclamation: (src.match(/!/g) || []).length,
    question: (src.match(/\?/g) || []).length,
  };
  const punctPer1000 = Object.fromEntries(Object.entries(punct).map(([k, v]) => [k, round(per(v, n, 1000), 1)]));

  let formalTransitions = 0;
  for (const t of TRANSITIONS.formal) {
    const re = new RegExp(`(?<![a-z])${escapeRe(t)}(?![a-z])`, 'gi');
    formalTransitions += (src.match(re) || []).length;
  }
  const openers = sentences.map(openingTransition).filter(Boolean);

  const formulaic = formulaicSpans(src).length;

  const fwCounts = {};
  let fwTotal = 0;
  for (const w of tokens) if (FUNCTION_SET.has(w)) { fwCounts[w] = (fwCounts[w] || 0) + 1; fwTotal++; }
  const functionWords = Object.fromEntries(FUNCTION_WORDS.map((w) => [w, round(per(fwCounts[w] || 0, n, 1000), 2)]));

  let uk = 0; let us = 0;
  const tokenSet = new Map();
  for (const w of tokens) tokenSet.set(w, (tokenSet.get(w) || 0) + 1);
  for (const [ukw, usw] of UK_US) {
    for (const [w, c] of tokenSet) {
      if (w.startsWith(ukw)) uk += c;
      else if (w.startsWith(usw)) us += c;
    }
  }
  const spelling = uk + us < 2 ? 'unknown' : uk >= us * 3 ? 'british' : us >= uk * 3 ? 'american' : 'mixed';

  const nominal = tokens.filter((w) => w.length > 6 && NOMINAL_SUFFIX.test(w)).length;
  const passive = sentences.filter(isPassive).length;
  const firstPerson = tokens.filter((w) => FP_SET.has(w)).length;
  const secondPerson = tokens.filter((w) => SP_SET.has(w)).length;
  const hedges = tokens.filter((w) => HEDGE_SET.has(w)).length;
  const boosters = tokens.filter((w) => BOOSTER_SET.has(w)).length;

  // Repeated content trigrams (ignoring trigrams made only of function words).
  const tri = new Map();
  for (let i = 0; i + 2 < tokens.length; i++) {
    const g = tokens.slice(i, i + 3);
    if (g.every((w) => FUNCTION_SET.has(w))) continue;
    const k = g.join(' ');
    tri.set(k, (tri.get(k) || 0) + 1);
  }
  let repeatedTrigrams = 0;
  for (const c of tri.values()) if (c > 1) repeatedTrigrams += c - 1;

  // Sentence openers: share of sentences that start with the same first word as another.
  const firstWords = sentences.map((s) => normWords(s)[0]).filter(Boolean);
  const fwFreq = new Map();
  for (const w of firstWords) fwFreq.set(w, (fwFreq.get(w) || 0) + 1);
  const topOpeners = [...fwFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, c]) => ({ word: w, count: c }));
  const repeatedOpenerShare = firstWords.length ? [...fwFreq.values()].filter((c) => c > 1).reduce((a, b) => a + b, 0) / firstWords.length : 0;

  const contractionRate = per(contractions, n, 100);
  const avgWordLen = rawWords.length ? mean(rawWords.map((w) => w.replace(/[^A-Za-z]/g, '').length).filter(Boolean)) : 0;

  // Estimated formality on a 0–100 scale. A transparent weighted composite of
  // the features most associated with formal register; it is an estimate for
  // comparing passages, not a calibrated linguistic measure.
  const formality = Math.max(0, Math.min(100,
    50
    + (avgWordLen - 4.7) * 18
    + per(nominal, n, 100) * 2.2
    + per(formalTransitions, n, 100) * 6
    + (sentences.length ? (passive / sentences.length) * 25 : 0)
    - contractionRate * 5
    - per(firstPerson + secondPerson, n, 100) * 1.5
    - per(punct.exclamation, n, 100) * 8,
  ));

  return {
    wordCount: n,
    sentenceCount: sentLens.length,
    paragraphCount: paragraphs.length,
    avgSentenceLength: round(avgSentLen, 1),
    sdSentenceLength: round(sd(sentLens), 1),
    sentenceLengthVariation: round(avgSentLen ? sd(sentLens) / avgSentLen : 0, 2),
    shortSentenceShare: round(sentLens.length ? sentLens.filter((x) => x <= 8).length / sentLens.length : 0, 2),
    longSentenceShare: round(sentLens.length ? sentLens.filter((x) => x >= 30).length / sentLens.length : 0, 2),
    sentenceLengths: sentLens,
    avgParagraphSentences: round(paragraphs.length ? sentLens.length / paragraphs.length : 0, 1),
    avgWordLength: round(avgWordLen, 2),
    longWordRate: round(per(longWords, n, 100), 1),
    lexicalDiversity: round(mattr(tokens), 3),
    readingEase: round(fre, 1),
    gradeLevel: round(fk, 1),
    contractionRate: round(contractionRate, 2),
    firstPersonRate: round(per(firstPerson, n, 100), 2),
    secondPersonRate: round(per(secondPerson, n, 100), 2),
    passiveShare: round(sentences.length ? passive / sentences.length : 0, 2),
    nominalisationRate: round(per(nominal, n, 100), 2),
    formalTransitionRate: round(per(formalTransitions, n, 100), 2),
    transitionOpenerShare: round(sentences.length ? openers.length / sentences.length : 0, 2),
    formulaicRate: round(per(formulaic, n, 100), 2),
    formulaicCount: formulaic,
    repeatedTrigramRate: round(per(repeatedTrigrams, n, 100), 2),
    repeatedOpenerShare: round(repeatedOpenerShare, 2),
    hedgeRate: round(per(hedges, n, 100), 2),
    boosterRate: round(per(boosters, n, 100), 2),
    punctuation: punctPer1000,
    spelling,
    formality: Math.round(formality),
    topOpeners,
    functionWords,
  };
}

/** Plain-language label for a Flesch reading-ease score. */
export function readingEaseLabel(score) {
  if (score >= 80) return 'Very easy';
  if (score >= 65) return 'Easy';
  if (score >= 50) return 'Standard';
  if (score >= 35) return 'Fairly difficult';
  if (score >= 20) return 'Difficult';
  return 'Very difficult';
}

export function formalityLabel(score) {
  if (score >= 75) return 'Very formal';
  if (score >= 58) return 'Formal';
  if (score >= 42) return 'Neutral';
  if (score >= 25) return 'Relaxed';
  return 'Casual';
}
