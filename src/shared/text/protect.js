// Extraction of the details a rewrite must not alter: numbers, dates,
// quotations, citations, links, names and technical terms. The same
// extraction runs on the original and the revision, and the difference
// between the two is what the meaning check reports.

import { splitSentenceSpans } from './tokenize.js';

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  half: 0.5, dozen: 12, once: 1, twice: 2, single: 1, double: 2, triple: 3,
};
const SCALE = { thousand: 'k', k: 'k', million: 'm', m: 'm', mn: 'm', billion: 'bn', bn: 'bn', b: 'bn', trillion: 'tn', tn: 'tn' };

// Leading capitals that do not indicate a proper noun on their own.
const COMMON_CAPS = new Set([
  'I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'It', 'In', 'On', 'At', 'For',
  'However', 'But', 'And', 'Or', 'So', 'If', 'When', 'While', 'Although', 'Because',
  'As', 'My', 'Our', 'We', 'They', 'He', 'She', 'You', 'Your', 'Their', 'There', 'Here',
  'What', 'Why', 'How', 'Who', 'Which', 'Where', 'Overall', 'Firstly', 'Secondly',
  'Finally', 'Also', 'Then', 'Moreover', 'Furthermore', 'Additionally', 'Therefore',
  'Thus', 'Hence', 'Yes', 'No', 'Not', 'Each', 'Every', 'All', 'Some', 'Many', 'Most',
  'One', 'Two', 'By', 'With', 'From', 'To', 'Of', 'After', 'Before', 'During', 'Since',
  'Instead', 'Still', 'Yet', 'Even', 'Only', 'Just', 'Both', 'Such', 'Its', 'His', 'Her',
]);

function normNumber(raw) {
  return raw.replace(/,(?=\d{3}\b)/g, '').replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
}

/** Numeric facts as normalised "value[scale][%]" keys, with their surface text. */
export function extractNumbers(text) {
  const out = [];
  const src = String(text || '');
  const re = /([£$€¥]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s?(%|per ?cent|percent|bn|mn|k|m|b|tn|thousand|million|billion|trillion)?(?![A-Za-z])/gi;
  let m;
  while ((m = re.exec(src))) {
    const value = normNumber(m[2] + (m[3] || ''));
    let suffix = '';
    if (m[4]) {
      const u = m[4].toLowerCase().replace(/\s/g, '');
      suffix = u === '%' || u === 'percent' ? '%' : (SCALE[u] || '');
    }
    out.push({ text: m[0].trim(), key: (m[1] ? m[1].trim() : '') + value + suffix, value: Number(value) });
  }
  // Spelled-out numbers, so "three" in the original matches "3" in a rewrite.
  const wre = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|dozen)\b(\s+(?:thousand|million|billion|per ?cent|percent))?/gi;
  while ((m = wre.exec(src))) {
    const v = NUMBER_WORDS[m[1].toLowerCase()];
    // "one" is too often a pronoun ("one of the …"); only count it with a scale or unit.
    if (m[1].toLowerCase() === 'one' && !m[2]) continue;
    let suffix = '';
    if (m[2]) {
      const u = m[2].trim().toLowerCase();
      suffix = /cent/.test(u) ? '%' : SCALE[u] || '';
    }
    out.push({ text: m[0].trim(), key: String(v) + suffix, value: v, spelled: true });
  }
  return out;
}

const QUOTE_RE = /["“]([^"”\n]{3,400})["”]/g;
export function extractQuotes(text) {
  const out = [];
  let m;
  QUOTE_RE.lastIndex = 0;
  while ((m = QUOTE_RE.exec(String(text || '')))) {
    const inner = m[1].trim();
    // Short scare quotes (one or two words) are style, not quotation.
    if (inner.split(/\s+/).length >= 3) out.push({ text: inner, key: inner.replace(/\s+/g, ' ').toLowerCase() });
  }
  return out;
}

export function extractCitations(text) {
  const src = String(text || '');
  const out = [];
  const patterns = [
    // (Smith, 2020) (Smith & Jones, 2019; Lee et al., 2021, p. 4) (Smith 2020)
    /\((?:[A-Z][A-Za-z'’\-]+(?:\s(?:et al\.|&|and)\s?(?:[A-Z][A-Za-z'’\-]+)?)*,?\s(?:19|20)\d{2}[a-z]?(?:,\s?pp?\.\s?\d+(?:[–-]\d+)?)?(?:;\s?)?)+\)/g,
    // Smith (2020) / Smith et al. (2021)
    /[A-Z][A-Za-z'’\-]+(?:\s(?:et al\.|and|&)\s?(?:[A-Z][A-Za-z'’\-]+)?)?\s\((?:19|20)\d{2}[a-z]?\)/g,
    // Numeric citations [12] [3, 4] [1–5]
    /\[\d+(?:\s?[,–-]\s?\d+)*\]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) out.push({ text: m[0], key: m[0].replace(/\s+/g, ' ') });
  }
  return out;
}

export function extractLinks(text) {
  const src = String(text || '');
  const out = [];
  const re = /\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\bwww\.[^\s<>()"']+[^\s<>()"'.,;:!?]/g;
  let m;
  while ((m = re.exec(src))) out.push({ text: m[0], key: m[0] });
  return out;
}

/**
 * Proper nouns, acronyms and product-style names. A capitalised word counts
 * only when it is not sentence-initial, is part of a multi-word name, is an
 * acronym or mixes case/digits (iPhone, GPT-4o, JavaScript).
 */
export function extractEntities(text) {
  const src = String(text || '');
  const found = new Map();
  for (const s of splitSentenceSpans(src)) {
    const tokens = [...s.text.matchAll(/[A-Za-z][A-Za-z0-9'’\-.]*[A-Za-z0-9]|[A-Z]/g)];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i][0].replace(/['’]s$/, '');
      if (/^I['’]/.test(t)) { i++; continue; } // I'm, I've, I'll, I'd
      const isCap = /^[A-Z]/.test(t);
      const isAcronym = /^[A-Z]{2,}[0-9]*s?$/.test(t) || /^[A-Z][A-Z0-9-]+[0-9][A-Za-z0-9-]*$/.test(t);
      const isOdd = /^[a-z]+[A-Z]/.test(t) || /^[A-Z][a-z]+[A-Z]/.test(t) || (/\d/.test(t) && /[A-Za-z]/.test(t));
      if (!(isCap || isOdd)) { i++; continue; }
      // Gather a run of capitalised words, allowing "of", "and", "for", "the" inside names.
      const run = [t];
      let j = i + 1;
      while (j < tokens.length) {
        const nx = tokens[j][0].replace(/['’]s$/, '');
        const between = s.text.slice(tokens[j - 1].index + tokens[j - 1][0].length, tokens[j].index);
        // Punctuation or a number between two capitalised words ends the name
        // ("Friday 14 November" is a date, not a name).
        if (/[,.;:()!?"“”&/0-9]/.test(between)) break;
        if (/^[A-Z]/.test(nx)) { run.push(nx); j++; continue; }
        if (/^(of|and|for|the|de|van|von|da)$/.test(nx) && j + 1 < tokens.length && /^[A-Z]/.test(tokens[j + 1][0])) { run.push(nx); j++; continue; }
        break;
      }
      const sentenceInitial = i === 0;
      let name = run.join(' ');
      if (sentenceInitial && run.length === 1 && !isAcronym && !isOdd) { i = j; continue; }
      if (sentenceInitial && COMMON_CAPS.has(run[0]) && run.length > 1) name = run.slice(1).join(' ');
      if (!name || COMMON_CAPS.has(name) || name.length < 2) { i = j; continue; }
      if (!found.has(name)) found.set(name, { text: name, key: name.toLowerCase() });
      i = j;
    }
  }
  return [...found.values()];
}

/** User-specified terms that must survive verbatim (case-insensitive match). */
export function extractTerms(text, glossary = []) {
  const src = String(text || '').toLowerCase();
  return glossary
    .map((g) => String(g).trim())
    .filter((g) => g && src.includes(g.toLowerCase()))
    .map((g) => ({ text: g, key: g.toLowerCase() }));
}

export function extractProtected(text, { glossary = [] } = {}) {
  return {
    numbers: extractNumbers(text),
    quotes: extractQuotes(text),
    citations: extractCitations(text),
    links: extractLinks(text),
    entities: extractEntities(text),
    terms: extractTerms(text, glossary),
  };
}

/** Flat, de-duplicated list of surface strings for inclusion in a prompt. */
export function protectedList(p) {
  const items = new Set();
  for (const q of p.quotes) items.add(`"${q.text}"`);
  for (const c of p.citations) items.add(c.text);
  for (const l of p.links) items.add(l.text);
  for (const n of p.numbers) if (!n.spelled) items.add(n.text);
  for (const e of p.entities) items.add(e.text);
  for (const t of p.terms) items.add(t.text);
  return [...items];
}
