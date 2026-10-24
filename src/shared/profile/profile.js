// Writing profiles. A profile is built from a writer's own samples using the
// same feature vector as the humanizer analysis, so "how close is this text to
// my voice" is a direct comparison of measured features, not a model opinion.

import { analyze } from '../text/stylometry.js';
import { splitParagraphs, normWords, countWords } from '../text/tokenize.js';
import { FUNCTION_WORDS, TRANSITIONS, VOICE_MARKERS } from '../text/lexicon.js';

const r1 = (x) => Math.round(x * 10) / 10;

function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (const k of FUNCTION_WORDS) {
    const x = a[k] || 0; const y = b[k] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function phraseCounts(text, n) {
  const ws = normWords(text);
  const fw = new Set(FUNCTION_WORDS);
  const out = new Map();
  for (let i = 0; i + n <= ws.length; i++) {
    const g = ws.slice(i, i + n);
    if (g.every((w) => fw.has(w)) || g.some((w) => /^\d+$/.test(w))) continue;
    // Keep phrases that contain at least one function word: these capture
    // habitual phrasing ("a lot of", "the main thing") rather than topic words.
    if (!g.some((w) => fw.has(w))) continue;
    const k = g.join(' ');
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

/** Build a profile summary from an array of { id, text } samples. */
export function buildProfile(samples) {
  const usable = (samples || []).filter((s) => s && String(s.text || '').trim());
  const combined = usable.map((s) => s.text).join('\n\n');
  const stats = analyze(combined);
  const perSample = usable.map((s) => ({ id: s.id, words: countWords(s.text), f: analyze(s.text) }));

  // Habitual phrases: frequent across the corpus and present in more than one
  // sample when there is more than one sample.
  const phraseDocs = new Map();
  const phraseTotal = new Map();
  for (const s of usable) {
    const seen = new Set();
    for (const n of [2, 3]) {
      for (const [k, c] of phraseCounts(s.text, n)) {
        phraseTotal.set(k, (phraseTotal.get(k) || 0) + c);
        if (!seen.has(k)) { phraseDocs.set(k, (phraseDocs.get(k) || 0) + 1); seen.add(k); }
      }
    }
  }
  const minDocs = usable.length > 1 ? 2 : 1;
  const commonPhrases = [...phraseTotal.entries()]
    .filter(([k, c]) => c >= 3 && (phraseDocs.get(k) || 0) >= minDocs)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([phrase, count]) => ({ phrase, count }));

  const tokens = normWords(combined);
  const joined = ` ${tokens.join(' ')} `;
  const transitionUse = [...TRANSITIONS.formal, ...TRANSITIONS.plain]
    .map((t) => ({ t, c: joined.split(` ${t} `).length - 1 }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c);
  const favouriteTransitions = transitionUse.slice(0, 6).map((x) => x.t);
  const unusedFormal = TRANSITIONS.formal.filter((t) => !transitionUse.some((x) => x.t === t)).slice(0, 12);

  // Register markers: how often the writer uses each, per 1,000 words.
  const wc = Math.max(1, tokens.length);
  const markerRates = VOICE_MARKERS.map((m) => ({ marker: m, per1000: Math.round(((joined.split(` ${m} `).length - 1) / wc) * 10000) / 10 }));
  const voiceMarkers = {
    used: markerRates.filter((x) => x.per1000 >= 0.6).sort((a, b) => b.per1000 - a.per1000).slice(0, 14),
    unused: markerRates.filter((x) => x.per1000 === 0).map((x) => x.marker).slice(0, 16),
  };
  const lens = stats.sentenceLengths || [];
  const sentenceMix = lens.length ? {
    short: Math.round((lens.filter((x) => x <= 10).length / lens.length) * 100),
    medium: Math.round((lens.filter((x) => x > 10 && x < 25).length / lens.length) * 100),
    long: Math.round((lens.filter((x) => x >= 25).length / lens.length) * 100),
  } : null;

  const spread = (key) => {
    const xs = perSample.filter((p) => p.words >= 80).map((p) => p.f[key]);
    if (xs.length < 2) return null;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return r1(Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)));
  };

  return {
    builtAt: new Date().toISOString(),
    sampleCount: usable.length,
    wordCount: stats.wordCount,
    stats,
    spread: {
      avgSentenceLength: spread('avgSentenceLength'),
      formality: spread('formality'),
      contractionRate: spread('contractionRate'),
    },
    commonPhrases,
    voiceMarkers,
    sentenceMix,
    favouriteTransitions,
    unusedFormal,
    reliability: stats.wordCount >= 2000 ? 'good' : stats.wordCount >= 800 ? 'fair' : 'limited',
  };
}

function level(x, cuts, labels) {
  for (let i = 0; i < cuts.length; i++) if (x < cuts[i]) return labels[i];
  return labels[labels.length - 1];
}

/** Human-readable traits for display and for the rewrite brief. */
export function describeProfile(profile) {
  if (!profile || !profile.stats || !profile.stats.wordCount) return [];
  const s = profile.stats;
  const traits = [];
  const variation = level(s.sentenceLengthVariation, [0.3, 0.45, 0.65], ['very even', 'moderately varied', 'clearly varied', 'highly varied']);
  traits.push({ key: 'sentences', label: 'Sentences', text: `About ${r1(s.avgSentenceLength)} words on average, ${variation} in length (${Math.round(s.shortSentenceShare * 100)}% are 8 words or fewer, ${Math.round(s.longSentenceShare * 100)}% are 30 or more).` });
  traits.push({ key: 'vocabulary', label: 'Vocabulary', text: `${level(s.avgWordLength, [4.4, 4.8, 5.2], ['Plain, everyday', 'Mostly plain', 'Moderately elevated', 'Elevated, Latinate'])} vocabulary (average word length ${s.avgWordLength}; ${s.longWordRate} long words per 100).` });
  traits.push({ key: 'formality', label: 'Formality', text: `${level(s.formality, [25, 42, 58, 75], ['Casual', 'Relaxed', 'Neutral', 'Formal', 'Very formal'])} register (estimated ${s.formality}/100).` });
  traits.push({ key: 'contractions', label: 'Contractions', text: s.contractionRate >= 1.5 ? `Uses contractions freely (${s.contractionRate} per 100 words).` : s.contractionRate >= 0.4 ? `Uses contractions occasionally (${s.contractionRate} per 100 words).` : 'Rarely or never uses contractions.' });
  traits.push({ key: 'person', label: 'Point of view', text: s.firstPersonRate >= 2 ? `Writes in the first person often (${s.firstPersonRate} per 100 words).` : s.firstPersonRate >= 0.5 ? 'Uses the first person sometimes.' : 'Mostly impersonal; little first person.' });
  const p = s.punctuation;
  const punct = [];
  punct.push(p.comma >= 60 ? 'many commas' : p.comma >= 35 ? 'a moderate number of commas' : 'few commas');
  punct.push(p.semicolon >= 3 ? 'semicolons regularly' : 'semicolons rarely or never');
  punct.push(p.dash >= 4 ? 'dashes often' : 'dashes rarely');
  if (p.parenthesis >= 4) punct.push('parentheses for asides');
  if (p.exclamation >= 2) punct.push('occasional exclamation marks');
  traits.push({ key: 'punctuation', label: 'Punctuation', text: `Uses ${punct.join(', ')}.` });
  const trans = profile.favouriteTransitions || [];
  traits.push({ key: 'transitions', label: 'Linking', text: trans.length ? `Links ideas mostly with “${trans.slice(0, 4).join('”, “')}”. ${s.formalTransitionRate < 0.5 ? 'Formal connectives such as “moreover” and “furthermore” are rare.' : ''}`.trim() : 'Few explicit linking words.' });
  traits.push({ key: 'paragraphs', label: 'Paragraphs', text: `About ${s.avgParagraphSentences} sentences per paragraph.` });
  traits.push({ key: 'voice', label: 'Voice', text: `${s.passiveShare >= 0.25 ? 'Frequent passive constructions' : s.passiveShare >= 0.1 ? 'Some passive constructions' : 'Mostly active voice'}; ${s.hedgeRate >= 1.5 ? 'hedges claims often' : s.hedgeRate >= 0.6 ? 'hedges claims sometimes' : 'states claims directly'}.` });
  if (s.spelling !== 'unknown') traits.push({ key: 'spelling', label: 'Spelling', text: s.spelling === 'british' ? 'British spelling.' : s.spelling === 'american' ? 'American spelling.' : 'Mixed British and American spelling.' });
  if (profile.sentenceMix) traits.push({ key: 'mix', label: 'Sentence mix', text: `${profile.sentenceMix.short}% short (10 words or fewer), ${profile.sentenceMix.medium}% medium, ${profile.sentenceMix.long}% long (25 or more).` });
  if (profile.voiceMarkers && profile.voiceMarkers.used.length) traits.push({ key: 'markers', label: 'Everyday words', text: profile.voiceMarkers.used.slice(0, 8).map((x) => `“${x.marker}”`).join(', ') });
  if (profile.commonPhrases && profile.commonPhrases.length) traits.push({ key: 'phrases', label: 'Recurring phrasing', text: profile.commonPhrases.slice(0, 6).map((x) => `“${x.phrase}”`).join(', ') });
  return traits;
}

// Dimensions used for alignment, each with a tolerance: the difference at which
// closeness falls to about 37% (e^-1).
const DIMS = [
  { key: 'avgSentenceLength', label: 'Sentence length', tol: 4, weight: 1.4 },
  { key: 'sentenceLengthVariation', label: 'Sentence variation', tol: 0.15, weight: 1.2 },
  { key: 'avgWordLength', label: 'Word length', tol: 0.35, weight: 1 },
  { key: 'formality', label: 'Formality', tol: 12, weight: 1.2 },
  { key: 'contractionRate', label: 'Contractions', tol: 0.8, weight: 0.8 },
  { key: 'firstPersonRate', label: 'First person', tol: 1.2, weight: 0.6 },
  { key: 'formalTransitionRate', label: 'Formal connectives', tol: 0.6, weight: 0.8 },
  { key: 'passiveShare', label: 'Passive voice', tol: 0.12, weight: 0.5 },
  { key: 'commaRate', label: 'Comma use', tol: 18, weight: 0.5 },
  { key: 'semicolonRate', label: 'Semicolons', tol: 3, weight: 0.4 },
  { key: 'dashRate', label: 'Dashes', tol: 3, weight: 0.4 },
];

function dimValue(f, key) {
  if (key === 'commaRate') return f.punctuation.comma;
  if (key === 'semicolonRate') return f.punctuation.semicolon;
  if (key === 'dashRate') return f.punctuation.dash;
  return f[key];
}

/**
 * Alignment between a passage's features and a profile, 0–100, with a
 * per-dimension breakdown. Short passages are noisy, so callers should show
 * the score with its word count.
 */
export function alignment(features, profile) {
  if (!profile || !profile.stats || !features || !features.wordCount) return null;
  const dims = DIMS.map((d) => {
    const text = dimValue(features, d.key);
    const target = dimValue(profile.stats, d.key);
    const closeness = Math.exp(-Math.abs(text - target) / d.tol);
    return { key: d.key, label: d.label, text: r1(text), target: r1(target), closeness: Math.round(closeness * 100) };
  });
  const fwSim = cosine(features.functionWords, profile.stats.functionWords);
  dims.push({ key: 'functionWords', label: 'Function-word habits', text: null, target: null, closeness: Math.round(Math.max(0, (fwSim - 0.6) / 0.4) * 100) });
  const weights = [...DIMS.map((d) => d.weight), 1.2];
  const score = dims.reduce((a, d, i) => a + d.closeness * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
  return { score: Math.round(score), dims, reliable: features.wordCount >= 120 };
}

// Dimensions a rewrite can change without altering content. First-person
// rate, word length and function-word mix depend largely on the subject and
// the original wording, so they are left out of the voice check that decides
// whether to retry a rewrite.
const VOICE_KEYS = new Set(['avgSentenceLength', 'sentenceLengthVariation', 'formality', 'contractionRate', 'formalTransitionRate', 'passiveShare', 'commaRate', 'semicolonRate', 'dashRate']);

export function voiceAlignment(features, profile) {
  const a = alignment(features, profile);
  if (!a) return null;
  const dims = a.dims.filter((d) => VOICE_KEYS.has(d.key));
  return { score: Math.round(dims.reduce((s, d) => s + d.closeness, 0) / dims.length), dims };
}

/**
 * Choose representative excerpts from the samples: paragraphs of 50–170 words
 * whose own features sit closest to the profile, preferring different samples.
 */
export function selectExemplars(samples, profile, count = 3) {
  if (!profile || !profile.stats) return [];
  const candidates = [];
  for (const s of samples || []) {
    for (const para of splitParagraphs(s.text)) {
      const wc = countWords(para);
      if (wc < 50 || wc > 170) continue;
      const a = alignment(analyze(para), profile);
      if (a) candidates.push({ sampleId: s.id, text: para, score: a.score, words: wc });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  const usedSamples = new Set();
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (usedSamples.has(c.sampleId) && candidates.some((x) => !usedSamples.has(x.sampleId) && !picked.includes(x))) continue;
    picked.push(c);
    usedSamples.add(c.sampleId);
  }
  for (const c of candidates) { if (picked.length >= count) break; if (!picked.includes(c)) picked.push(c); }
  return picked.map(({ sampleId, text, score, words }) => ({ sampleId, text, score, words }));
}
