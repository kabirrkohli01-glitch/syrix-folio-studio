// Text segmentation shared by the humanizer, the style profiler and the editor
// statistics. Everything here is pure and synchronous so it can run in the
// renderer for live feedback and in the main process for the pipeline.

// Abbreviations that end in a full stop without ending the sentence. Matched
// case-insensitively against the token immediately before the full stop.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
  'cf', 'al', 'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'pp', 'p', 'ed', 'eds',
  'approx', 'dept', 'est', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mon', 'tue', 'wed',
  'thu', 'fri', 'sat', 'sun', 'u.s', 'u.k', 'a.m', 'p.m', 'ph.d', 'b.sc', 'm.sc',
  'ch', 'sec', 'para', 'min', 'max', 'govt', 'gen', 'col', 'lt', 'sgt', 'rev',
]);

/**
 * Split text into paragraphs. Any line break starts a new paragraph: pasted
 * text and text extracted from the editor both use one newline per block.
 */
export function splitParagraphs(text) {
  if (!text) return [];
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Split a paragraph into sentences, returning { text, start, end } spans.
 * Handles abbreviations, decimals, initials, ellipses and closing quotes.
 */
export function splitSentenceSpans(text) {
  const spans = [];
  if (!text) return spans;
  const s = String(text);
  let start = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;

    // Consume runs like "?!" or "..." and trailing closing quotes/brackets.
    let j = i + 1;
    while (j < n && /[.!?…]/.test(s[j])) j++;
    while (j < n && /["'”’)\]]/.test(s[j])) j++;

    // A sentence boundary needs whitespace (or end of text) after it.
    if (j < n && !/\s/.test(s[j])) continue;

    if (ch === '.') {
      // Decimal numbers such as 3.14 never reach here (no whitespace), but
      // abbreviations and single-letter initials do.
      const before = s.slice(start, i);
      const m = before.match(/([A-Za-z][A-Za-z.]*)$/);
      if (m) {
        const word = m[1].toLowerCase();
        if (ABBREVIATIONS.has(word)) continue;
        if (/^[a-z]$/i.test(m[1]) && /[A-Z]/.test(m[1])) continue; // initial: "J. Smith"
      }
      // Next word starting in lower case usually means the sentence continues.
      let k = j;
      while (k < n && /\s/.test(s[k])) k++;
      if (k < n && /[a-z]/.test(s[k]) && i + 1 === j) continue;
    }

    const raw = s.slice(start, j);
    const trimmedStart = start + (raw.length - raw.trimStart().length);
    const t = raw.trim();
    if (t) spans.push({ text: t, start: trimmedStart, end: trimmedStart + t.length });
    start = j;
  }
  const tail = s.slice(start);
  if (tail.trim()) {
    const trimmedStart = start + (tail.length - tail.trimStart().length);
    const t = tail.trim();
    spans.push({ text: t, start: trimmedStart, end: trimmedStart + t.length });
  }
  return spans;
}

export function splitSentences(text) {
  return splitSentenceSpans(text).map((x) => x.text);
}

const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’][A-Za-z]+)*(?:[-–][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)*/g;

/** Word tokens with offsets. Hyphenated words and contractions count as one word. */
export function wordSpans(text) {
  const out = [];
  if (!text) return out;
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

export function words(text) {
  if (!text) return [];
  return String(text).match(WORD_RE) || [];
}

export function countWords(text) {
  return words(text).length;
}

/** Lower-cased words with curly apostrophes normalised. */
export function normWords(text) {
  return words(text).map((w) => w.toLowerCase().replace(/’/g, "'"));
}
