// Humanizer quality benchmark. Runs the real pipeline (real free providers)
// over the benchmark passages and reports measurable outcomes:
//   - required details preserved (numbers, names, quotations, citations, terms)
//   - spelling errors and filler removed
//   - stock phrases before → after, sentence-length variation, reading ease
//   - profile alignment before → after (profile runs)
//   - feedback rounds meeting their targets
//
//   node scripts/bench-humanizer.mjs [--json out.json] [--only id,id]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initEnv } from '../src/main/env.js';
import { createHumanizer } from '../src/main/humanizer/pipeline.js';
import { DEFAULT_ROLES } from '../src/main/ai/providers.js';
import { buildProfile, selectExemplars, alignment } from '../src/shared/profile/profile.js';
import { analyze } from '../src/shared/text/stylometry.js';
import { findIssues } from '../src/shared/text/issues.js';
import { PASSAGES, PROFILE_SAMPLES } from '../tests/bench/passages.mjs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

initEnv({ userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'folio-bench-')), syrixEnvPath: process.env.FOLIO_SYRIX_ENV || '' });

const store = new Map();
let n = 0;
const sessions = { get: (id) => store.get(id), put: (s) => { const x = { ...s, id: s.id || `s${++n}` }; store.set(x.id, x); return x; } };
const samples = PROFILE_SAMPLES.map((s, i) => ({ id: `b${i}`, ...s }));
const analysisP = buildProfile(samples);
const profile = { id: 'pbench', name: 'Relaxed first-person', analysis: analysisP, exemplars: selectExemplars(samples, analysisP, 3), rules: [], notes: '', summary: '' };
const profiles = { get: (id) => (id === profile.id ? profile : null) };
const humanizer = createHumanizer({ chainFor: (role) => DEFAULT_ROLES[role], sessions, profiles });

const leftovers = (text) => findIssues(text).filter((i) => ['error', 'filler', 'formulaic'].includes(i.type) && i.severity === 'warn');

async function run(passage, controls = {}, label = '') {
  const t0 = Date.now();
  const s = await humanizer.run(`r${Date.now()}`, { text: passage.text, controls }, () => {});
  const v = s.versions[s.versions.length - 1];
  const revised = v.paragraphs.map((p) => p.text).join('\n');
  const missing = (passage.must || []).filter((m) => !revised.includes(m));
  const errorsLeft = (passage.errors || []).filter((e) => revised.toLowerCase().includes(e));
  const left = leftovers(revised);
  const issues = v.paragraphs.flatMap((p) => p.issues || []).filter((i) => !i.resolved && !i.styleOnly);
  const out = {
    id: passage.id, label: label || passage.label, ms: Date.now() - t0, models: v.models,
    paragraphsKept: v.paragraphs.length === s.originalParagraphs.length,
    detailsKept: `${(passage.must || []).length - missing.length}/${(passage.must || []).length}`, missing,
    errorsLeft, leftovers: left.map((i) => i.text),
    formulaic: [v.metrics.before.formulaicCount, v.metrics.after.formulaicCount],
    variation: [v.metrics.before.sentenceLengthVariation, v.metrics.after.sentenceLengthVariation],
    readingEase: [Math.round(v.metrics.before.readingEase), Math.round(v.metrics.after.readingEase)],
    words: [v.metrics.before.wordCount, v.metrics.after.wordCount],
    meaningFlags: issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity}: ${i.message}`),
    repaired: v.paragraphs.filter((p) => p.repaired).length,
    alignment: v.metrics.profileAlignment ? [v.metrics.profileAlignment.before.score, v.metrics.profileAlignment.after.score] : null,
    error: v.error?.message || null,
    revised,
    session: s,
  };
  return out;
}

function report(r) {
  const arrow = ([a, b]) => `${a} → ${b}`;
  console.log(`\n■ ${r.label} (${(r.ms / 1000).toFixed(1)} s, ${r.models.join(', ')})`);
  console.log(`  details kept ${r.detailsKept}${r.missing.length ? `  MISSING: ${r.missing.join(' | ')}` : ''} · paragraphs kept: ${r.paragraphsKept}`);
  console.log(`  stock phrases ${arrow(r.formulaic)} · variation ${arrow(r.variation)} · reading ease ${arrow(r.readingEase)} · words ${arrow(r.words)}${r.alignment ? ` · profile match ${arrow(r.alignment)}` : ''}`);
  if (r.errorsLeft.length || r.leftovers.length) console.log(`  LEFT IN TEXT: ${[...r.errorsLeft, ...r.leftovers].join(', ')}`);
  if (r.meaningFlags.length) console.log(`  flags: ${r.meaningFlags.join(' | ')}`);
  if (r.error) console.log(`  ERROR: ${r.error}`);
  console.log(`  ---\n  ${r.revised.replace(/\n/g, '\n  ')}`);
}

const results = [];
for (const p of PASSAGES.filter((x) => !only || only.includes(x.id))) {
  const r = await run(p);
  report(r);
  results.push(r);
}

// Profile runs.
for (const id of ['reflective', 'academic'].filter((x) => !only || only.includes(x))) {
  const p = PASSAGES.find((x) => x.id === id);
  const r = await run(p, { profileId: profile.id, profileStrength: 'strong', strength: 3 }, `${p.label} — with profile "${profile.name}"`);
  report(r);
  results.push(r);
}

// Feedback round: less formal + more concise on the email.
if (!only || only.includes('email')) {
  const base = results.find((x) => x.id === 'email');
  const s = await humanizer.run('fb', { sessionId: base.session.id, controls: base.session.versions[0].controls, feedback: { chipIds: ['less-formal', 'concise'] } }, () => {});
  const [v1, v2] = s.versions;
  console.log(`\n■ Feedback round on email (less formal + more concise): words ${v1.metrics.after.wordCount} → ${v2.metrics.after.wordCount}, formality ${v1.metrics.after.formality} → ${v2.metrics.after.formality}, targets ${JSON.stringify(v2.targetResults)}`);
  console.log(`  ${v2.paragraphs.map((x) => x.text).join('\n  ')}`);
  results.push({ id: 'email-feedback', words: [v1.metrics.after.wordCount, v2.metrics.after.wordCount], formality: [v1.metrics.after.formality, v2.metrics.after.formality], targets: v2.targetResults });
}

const profileFeatures = analyze(PROFILE_SAMPLES.map((s) => s.text).join('\n\n'));
console.log(`\nProfile check: samples align with their own profile at ${alignment(profileFeatures, analysisP).score}/100 (sanity check).`);

const summary = results.filter((r) => r.detailsKept).map((r) => ({ id: r.id, label: r.label, detailsKept: r.detailsKept, errorsLeft: r.errorsLeft.length + r.leftovers.length, formulaic: r.formulaic, alignment: r.alignment, flags: r.meaningFlags.length }));
console.table(summary);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results.map(({ session, ...x }) => x), null, 2));
