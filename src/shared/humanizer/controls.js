// Humanizer controls: defaults, presets, and the mapping from revision
// feedback to control changes. Feedback adjusts the controls as well as being
// passed to the model verbatim, so a follow-up request changes the brief
// structurally instead of relying on the model to notice a sentence of text.

export const DEFAULT_CONTROLS = Object.freeze({
  tone: 'keep',
  formality: 0, // -2 much less formal … +2 much more formal
  vocabulary: 0, // -2 much simpler … +2 richer
  audience: 'general',
  sentenceLength: 0, // -2 much shorter … +2 longer
  variation: 'natural', // keep | natural | high
  flow: true,
  readability: 'keep', // keep | plain | standard | advanced
  concision: 0, // -2 elaborate … +2 much more concise
  fixRepetition: true,
  fixErrors: true,
  removeFillers: true,
  transitions: 'natural', // fewer | natural | more
  strength: 2, // 1 light edit … 4 full rewrite
  preserveStructure: true,
  profileId: null,
  profileStrength: 'balanced', // subtle | balanced | strong
  spelling: 'keep', // keep | british | american
  contractions: 'keep', // keep | avoid | allow
  keepTerminology: true,
  glossary: [],
});

export const PRESETS = [
  { id: 'natural', name: 'Natural', description: 'Clear, varied, plain-spoken. Recommended.', controls: {} },
  { id: 'clarity', name: 'Light edit', description: 'Fix mistakes and awkward bits, keep your wording.', controls: { strength: 1, readability: 'standard', concision: 1 } },
  { id: 'academic', name: 'Academic', description: 'Precise and formal, without padding.', controls: { tone: 'academic', formality: 1, contractions: 'avoid', transitions: 'natural', strength: 2 } },
  { id: 'concise', name: 'Concise', description: 'Cut padding and repetition hard.', controls: { concision: 2, strength: 2, sentenceLength: -1 } },
  { id: 'conversational', name: 'Conversational', description: 'Relaxed and direct.', controls: { tone: 'conversational', formality: -1, contractions: 'allow', strength: 3 } },
  { id: 'voice', name: 'Match my voice', description: 'Rewrite toward the selected writing profile.', controls: { strength: 3, profileStrength: 'strong' } },
];

export const STRENGTH_LABELS = {
  1: { name: 'Light edit', detail: 'Change only what reads badly; keep most wording and every sentence boundary that works.' },
  2: { name: 'Moderate', detail: 'Rephrase freely within sentences; merge or split sentences where it helps.' },
  3: { name: 'Strong', detail: 'Rebuild sentences from the meaning up; keep paragraph content and order.' },
  4: { name: 'Full rewrite', detail: 'Re-voice each paragraph completely; sentence order inside a paragraph may change.' },
};

export const TONES = [
  ['keep', 'Keep current tone'], ['neutral', 'Neutral'], ['professional', 'Professional'],
  ['academic', 'Academic'], ['conversational', 'Conversational'], ['warm', 'Warm'],
  ['confident', 'Confident'], ['persuasive', 'Persuasive'],
];

export const AUDIENCES = [
  ['general', 'General readers'], ['students', 'Students'], ['specialists', 'Specialists'],
  ['executives', 'Busy decision-makers'], ['children', 'Younger readers'],
];

export function applyPreset(controls, presetId) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ...controls };
  const keep = { profileId: controls.profileId, glossary: controls.glossary, spelling: controls.spelling };
  return { ...DEFAULT_CONTROLS, ...preset.controls, ...keep };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Quick feedback chips. `expect` tells the pipeline which direction the next
// version should move: away from the previous version, or back toward the
// original wording.
export const FEEDBACK_CHIPS = [
  { id: 'clearer', label: 'Make it clearer', instruction: 'Make it clearer: shorter sentences where meaning is tangled, concrete wording, no ambiguity about who does what.', adjust: (c) => ({ ...c, readability: c.readability === 'advanced' ? 'standard' : 'plain', sentenceLength: clamp(c.sentenceLength - 1, -2, 2) }), expect: 'change' },
  { id: 'less-formal', label: 'Less formal', instruction: 'Make it less formal: plainer words, a more direct voice, contractions where natural.', adjust: (c) => ({ ...c, formality: clamp(c.formality - 1, -2, 2), contractions: 'allow' }), expect: 'change' },
  { id: 'more-formal', label: 'More formal', instruction: 'Make it more formal: precise vocabulary, no contractions, measured tone.', adjust: (c) => ({ ...c, formality: clamp(c.formality + 1, -2, 2), contractions: 'avoid' }), expect: 'change' },
  { id: 'vary', label: 'Vary sentence structure', instruction: 'Vary the sentence structure more: mix short and long sentences, change how sentences open, avoid repeating the same pattern.', adjust: (c) => ({ ...c, variation: 'high' }), expect: 'change' },
  { id: 'repetition', label: 'Reduce repetition', instruction: 'Reduce repetition: remove repeated words, phrases and sentence openings; say each thing once.', adjust: (c) => ({ ...c, fixRepetition: true }), expect: 'change' },
  { id: 'concise', label: 'More concise', instruction: 'Make it more concise: cut padding, redundancy and throat-clearing without losing any facts or arguments.', adjust: (c) => ({ ...c, concision: clamp(c.concision + 1, -2, 2) }), expect: 'change' },
  { id: 'keep-wording', label: 'Keep more of my wording', instruction: 'Keep more of the original wording: revert to the original phrasing wherever it already worked, and change only what genuinely needed improving.', adjust: (c) => ({ ...c, strength: clamp(c.strength - 1, 1, 4), preserveStructure: true }), expect: 'closer' },
  { id: 'technical', label: 'Preserve technical detail', instruction: 'Preserve all technical detail: keep every technical term, specification, step and qualifier exactly; do not simplify technical content.', adjust: (c) => ({ ...c, keepTerminology: true, vocabulary: Math.max(c.vocabulary, 0) }), expect: 'closer' },
  { id: 'profile', label: 'Closer to my profile', instruction: 'Match the selected writing profile more closely in sentence length, vocabulary, punctuation habits and typical phrasing.', adjust: (c) => ({ ...c, profileStrength: 'strong' }), expect: 'change' },
  { id: 'warmer', label: 'Warmer', instruction: 'Make the tone warmer and more human, without becoming informal or adding new content.', adjust: (c) => ({ ...c, tone: 'warm' }), expect: 'change' },
  { id: 'confident', label: 'More confident', instruction: 'Sound more confident and direct, but keep every original qualifier that limits a claim.', adjust: (c) => ({ ...c, tone: 'confident' }), expect: 'change' },
];

// Free-text feedback is matched against these patterns so typed requests get
// the same structural adjustment as the equivalent chip.
const FEEDBACK_PATTERNS = [
  [/\b(clear|clearer|clarity|confusing|easier to (?:read|follow|understand))\b/i, 'clearer'],
  [/\b(less formal|more casual|more relaxed|too formal|too stiff|informal)\b/i, 'less-formal'],
  [/\b(more formal|more professional|too casual|too informal|academic)\b/i, 'more-formal'],
  [/\b(vary|variety|varied|monotonous|same length|sentence structure)\b/i, 'vary'],
  [/\b(repetit|repeated|repeats|same word)\b/i, 'repetition'],
  [/\b(concise|shorter|shorten|cut|trim|wordy|too long|tighter)\b/i, 'concise'],
  [/\b(my (?:own )?wording|original wording|my words|too different|changed too much|less change)\b/i, 'keep-wording'],
  [/\b(technical|terminology|jargon intact|keep the detail)\b/i, 'technical'],
  [/\b(profile|my style|my voice|sound like me)\b/i, 'profile'],
  [/\b(warmer|friendlier|kinder)\b/i, 'warmer'],
  [/\b(confident|assertive|stronger)\b/i, 'confident'],
];

/** Map typed feedback to known chips (may match several). */
export function interpretFeedback(text) {
  const ids = new Set();
  for (const [re, id] of FEEDBACK_PATTERNS) if (re.test(text)) ids.add(id);
  return FEEDBACK_CHIPS.filter((c) => ids.has(c.id));
}

/**
 * Apply a round of feedback (chip ids plus free text) to the controls.
 * Returns the adjusted controls and the expected direction of change.
 */
export function applyFeedback(controls, { chipIds = [], text = '' } = {}) {
  const chips = [
    ...FEEDBACK_CHIPS.filter((c) => chipIds.includes(c.id)),
    ...interpretFeedback(text).filter((c) => !chipIds.includes(c.id)),
  ];
  let next = { ...controls };
  for (const c of chips) next = c.adjust(next);
  const expect = chips.some((c) => c.expect === 'closer') ? 'closer' : 'change';
  const instructions = chips.filter((c) => chipIds.includes(c.id)).map((c) => c.instruction);
  if (text.trim()) instructions.push(text.trim());
  return { controls: next, expect, instructions, matched: chips.map((c) => c.id) };
}
