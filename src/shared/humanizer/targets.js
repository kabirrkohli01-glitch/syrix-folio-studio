// Measurable targets for feedback rounds. Each recognised piece of feedback
// becomes a numeric target derived from the version being revised, stated in
// the prompt and checked on the result. A round that misses its targets is
// retried with the measured numbers, which is far more reliable than asking
// the model to judge "more concise" on its own.

import { analyze } from '../text/stylometry.js';

const r = (x) => Math.round(x * 10) / 10;

export function feedbackTargets(matchedIds, baseText) {
  const f = analyze(baseText);
  const out = [];
  const has = (id) => matchedIds.includes(id);
  if (has('concise')) {
    const limit = Math.max(5, Math.floor(f.wordCount * 0.85));
    out.push({ id: 'concise', text: `Use at most ${limit} words in total (the current version has ${f.wordCount}). Cut padding, not content.`, check: (g) => g.wordCount <= Math.ceil(f.wordCount * 0.92), measure: (g) => `${g.wordCount} words` });
  }
  if (has('less-formal')) {
    out.push({ id: 'less-formal', text: `Lower the formality noticeably (current estimate ${f.formality}/100): plainer words, a more direct voice${f.contractionRate < 0.5 ? ', and natural contractions' : ''}.`, check: (g) => g.formality <= f.formality - 4 || g.contractionRate > f.contractionRate + 0.4, measure: (g) => `formality ${g.formality}/100, ${g.contractionRate} contractions per 100 words` });
  }
  if (has('more-formal')) {
    out.push({ id: 'more-formal', text: `Raise the formality noticeably (current estimate ${f.formality}/100) and use no contractions.`, check: (g) => g.formality >= f.formality + 4 && g.contractionRate <= 0.2, measure: (g) => `formality ${g.formality}/100, ${g.contractionRate} contractions per 100 words` });
  }
  if (has('vary') && f.sentenceCount >= 3) {
    const target = Math.max(r(f.sentenceLengthVariation + 0.1), 0.45);
    out.push({ id: 'vary', text: `Vary sentence length more (current variation ${f.sentenceLengthVariation}; aim for at least ${target}): include at least one sentence of 8 words or fewer and one of 25 words or more, and do not start consecutive sentences the same way.`, check: (g) => g.sentenceLengthVariation >= f.sentenceLengthVariation + 0.05, measure: (g) => `variation ${g.sentenceLengthVariation}` });
  }
  if (has('clearer')) {
    out.push({ id: 'clearer', text: `Make it easier to read: average sentence length below ${Math.max(10, Math.round(f.avgSentenceLength - 3))} words (currently ${f.avgSentenceLength}).`, check: (g) => g.avgSentenceLength <= f.avgSentenceLength - 1.5 || g.readingEase >= f.readingEase + 5, measure: (g) => `${g.avgSentenceLength} words per sentence, reading ease ${g.readingEase}` });
  }
  if (has('repetition')) {
    out.push({ id: 'repetition', text: 'Do not repeat any multi-word phrase, and do not start two consecutive sentences with the same word.', check: (g) => g.repeatedTrigramRate <= f.repeatedTrigramRate && g.repeatedOpenerShare <= Math.max(f.repeatedOpenerShare, 0.34), measure: (g) => `repeated phrases ${g.repeatedTrigramRate} per 100 words` });
  }
  return out;
}

/**
 * Targets that apply to every round, independent of feedback. Currently
 * rhythm: a passage whose sentences are all about the same length gets a
 * measurable variation target unless the variation control is "keep" or a
 * writer profile governs sentence length.
 */
export function qualityTargets(controls, baseText, { voiceActive = false } = {}) {
  const out = [];
  if (voiceActive || controls.variation === 'keep') return out;
  const f = analyze(baseText);
  if (f.sentenceCount < 4) return out;
  const goal = controls.variation === 'high' ? 0.5 : 0.38;
  if (f.sentenceLengthVariation < goal) {
    out.push({
      id: 'rhythm',
      text: `Vary sentence length: the sentences here are very even (variation ${f.sentenceLengthVariation}); aim for at least ${goal}. Include at least one sentence of 8 words or fewer and one of 20 words or more, and avoid repeating the same sentence opening or construction.`,
      check: (g) => g.sentenceLengthVariation >= Math.min(goal, f.sentenceLengthVariation + 0.12),
      measure: (g) => `variation ${g.sentenceLengthVariation}`,
    });
  }
  return out;
}

/** Evaluate targets on a candidate; returns { passed, failed: [{ id, text, measured }] }. */
export function checkTargets(targets, text) {
  if (!targets.length) return { passed: 0, failed: [] };
  const g = analyze(text);
  const failed = targets.filter((t) => !t.check(g)).map((t) => ({ id: t.id, text: t.text, measured: t.measure(g) }));
  return { passed: targets.length - failed.length, failed };
}
