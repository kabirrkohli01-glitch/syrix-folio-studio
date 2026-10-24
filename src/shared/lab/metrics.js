// Evaluation metrics for detector scores. Convention: a higher score means
// "more likely AI-generated"; label 1 = AI-generated, 0 = human-written.

/** Area under the ROC curve via the Mann–Whitney U statistic (ties count half). */
export function auroc(scores, labels) {
  const pos = []; const neg = [];
  scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return null;
  const all = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  // Average ranks for ties.
  const ranks = new Array(all.length);
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].s === all[i].s) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let rankSumPos = 0;
  all.forEach((x, i) => { if (x.y) rankSumPos += ranks[i]; });
  const u = rankSumPos - (pos.length * (pos.length + 1)) / 2;
  return u / (pos.length * neg.length);
}

/**
 * Threshold that keeps the false-positive rate at or below `maxFpr` on the
 * human samples, and the true-positive rate it achieves. With few human
 * samples the achievable FPR is coarse; `achievedFpr` reports it.
 */
export function tprAtFpr(scores, labels, maxFpr) {
  const human = scores.filter((s, i) => !labels[i]).sort((a, b) => b - a);
  const ai = scores.filter((s, i) => labels[i]);
  if (!human.length || !ai.length) return null;
  const allowed = Math.floor(maxFpr * human.length);
  // Flag strictly above the (allowed)-th highest human score.
  const threshold = human[allowed] ?? -Infinity;
  const fp = human.filter((s) => s > threshold).length;
  const tp = ai.filter((s) => s > threshold).length;
  return { threshold, tpr: tp / ai.length, achievedFpr: fp / human.length, humanCount: human.length };
}

export function confusion(scores, labels, threshold) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  scores.forEach((s, i) => {
    const pred = s > threshold;
    if (labels[i] && pred) tp++;
    else if (labels[i]) fn++;
    else if (pred) fp++;
    else tn++;
  });
  const total = tp + fp + tn + fn;
  return {
    tp, fp, tn, fn,
    accuracy: total ? (tp + tn) / total : null,
    fpr: fp + tn ? fp / (fp + tn) : null,
    fnr: tp + fn ? fn / (tp + fn) : null,
    precision: tp + fp ? tp / (tp + fp) : null,
  };
}

/** Threshold maximising Youden's J (TPR − FPR). In-sample, so optimistic. */
export function bestThreshold(scores, labels) {
  const cands = [...new Set(scores)].sort((a, b) => a - b);
  let best = { threshold: -Infinity, j: -Infinity };
  for (const t of [-Infinity, ...cands]) {
    const c = confusion(scores, labels, t);
    const j = (1 - (c.fnr ?? 1)) - (c.fpr ?? 0);
    if (j > best.j) best = { threshold: t, j };
  }
  return best;
}

/** Seeded PRNG so bootstrap intervals are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap 95% interval for AUROC, stratified by label. */
export function aurocInterval(scores, labels, { resamples = 1000, seed = 42 } = {}) {
  const pos = []; const neg = [];
  scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
  if (pos.length < 2 || neg.length < 2) return null;
  const rnd = mulberry32(seed);
  const vals = [];
  for (let r = 0; r < resamples; r++) {
    const s = []; const y = [];
    for (let i = 0; i < pos.length; i++) { s.push(pos[Math.floor(rnd() * pos.length)]); y.push(1); }
    for (let i = 0; i < neg.length; i++) { s.push(neg[Math.floor(rnd() * neg.length)]); y.push(0); }
    vals.push(auroc(s, y));
  }
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(0.025 * resamples)], vals[Math.min(resamples - 1, Math.floor(0.975 * resamples))]];
}

export function summarise(scores, labels) {
  const best = bestThreshold(scores, labels);
  return {
    n: scores.length,
    ai: labels.filter(Boolean).length,
    human: labels.filter((y) => !y).length,
    auroc: auroc(scores, labels),
    aurocCI: aurocInterval(scores, labels),
    at1: tprAtFpr(scores, labels, 0.01),
    at5: tprAtFpr(scores, labels, 0.05),
    best: { threshold: best.threshold, ...confusion(scores, labels, best.threshold) },
  };
}
