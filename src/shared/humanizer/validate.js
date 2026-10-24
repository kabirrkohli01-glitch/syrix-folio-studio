// Meaning-preservation checks between an original passage and its revision.
// These are deterministic and run on every rewrite; the model-based audit in
// the pipeline adds a semantic check on top. Severity:
//   error — a protected detail was lost, altered or invented
//   warn  — a likely meaning change worth reviewing
//   info  — a notable change that is often intended

import { extractProtected } from '../text/protect.js';
import { normWords, countWords } from '../text/tokenize.js';
import { HEDGES, BOOSTERS, NEGATIONS } from '../text/lexicon.js';

const NEG = new Set(NEGATIONS);
const HEDGE = new Set(HEDGES);
const BOOST = new Set(BOOSTERS);

const squash = (s) => String(s).toLowerCase().replace(/[“”"]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

// Contrastive phrases that express negation without a negative word, so
// "a probability rather than proof" and "a probability, not proof" balance.
const CONTRASTIVE = /\b(rather than|instead of|as opposed to)\b/gi;

function countNegations(text) {
  return normWords(text).filter((w) => NEG.has(w) || /n't$/.test(w)).length + (String(text).match(CONTRASTIVE) || []).length;
}

export function validateRevision(original, revised, { glossary = [], concision = 0 } = {}) {
  const issues = [];
  const a = extractProtected(original, { glossary });
  const b = extractProtected(revised, { glossary });
  const revSquash = squash(revised);
  const origSquash = squash(original);

  // Numbers: compare the sets of normalised values.
  const aNums = new Map(a.numbers.map((x) => [x.key, x]));
  const bNums = new Map(b.numbers.map((x) => [x.key, x]));
  const missingNums = [...aNums.values()].filter((x) => !bNums.has(x.key));
  const newNums = [...bNums.values()].filter((x) => !aNums.has(x.key) && !(x.spelled && x.value <= 3));
  if (missingNums.length) issues.push({ type: 'missing-number', severity: 'error', message: `Number${missingNums.length > 1 ? 's' : ''} missing or changed: ${missingNums.map((x) => x.text).join(', ')}`, items: missingNums.map((x) => x.text) });
  if (newNums.length) issues.push({ type: 'new-number', severity: 'error', message: `New number${newNums.length > 1 ? 's' : ''} not in the original: ${newNums.map((x) => x.text).join(', ')}`, items: newNums.map((x) => x.text) });

  // Quotations must survive word for word.
  const lostQuotes = a.quotes.filter((q) => !revSquash.includes(squash(q.text)));
  if (lostQuotes.length) issues.push({ type: 'altered-quote', severity: 'error', message: `Quotation altered or removed: “${lostQuotes[0].text.slice(0, 80)}”${lostQuotes.length > 1 ? ` (+${lostQuotes.length - 1} more)` : ''}`, items: lostQuotes.map((q) => q.text) });
  const newQuotes = b.quotes.filter((q) => !origSquash.includes(squash(q.text)));
  if (newQuotes.length) issues.push({ type: 'new-quote', severity: 'error', message: `New quotation not in the original: “${newQuotes[0].text.slice(0, 80)}”`, items: newQuotes.map((q) => q.text) });

  // Citations and links must survive and must not be invented.
  const lostCites = a.citations.filter((c) => !revSquash.includes(squash(c.text)));
  if (lostCites.length) issues.push({ type: 'missing-citation', severity: 'error', message: `Citation removed or changed: ${lostCites.map((c) => c.text).join(', ')}`, items: lostCites.map((c) => c.text) });
  const newCites = b.citations.filter((c) => !origSquash.includes(squash(c.text)));
  if (newCites.length) issues.push({ type: 'new-citation', severity: 'error', message: `Citation not in the original: ${newCites.map((c) => c.text).join(', ')}`, items: newCites.map((c) => c.text) });
  const lostLinks = a.links.filter((l) => !revised.includes(l.text));
  if (lostLinks.length) issues.push({ type: 'missing-link', severity: 'error', message: `Link removed or changed: ${lostLinks.map((l) => l.text).join(', ')}`, items: lostLinks.map((l) => l.text) });
  const newLinks = b.links.filter((l) => !original.includes(l.text));
  if (newLinks.length) issues.push({ type: 'new-link', severity: 'error', message: `Link not in the original: ${newLinks.map((l) => l.text).join(', ')}`, items: newLinks.map((l) => l.text) });

  // Glossary terms are non-negotiable.
  const lostTerms = a.terms.filter((t) => !revSquash.includes(t.key));
  if (lostTerms.length) issues.push({ type: 'missing-term', severity: 'error', message: `Protected term missing: ${lostTerms.map((t) => t.text).join(', ')}`, items: lostTerms.map((t) => t.text) });

  // Names: missing ones are a warning (a pronoun may legitimately replace a
  // repeated name), introduced ones usually mean added content.
  const lostNames = a.entities.filter((e) => !revSquash.includes(e.key));
  if (lostNames.length) issues.push({ type: 'missing-name', severity: 'warn', message: `Name or term no longer present: ${lostNames.map((e) => e.text).join(', ')}`, items: lostNames.map((e) => e.text) });
  const newNames = b.entities.filter((e) => !origSquash.includes(e.key));
  if (newNames.length) issues.push({ type: 'new-name', severity: 'warn', message: `Name or term not in the original: ${newNames.map((e) => e.text).join(', ')}`, items: newNames.map((e) => e.text) });

  // Negation balance: a changed count is the cheapest signal of a reversed claim.
  const na = countNegations(original);
  const nb = countNegations(revised);
  // A paraphrase often drops one negation legitimately ("never notice" →
  // "go unnoticed"), so a single change is informational; losing all of them,
  // gaining them from none, or a larger swing is worth a warning.
  if (na !== nb) {
    const strong = Math.abs(na - nb) >= 2 || na === 0 || nb === 0;
    issues.push({ type: 'negation-change', severity: strong ? 'warn' : 'info', message: `Negations changed (${na} → ${nb}). Check that no statement was reversed.`, items: [] });
  }

  // Certainty: hedged claims becoming confident ones (or the reverse).
  const wa = normWords(original);
  const wb = normWords(revised);
  const ha = wa.filter((w) => HEDGE.has(w)).length;
  const hb = wb.filter((w) => HEDGE.has(w)).length;
  const ba = wa.filter((w) => BOOST.has(w)).length;
  const bb = wb.filter((w) => BOOST.has(w)).length;
  if (ha >= 2 && hb <= ha / 2 && bb > ba) {
    issues.push({ type: 'certainty-change', severity: 'warn', message: `Hedged claims may now sound more certain (hedges ${ha} → ${hb}).`, items: [] });
  } else if (ba >= 2 && bb <= ba / 2 && hb > ha + 1) {
    issues.push({ type: 'certainty-change', severity: 'info', message: `Confident claims may now sound weaker (hedges ${ha} → ${hb}).`, items: [] });
  }

  // Length: very large changes usually mean dropped or added material.
  const la = countWords(original);
  const lb = countWords(revised);
  const ratio = la ? lb / la : 1;
  const low = 0.6 - Math.max(0, concision) * 0.12;
  const high = 1.5 + Math.max(0, -concision) * 0.25;
  if (la >= 12 && ratio < low) issues.push({ type: 'length-change', severity: 'warn', message: `Revision is ${Math.round((1 - ratio) * 100)}% shorter. Check that no details or arguments were dropped.`, items: [] });
  if (la >= 12 && ratio > high) issues.push({ type: 'length-change', severity: 'warn', message: `Revision is ${Math.round((ratio - 1) * 100)}% longer. Check for added material.`, items: [] });

  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warnCount: issues.filter((i) => i.severity === 'warn').length,
    lengthRatio: Math.round(ratio * 100) / 100,
  };
}

// Phrases models prepend or append around the requested text.
const PREAMBLE = /^(?:sure|certainly|of course|absolutely|here(?:'s| is| are)|below is|okay|ok)\b[^\n]*?:\s*\n+/i;
const POSTAMBLE = /\n+(?:let me know|i hope this|feel free|this (?:revision|version|rewrite) )[^\n]*$/i;

/** Strip chat framing and stray markdown that the original did not contain. */
export function cleanModelText(text, original = '') {
  let t = String(text || '').trim();
  t = t.replace(PREAMBLE, '').replace(POSTAMBLE, '').trim();
  if (/^```/.test(t)) t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  if (!/\*\*/.test(original)) t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  if (!/^#/m.test(original)) t = t.replace(/^#{1,6}\s+/gm, '');
  if (/^["“].*["”]$/s.test(t) && !/^["“]/.test(original.trim())) t = t.slice(1, -1).trim();
  return matchTypography(t, original);
}

/**
 * Follow the original's typographic conventions: straight or curly quotes and
 * apostrophes, and plain hyphens instead of the non-breaking variants models
 * sometimes emit.
 */
export function matchTypography(text, original = '') {
  let t = String(text).replace(/[‐‑]/g, '-').replace(/ /g, ' ');
  const curlyOrig = /[‘’“”]/.test(original);
  const straightOrig = /['"]/.test(original);
  if (straightOrig && !curlyOrig) t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  else if (curlyOrig && !straightOrig) {
    t = t.replace(/(\w)'(\w)/g, '$1’$2').replace(/"([^"\n]*)"/g, '“$1”');
  }
  return t;
}
