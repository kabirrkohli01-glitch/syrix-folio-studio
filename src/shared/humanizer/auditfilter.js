// Post-filter for the model-based meaning audit. Auditors tend to report the
// removal of clichés and decorative adjectives ("fast-paced", "pivotal") as
// lost detail, and repairing those findings would put the padding straight
// back. Findings whose quoted original consists only of such wording are
// downgraded to informational and are never auto-repaired.

import { FORMULAIC, FUNCTION_WORDS } from '../text/lexicon.js';
import { normWords } from '../text/tokenize.js';

const INFLATED = new Set([
  'pivotal', 'crucial', 'vital', 'key', 'essential', 'seamless', 'seamlessly', 'robust',
  'fast', 'paced', 'fast-paced', 'ever', 'evolving', 'ever-evolving', 'changing', 'ever-changing',
  'landscape', 'realm', 'tapestry', 'delve', 'delves', 'leverage', 'leveraging', 'utilise',
  'utilize', 'utilising', 'utilizing', 'myriad', 'plethora', 'testament', 'truly', 'incredibly',
  'extremely', 'very', 'really', 'today', "today's", 'modern', 'digital', 'age', 'era', 'world',
  'role', 'plays', 'play', 'important', 'note', 'noting', 'worth', 'overall', 'significant',
  'significantly', 'cutting', 'edge', 'cutting-edge', 'game', 'changer', 'game-changer',
  'unlock', 'potential', 'harness', 'power', 'journey', 'navigate', 'complexities', 'thereby',
  'furthermore', 'moreover', 'additionally', 'enhance', 'enhancing', 'effectively', 'seamless',
]);
const FUNCTION_SET = new Set(FUNCTION_WORDS);
const FORMULAIC_WORDS = new Set(FORMULAIC.flatMap((f) => normWords(f.p)));

export function isStyleOnlyFinding(issue) {
  const excerpt = `${issue.original || ''}`;
  const content = normWords(excerpt).filter((w) => !FUNCTION_SET.has(w));
  if (!content.length) {
    // No excerpt: fall back to the explanation, which usually names the word.
    const quoted = (issue.message || '').match(/[‘'"“]([^’'"”]{2,40})[’'"”]/g) || [];
    const words = quoted.flatMap((q) => normWords(q)).filter((w) => !FUNCTION_SET.has(w));
    return words.length > 0 && words.every((w) => INFLATED.has(w) || FORMULAIC_WORDS.has(w));
  }
  return content.length <= 6 && content.every((w) => INFLATED.has(w) || FORMULAIC_WORDS.has(w));
}

export function filterAuditIssues(issues) {
  return issues.map((it) => (isStyleOnlyFinding(it)
    ? { ...it, severity: 'info', styleOnly: true, message: `Style change only: ${it.message}` }
    : it));
}
