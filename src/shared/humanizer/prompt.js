// Prompt construction for the humanizer. Every control maps to an explicit
// instruction, the profile contributes measured targets plus excerpts, and
// the deterministic analysis contributes concrete revision targets, so the
// model is never asked to "make it sound human" without saying how.

import { STRENGTH_LABELS } from './controls.js';
import { describeProfile } from '../profile/profile.js';

export const REWRITE_SYSTEM = `You are the revision engine inside SYRIX Folio, a writing studio. You revise text so that it reads as clear, natural, well-made prose in the writer's own voice, while keeping its meaning exactly.

Non-negotiable rules:
1. Meaning. Keep every fact, claim, argument, example, qualifier and caveat. Do not add facts, examples, statistics, names, sources, quotations or opinions that are not in the original, and do not remove any. If a sentence is ambiguous, keep the ambiguity rather than guess.
2. Protected details. Reproduce exactly: numbers, dates, units, names, quotations (word for word inside their quotation marks), citations, URLs and any listed terms.
3. Quality, never imitation of mistakes. Write good prose. Never insert typos, grammatical errors, slang, filler words or deliberate awkwardness to make text seem casual.
4. Output. Return only the revised paragraphs in the required format: no commentary, headings, notes or markdown.

What well-made prose means here:
- Every sentence does work. Cut throat-clearing ("It is important to note that"), stock phrases ("plays a pivotal role", "in today's fast-paced world") and empty intensifiers.
- Concrete over abstract: name the actor and the action.
- Let sentence length follow the thought — short for emphasis, longer to connect reasons — rather than a uniform pattern.
- Connect ideas through logic and word order. Use explicit connectives ("however", "therefore") only where the relationship would otherwise be unclear, and never stack them on consecutive sentences.
- Vary how sentences open, and avoid repeating a word or construction in close succession unless it is a deliberate term.
- Prefer the common word when it is equally precise ("use", not "utilise"; "help", not "facilitate"), but keep technical terms that carry precise meaning.
- Avoid formula: reflexive triplets, repeated "not only … but also", closing sentences that merely restate the paragraph, and rhetorical questions that were not in the original.
- Signposting that introduces a point ("There are also risks.", "Two problems stand out.") is content, not padding: keep the point it announces, even if you fold it into the next sentence.
- Every "this", "these" or "such" must refer to something actually stated in your output. Never refer back to a point you removed.`;

const FORMALITY = {
  '-2': 'Much less formal than the original: plain words, direct address where it fits, relaxed rhythm.',
  '-1': 'Somewhat less formal than the original.',
  0: 'Keep the original level of formality.',
  1: 'Somewhat more formal than the original.',
  2: 'Much more formal: precise, measured, impersonal where appropriate.',
};
const VOCAB = {
  '-2': 'Much simpler vocabulary: everyday words, explain or replace jargon that is not essential.',
  '-1': 'Slightly simpler vocabulary; replace inflated words with plain ones.',
  0: 'Keep the vocabulary level, replacing only inflated or vague words.',
  1: 'Richer, more precise vocabulary where it sharpens meaning — never ornamental.',
  2: 'Sophisticated, exact vocabulary suited to an expert reader — never ornamental.',
};
const SENT_LEN = {
  '-2': 'Noticeably shorter sentences on average; split long sentences.',
  '-1': 'Slightly shorter sentences on average.',
  0: 'Keep a similar average sentence length.',
  1: 'Slightly longer sentences where ideas belong together.',
  2: 'Longer, more connected sentences where ideas belong together.',
};
const CONCISION = {
  '-2': 'Elaborate: develop each point a little more fully using only what the original already implies — no new facts or examples.',
  '-1': 'Allow slightly fuller phrasing where it improves clarity — no new facts or examples.',
  0: 'Similar length; cut only genuine padding.',
  1: 'More concise: cut padding and redundancy (aim for roughly 10–20% shorter) without dropping any content.',
  2: 'Much more concise: cut hard (aim for roughly 25–35% shorter) while keeping every fact, argument and qualifier.',
};
const TONE = {
  keep: 'Keep the tone of the original.',
  neutral: 'Neutral, even-handed tone.',
  professional: 'Professional tone: courteous, clear and businesslike.',
  academic: 'Academic tone: precise, measured, evidence-led and appropriately hedged.',
  conversational: 'Conversational tone: as if explaining to a capable colleague.',
  warm: 'Warm, human tone without becoming informal or sentimental.',
  confident: 'Confident, direct tone — but keep every qualifier that limits a claim.',
  persuasive: 'Persuasive tone that argues the existing points well — no new claims.',
};
const AUDIENCE = {
  general: 'general readers', students: 'students', specialists: 'specialists in the field',
  executives: 'busy decision-makers who want the point first', children: 'younger readers (plain words, short sentences)',
};
const READABILITY = {
  keep: null,
  plain: 'Aim for plain-English readability (roughly a Flesch reading ease of 60 or above).',
  standard: 'Aim for standard readability (roughly a Flesch reading ease of 50–60).',
  advanced: 'Advanced readability is acceptable for an expert audience, but no sentence should need re-reading.',
};

export function briefLines(controls, analysis, profileActive = false) {
  const c = controls;
  const lines = [];
  const st = STRENGTH_LABELS[c.strength] || STRENGTH_LABELS[2];
  lines.push(`Rewrite strength: ${st.name} — ${st.detail}`);
  lines.push(c.preserveStructure
    ? 'Structure: keep the paragraph count and order, and keep the order of points within each paragraph.'
    : 'Structure: keep the paragraph count and order; within a paragraph you may reorder points if the logic improves.');
  // With a profile, settings left at "keep" defer to the writer's measured
  // voice instead of the original text's habits.
  const voice = profileActive && c.profileStrength !== 'subtle';
  lines.push(`Tone: ${c.tone === 'keep' && voice ? 'Use the writer profile’s tone.' : TONE[c.tone] || TONE.keep}`);
  lines.push(`Formality: ${c.formality === 0 && voice ? 'Match the writer profile’s formality.' : FORMALITY[c.formality] ?? FORMALITY[0]}`);
  lines.push(`Vocabulary: ${c.vocabulary === 0 && voice ? 'Use the writer profile’s everyday vocabulary, keeping technical terms that carry meaning.' : VOCAB[c.vocabulary] ?? VOCAB[0]} Audience: ${AUDIENCE[c.audience] || AUDIENCE.general}.`);
  lines.push(`Sentence length: ${c.sentenceLength === 0 && voice ? 'Match the writer profile’s average sentence length and sentence mix — split or join sentences as needed.' : SENT_LEN[c.sentenceLength] ?? SENT_LEN[0]}`);
  if (c.variation === 'high') lines.push('Sentence variation: high — deliberately mix short, medium and long sentences and vary their openings and structure.');
  else if (c.variation === 'natural') lines.push('Sentence variation: natural — avoid runs of sentences with the same length or shape.');
  if (c.flow) lines.push('Flow: each sentence should follow from the one before; smooth abrupt jumps using word order and reference, not filler connectives.');
  if (READABILITY[c.readability]) lines.push(`Readability: ${READABILITY[c.readability]}`);
  lines.push(`Length: ${CONCISION[c.concision] ?? CONCISION[0]}`);
  if (c.fixRepetition) lines.push('Repetition: remove repeated words, phrases and sentence openings, and fix awkward or clumsy wording.');
  if (c.fixErrors !== false) lines.push('Correctness: fix every spelling, grammar, punctuation and word-usage error (for example "could of" → "could have", "alot" → "a lot", "then"/"than" mix-ups). The result must contain no errors.');
  if (c.removeFillers !== false) lines.push('Filler: cut verbal filler that adds nothing in writing ("and all", "you know", "basically", "kind of", "pretty much"), unless the writer profile shows the writer genuinely uses that word in their written voice.');
  lines.push(c.transitions === 'fewer'
    ? 'Transitions: use as few explicit connectives as possible; never open consecutive sentences with one.'
    : c.transitions === 'more'
      ? 'Transitions: make the logical links explicit where a reader might lose the thread, using plain connectives.'
      : 'Transitions: use connectives only where the relationship between sentences is not already clear.');
  const spelling = c.spelling === 'keep' ? (analysis?.spelling === 'british' ? 'british' : analysis?.spelling === 'american' ? 'american' : 'keep') : c.spelling;
  lines.push(spelling === 'british' ? 'Spelling: British English (e.g. organise, colour, centre).' : spelling === 'american' ? 'Spelling: American English (e.g. organize, color, center).' : 'Spelling: keep the original spelling conventions.');
  lines.push(c.contractions === 'avoid' ? 'Contractions: do not use contractions.' : c.contractions === 'allow' ? 'Contractions: use them where they read naturally.' : voice ? 'Contractions: use them at the writer profile’s rate.' : 'Contractions: follow the original.');
  if (c.keepTerminology) lines.push('Terminology: keep technical and domain terms exactly; do not swap them for looser synonyms.');
  return lines;
}

export function profileBlock(profile, strength = 'balanced') {
  if (!profile || !profile.analysis || !profile.analysis.stats) return '';
  const a = profile.analysis;
  const s = a.stats;
  const weight = strength === 'strong'
    ? 'Match this voice closely: it should read as if this writer wrote it.'
    : strength === 'subtle'
      ? 'Lean gently toward this voice; clarity and the brief take priority.'
      : 'Match this voice where it does not conflict with the brief.';
  const traits = describeProfile(a).map((t) => `- ${t.label}: ${t.text}`).join('\n');
  const targets = [
    `average sentence about ${s.avgSentenceLength} words (standard deviation about ${s.sdSentenceLength})`,
    `contractions about ${s.contractionRate} per 100 words`,
    `estimated formality about ${s.formality}/100`,
    `average word length about ${s.avgWordLength} letters`,
    `semicolons ${s.punctuation.semicolon} and dashes ${s.punctuation.dash} per 1,000 words`,
  ].join('; ');
  const rules = (profile.rules || []).filter(Boolean);
  const notes = (profile.notes || '').trim();
  const summary = (profile.summary || '').trim();
  const avoid = a.unusedFormal && a.unusedFormal.length ? `\nThis writer does not use: ${a.unusedFormal.slice(0, 8).map((x) => `“${x}”`).join(', ')}.` : '';
  const phrases = a.commonPhrases && a.commonPhrases.length ? `\nPhrasing this writer actually uses (only where it fits naturally; never force it): ${a.commonPhrases.slice(0, 8).map((x) => `“${x.phrase}”`).join(', ')}.` : '';
  const mix = a.sentenceMix ? `
Sentence mix to aim for: about ${a.sentenceMix.short}% short sentences (10 words or fewer), ${a.sentenceMix.medium}% medium and ${a.sentenceMix.long}% long (25 words or more).` : '';
  const markers = a.voiceMarkers && a.voiceMarkers.used.length ? `
Everyday words this writer uses regularly (per 1,000 words; use them at a similar rate where they fit): ${a.voiceMarkers.used.slice(0, 12).map((x) => `“${x.marker}” ${x.per1000}`).join(', ')}.` : '';
  const unusedMarkers = a.voiceMarkers && a.voiceMarkers.unused.length ? `
Words this writer never uses in their samples (avoid them): ${a.voiceMarkers.unused.slice(0, 12).map((x) => `“${x}”`).join(', ')}.` : '';
  const exemplars = (profile.exemplars || []).slice(0, 3).map((e, i) => `<excerpt ${i + 1}>\n${e.text}\n</excerpt ${i + 1}>`).join('\n');
  return `WRITER PROFILE — "${profile.name}". ${weight}
${summary ? `Voice summary: ${summary}\n` : ''}Measured traits:
${traits}
Measured targets: ${targets}.${mix}${markers}${unusedMarkers}${avoid}${phrases}
${rules.length ? `Writer's own rules:\n${rules.map((r) => `- ${r}`).join('\n')}\n` : ''}${notes ? `Writer's notes: ${notes}\n` : ''}${exemplars ? `Excerpts of this writer's own prose. Imitate voice and rhythm only; never reuse their content:\n${exemplars}` : ''}`.trim();
}

/**
 * Build the user message for one chunk of paragraphs.
 *
 * mode:
 *   fresh   — revise the original (first round, or "keep more of my wording")
 *   refine  — revise the previous version according to the notes; the
 *             original is supplied as the reference for meaning
 *   alternate — revise the original again, deliberately unlike the previous version
 */
export function buildRewritePrompt({
  paragraphs, reference = null, previous = null, mode = 'fresh', controls, analysis, profile,
  protectedItems = [], issues = [], feedback = [], targets = [], contextBefore = '', contextAfter = '', attempt = 0,
}) {
  const parts = [];
  parts.push(`REVISION BRIEF
${briefLines(controls, analysis, Boolean(profile && profile.analysis)).map((l) => `- ${l}`).join('\n')}`);
  const pb = profileBlock(profile, controls.profileStrength);
  if (pb) parts.push(pb);
  if (protectedItems.length) parts.push(`DETAILS THAT MUST APPEAR EXACTLY AS WRITTEN
${protectedItems.slice(0, 60).map((x) => `- ${x}`).join('\n')}`);
  if (feedback.length) {
    parts.push(`REVISION NOTES FROM THE WRITER (most recent last — the latest note takes priority)
${feedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}`);
  }
  if (targets.length) {
    parts.push(`MEASURABLE TARGETS FOR THIS ROUND (the result is checked against these)
${targets.map((t) => `- ${t}`).join('\n')}`);
  }
  if (issues.length) {
    parts.push(`SPECIFIC PROBLEMS FOUND IN THIS PASSAGE (fix each one)
${issues.slice(0, 14).map((i) => `- ${i.message}${i.text && i.type !== 'uniform-rhythm' ? ` — “${i.text.slice(0, 90)}”` : ''}`).join('\n')}`);
  }
  if (contextBefore || contextAfter) {
    parts.push(`SURROUNDING TEXT (for continuity only — do not revise or repeat it)
${contextBefore ? `Before: “${contextBefore.slice(-500)}”
` : ''}${contextAfter ? `After: “${contextAfter.slice(0, 300)}”` : ''}`.trim());
  }
  if (mode === 'refine' && reference) {
    parts.push(`ORIGINAL TEXT — the reference for meaning. Every fact, claim, point and qualifier here must still be present in your output; do not reintroduce its padding or clichés.
${reference.map((p, i) => `<orig id="${i + 1}">${p}</orig>`).join('\n')}`);
  }
  if (mode === 'fresh' && previous && previous.length) {
    parts.push(`PREVIOUS VERSION — the writer felt this moved too far from their own wording. Stay closer to the original text than this version did.
${previous.map((p, i) => `<prev id="${i + 1}">${p}</prev>`).join('\n')}`);
  }
  if (mode === 'alternate' && previous && previous.length) {
    parts.push(`PREVIOUS VERSION — produce a genuinely different take: different sentence shapes and word choices, same meaning and brief.
${previous.map((p, i) => `<prev id="${i + 1}">${p}</prev>`).join('\n')}`);
  }
  if (attempt > 0) {
    parts.push('IMPORTANT: a previous attempt did not follow the output format or did not meet the notes and targets. Follow the format exactly and apply every note and target.');
  }
  const label = mode === 'refine' ? 'CURRENT VERSION TO REVISE (apply the revision notes to this text)' : 'TEXT TO REVISE';
  parts.push(`${label} — ${paragraphs.length} paragraph${paragraphs.length > 1 ? 's' : ''}
${paragraphs.map((p, i) => `<p id="${i + 1}">${p}</p>`).join('\n')}`);
  parts.push(`Return exactly ${paragraphs.length} paragraph${paragraphs.length > 1 ? 's' : ''} in the same order, each wrapped as <p id="N">…</p>, and nothing else.`);
  return parts.join('\n\n');
}

/** Parse <p id="N"> blocks. Returns null when the count does not match. */
export function parseParagraphs(output, expected) {
  const text = String(output || '');
  const found = [...text.matchAll(/<p\s+id=["']?(\d+)["']?\s*>([\s\S]*?)<\/p>/gi)];
  if (found.length === expected) {
    const byId = new Map(found.map((m) => [Number(m[1]), m[2].trim()]));
    const ordered = [];
    for (let i = 1; i <= expected; i++) {
      if (!byId.has(i)) return found.map((m) => m[2].trim());
      ordered.push(byId.get(i));
    }
    return ordered;
  }
  if (expected === 1 && found.length === 0 && text.trim()) return [text.trim()];
  return null;
}

export const REPAIR_SYSTEM = `You correct a revised paragraph so that it is faithful to its original. Change only what is needed to fix the listed problems; keep the rest of the revision's wording. Never add facts, names, numbers, quotations or citations that are not in the original. Return only the corrected paragraph wrapped as <p id="1">…</p>.`;

export function buildRepairPrompt({ original, revised, problems, controls, analysis, profileActive = false }) {
  return `ORIGINAL PARAGRAPH\n<original>${original}</original>\n\nCURRENT REVISION\n<revision>${revised}</revision>\n\nPROBLEMS TO FIX\n${problems.map((p) => `- ${p}`).join('\n')}\n\nKeep these brief settings: ${briefLines(controls, analysis, profileActive).slice(2, 6).join(' ')}\n\nReturn only <p id="1">…</p>.`;
}

export const REPAIR_BATCH_SYSTEM = `You correct revised paragraphs so that each is faithful to its original and free of the listed problems. For each item, change only what is needed to fix its problems and keep the rest of the revision's wording. Never add facts, names, numbers, quotations or citations that are not in the original. Return every corrected paragraph, in order, wrapped as <p id="N">…</p> with the item's number, and nothing else.`;

/** One request that repairs several paragraphs. items: [{ original, revised, problems }] */
export function buildBatchRepairPrompt({ items, controls, analysis, profileActive = false }) {
  const blocks = items.map((it, k) => `ITEM ${k + 1}\n<original>${it.original}</original>\n<revision>${it.revised}</revision>\nProblems:\n${it.problems.map((p) => `- ${p}`).join('\n')}`).join('\n\n');
  return `${blocks}\n\nKeep these brief settings: ${briefLines(controls, analysis, profileActive).slice(2, 6).join(' ')}\n\nReturn exactly ${items.length} paragraph${items.length === 1 ? '' : 's'} as <p id="1">…</p> to <p id="${items.length}">…</p>.`;
}

export const AUDIT_SYSTEM = `You are a meticulous editor checking a revision for changes in meaning. Compare each ORIGINAL paragraph with its REVISION.
Report only genuine meaning changes:
- added: a claim, fact, example, opinion or detail that the original does not contain or imply
- removed: a detail, argument, example, qualifier or caveat that the revision drops
- altered: a fact, number, name, term or relationship stated differently
- strength: a claim made noticeably more certain or less certain
- quote: a quotation or citation changed
Ignore changes of wording, style, sentence order or structure that keep the meaning. Removing clichés, filler, intensifiers or decorative adjectives ("fast-paced", "pivotal", "seamless", "it is important to note") is NOT a meaning change, and neither is a plainer synonym for an inflated word. Be strict about substance but do not invent problems.
Respond with JSON only: {"issues":[{"paragraph":N,"type":"added|removed|altered|strength|quote","severity":"high|medium|low","original":"short excerpt","revised":"short excerpt","explanation":"one sentence"}]}. Use {"issues":[]} when meaning is preserved.`;

export function buildAuditPrompt(pairs) {
  return pairs.map((p, i) => `PARAGRAPH ${p.index ?? i + 1}\nORIGINAL: ${p.original}\nREVISION: ${p.revised}`).join('\n\n');
}

export function parseJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export const PROFILE_SYSTEM = `You describe a writer's voice from samples of their own writing so that another editor can imitate it. Describe how they write, not what they write about and not how good it is. Be specific and concrete: sentence habits, typical openings, how they link ideas, vocabulary register, punctuation, how they handle evidence and opinion, and anything distinctive. Never quote personal details.
Respond with JSON only: {"summary":"3–5 sentences","rules":["6–10 short imperative rules an editor should follow to write in this voice"]}`;

export function buildProfilePrompt({ name, excerpts, traits }) {
  return `PROFILE: ${name}\n\nMEASURED TRAITS\n${traits.map((t) => `- ${t.label}: ${t.text}`).join('\n')}\n\nSAMPLES\n${excerpts.map((e, i) => `<sample ${i + 1}>\n${e}\n</sample ${i + 1}>`).join('\n')}`;
}
