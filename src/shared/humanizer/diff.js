import { diffWordsWithSpace } from 'diff';
import { words } from '../text/tokenize.js';

/** Word-level diff parts: [{ value, added, removed }]. */
export function wordDiff(a, b) {
  return diffWordsWithSpace(String(a || ''), String(b || ''));
}

/**
 * Share of words kept between two passages (0–1), based on the word diff.
 * 1 means identical wording; used to tell whether a new version actually
 * responded to feedback.
 */
export function similarity(a, b) {
  const parts = wordDiff(a, b);
  let same = 0; let changed = 0;
  for (const p of parts) {
    const n = words(p.value).length;
    if (p.added || p.removed) changed += n; else same += n * 2;
  }
  return same + changed ? same / (same + changed) : 1;
}
