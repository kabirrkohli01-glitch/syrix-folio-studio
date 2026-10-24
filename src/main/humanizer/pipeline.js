// The humanizer pipeline.
//
//   analyse → chunk → rewrite → (one combined retry) → validate → batched repair
//          → meaning check (runs alongside the next section) → batched correction → score
//
// Round modes:
//   fresh     — revise the original (first round; "keep more of my wording")
//   refine    — revise the previous version according to the writer's notes,
//               with the original supplied as the reference for meaning
//   alternate — "regenerate": a different take on the original
//
// The original is the source of truth for meaning in every mode: protected
// details are extracted from it and every result is validated against it.
//
// Free-tier allowances are counted in tokens per minute per model, so the
// pipeline keeps the number of calls low: at most one retry per section
// (covering every missed target at once), one repair call per section for all
// paragraphs that need fixing, and the meaning check on a second model with its
// own allowance, started as soon as a section is ready.

import { splitParagraphs, countWords } from '../../shared/text/tokenize.js';
import { analyze } from '../../shared/text/stylometry.js';
import { findIssues, summariseIssues } from '../../shared/text/issues.js';
import { extractProtected, protectedList } from '../../shared/text/protect.js';
import { validateRevision, cleanModelText } from '../../shared/humanizer/validate.js';
import { applyFeedback, DEFAULT_CONTROLS } from '../../shared/humanizer/controls.js';
import { feedbackTargets, qualityTargets, checkTargets } from '../../shared/humanizer/targets.js';
import { alignment, voiceAlignment } from '../../shared/profile/profile.js';
import { filterAuditIssues } from '../../shared/humanizer/auditfilter.js';
import { similarity } from '../../shared/humanizer/diff.js';
import {
  REWRITE_SYSTEM, buildRewritePrompt, parseParagraphs, REPAIR_BATCH_SYSTEM, buildBatchRepairPrompt,
  AUDIT_SYSTEM, buildAuditPrompt, parseJsonObject,
} from '../../shared/humanizer/prompt.js';
import { chatChain, AIError, describeError } from '../ai/providers.js';

const CHUNK_WORDS = 450;
const AUDIT_WORDS = 1400;
const REPAIR_BATCH = 6;
const TEMPERATURE = { 1: 0.45, 2: 0.6, 3: 0.72, 4: 0.82 };
const REPAIRABLE_AUDIT = new Set(['audit-removed', 'audit-added', 'audit-altered', 'audit-quote']);
const POLISH_TYPES = new Set(['formulaic', 'error', 'filler', 'stacked-transition', 'repeated-opener']);

/** Short lines without terminal punctuation are treated as headings and left as written. */
export function isHeadingLike(p) {
  const wc = countWords(p);
  return wc > 0 && wc <= 10 && !/[.!?:;]["'”’)]?$/.test(p.trim());
}

export function chunkParagraphs(paragraphs, indices) {
  const chunks = [];
  let cur = [];
  let words = 0;
  for (const i of indices) {
    const wc = countWords(paragraphs[i]);
    if (cur.length && words + wc > CHUNK_WORDS) { chunks.push(cur); cur = []; words = 0; }
    cur.push(i);
    words += wc;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Writing problems still present in a revised paragraph that the controls ask to remove. */
export function leftoverProblems(text, controls, profile) {
  const used = new Set((profile?.analysis?.voiceMarkers?.used || []).map((x) => x.marker));
  return findIssues(text).filter((x) => x.severity === 'warn' && POLISH_TYPES.has(x.type)
    && (x.type !== 'error' || controls.fixErrors !== false)
    && (x.type !== 'filler' || (controls.removeFillers !== false && !used.has(x.text.toLowerCase()))));
}

function issueKey(i) { return `${i.type}:${(i.items || []).join('|')}:${i.message}`; }

export function createHumanizer({ chainFor, sessions, profiles }) {
  const running = new Map(); // runId → AbortController

  async function call(ctx, role, req) {
    ctx.calls[role] = (ctx.calls[role] || 0) + 1;
    const out = await chatChain(ctx.chain(role), { ...req, signal: ctx.signal, onStatus: (s) => ctx.emit({ type: 'status', ...s }) });
    ctx.models.add(`${out.provider}:${out.model}`);
    return out;
  }

  async function rewriteChunk(ctx, chunk, { attempt = 0, temperatureBoost = 0, targets = [], missed = [] } = {}) {
    const { originals, base, previous, mode, controls, analysis, profile, glossary, notes } = ctx;
    const paras = chunk.map((i) => base[i]);
    const joined = paras.join('\n');
    const prot = protectedList(extractProtected(chunk.map((i) => originals[i]).join('\n'), { glossary }));
    const issues = findIssues(joined).filter((i) => i.severity === 'warn' || i.type === 'uniform-rhythm');
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const targetLines = targets.map((t) => t.text);
    for (const m of missed) targetLines.push(`The last attempt measured ${m.measured}, which missed: ${m.text}`);
    const prompt = buildRewritePrompt({
      paragraphs: paras,
      reference: mode === 'refine' ? chunk.map((i) => originals[i]) : null,
      previous: previous && mode !== 'refine' ? chunk.map((i) => previous[i]) : null,
      mode, controls, analysis, profile, protectedItems: prot, issues, feedback: notes, targets: targetLines,
      contextBefore: first > 0 ? base[first - 1] : '',
      contextAfter: last < base.length - 1 ? base[last + 1] : '',
      attempt,
    });
    const out = await call(ctx, 'rewrite', {
      messages: [{ role: 'system', content: REWRITE_SYSTEM }, { role: 'user', content: prompt }],
      temperature: Math.min(1, (TEMPERATURE[controls.strength] || 0.6) + temperatureBoost),
      maxTokens: Math.ceil(countWords(joined) * 2.2) + 1400,
      reasoningEffort: 'medium',
    });
    const parsed = parseParagraphs(out.text, paras.length);
    if (!parsed) return null;
    return parsed.map((p, k) => cleanModelText(p, originals[chunk[k]]));
  }

  /** Score a candidate for a chunk: targets met, and whether it actually moved. */
  function assess(ctx, chunk, result, targets) {
    const text = result.join('\n');
    const t = checkTargets(targets, text);
    let stale = false;
    const origText = chunk.map((i) => ctx.originals[i]).join('\n');
    if (ctx.mode === 'refine') stale = similarity(chunk.map((i) => ctx.base[i]).join('\n'), text) > 0.95;
    else if (ctx.mode === 'alternate') stale = similarity(chunk.map((i) => ctx.previous[i]).join('\n'), text) > 0.9;
    else if (ctx.expect === 'closer' && ctx.previous) {
      stale = similarity(origText, text) <= similarity(origText, chunk.map((i) => ctx.previous[i]).join('\n')) + 0.02;
    }
    return { score: t.passed * 2 + (stale ? 0 : 1), failed: t.failed, stale };
  }

  /** Repair several paragraphs in as few requests as possible. Returns Map(index → text). */
  async function repairBatch(ctx, items) {
    const fixed = new Map();
    for (let s = 0; s < items.length; s += REPAIR_BATCH) {
      const group = items.slice(s, s + REPAIR_BATCH);
      const words = group.reduce((n, it) => n + countWords(it.revised), 0);
      const out = await call(ctx, 'rewrite', {
        messages: [{ role: 'system', content: REPAIR_BATCH_SYSTEM }, {
          role: 'user',
          content: buildBatchRepairPrompt({
            items: group.map((it) => ({ original: ctx.originals[it.index], revised: it.revised, problems: it.problems })),
            controls: ctx.controls, analysis: ctx.analysis, profileActive: Boolean(ctx.profile?.analysis),
          }),
        }],
        temperature: 0.3,
        maxTokens: Math.ceil(words * 2.2) + 900,
        reasoningEffort: 'low',
      });
      const parsed = parseParagraphs(out.text, group.length);
      if (parsed) group.forEach((it, k) => fixed.set(it.index, cleanModelText(parsed[k], ctx.originals[it.index])));
    }
    return fixed;
  }

  async function audit(ctx, indices, texts) {
    const { originals } = ctx;
    const groups = [];
    let cur = []; let words = 0;
    for (const i of indices) {
      const wc = countWords(originals[i]) + countWords(texts[i]);
      if (cur.length && words + wc > AUDIT_WORDS) { groups.push(cur); cur = []; words = 0; }
      cur.push(i); words += wc;
    }
    if (cur.length) groups.push(cur);
    const found = [];
    for (const g of groups) {
      try {
        const out = await call(ctx, 'audit', {
          messages: [{ role: 'system', content: AUDIT_SYSTEM }, { role: 'user', content: buildAuditPrompt(g.map((i, k) => ({ index: k + 1, original: originals[i], revised: texts[i] }))) }],
          temperature: 0,
          maxTokens: 2500,
          json: true,
          reasoningEffort: 'medium',
        });
        const j = parseJsonObject(out.text);
        if (!j || !Array.isArray(j.issues)) { ctx.auditErrors.push('The meaning check returned an unreadable answer for part of the text.'); continue; }
        for (const it of j.issues) {
          const k = Number(it.paragraph) - 1;
          if (!(k >= 0 && k < g.length)) continue;
          found.push({
            paragraph: g[k],
            checkedText: texts[g[k]],
            type: `audit-${String(it.type || 'altered').toLowerCase()}`,
            severity: it.severity === 'high' ? 'error' : it.severity === 'low' ? 'info' : 'warn',
            message: String(it.explanation || 'Possible change in meaning').slice(0, 300),
            original: String(it.original || '').slice(0, 200),
            revised: String(it.revised || '').slice(0, 200),
            source: 'audit',
          });
        }
      } catch (e) {
        if (e.kind === 'aborted') throw e;
        ctx.auditErrors.push(describeError(e));
      }
    }
    return filterAuditIssues(found);
  }

  /**
   * Run one revision round.
   * req: { sessionId?, text?, title?, source?, controls, feedback?: { chipIds, text },
   *        regenerate?, scope?: number[], audit?, autoRepair? }
   */
  async function run(runId, req, emit) {
    const controller = new AbortController();
    running.set(runId, controller);
    const t0 = Date.now();
    const send = (e) => emit({ runId, ...e });
    try {
      let session = req.sessionId ? sessions.get(req.sessionId) : null;
      if (req.sessionId && !session) throw new AIError('This revision session no longer exists.', { kind: 'input' });
      if (!session) {
        const text = String(req.text || '').trim();
        if (!text) throw new AIError('There is no text to revise.', { kind: 'input' });
        const originals = splitParagraphs(text);
        session = sessions.put({
          title: req.title || text.slice(0, 70).replace(/\s+/g, ' '),
          source: req.source || null,
          original: originals.join('\n'),
          originalParagraphs: originals,
          analysis: analyze(originals.join('\n')),
          versions: [],
        });
        send({ type: 'session', sessionId: session.id });
      }
      const originals = session.originalParagraphs;
      const prevVersion = session.versions?.length ? session.versions[session.versions.length - 1] : null;
      const previous = prevVersion ? prevVersion.paragraphs.map((p) => p.text) : null;

      // Controls and notes for this round.
      let controls = { ...DEFAULT_CONTROLS, ...(req.controls || {}) };
      let notes = prevVersion ? [...(prevVersion.feedback || [])] : [];
      let expect = 'change';
      let matched = [];
      const hasFeedback = Boolean(req.feedback && (String(req.feedback.text || '').trim() || (req.feedback.chipIds || []).length));
      if (hasFeedback) {
        const fb = applyFeedback(controls, req.feedback);
        controls = fb.controls;
        expect = fb.expect;
        matched = fb.matched;
        notes = [...notes, ...fb.instructions].slice(-8);
      }
      const persistentNotes = notes;

      let mode = 'fresh';
      if (previous && hasFeedback) mode = expect === 'closer' ? 'fresh' : 'refine';
      else if (previous && (req.regenerate || (req.scope && req.scope.length))) mode = 'alternate';
      if (mode === 'alternate') notes = [...notes, 'Write a fresh alternative: phrase it noticeably differently from the previous version while following the same brief.'];

      const profileDoc = controls.profileId ? profiles.get(controls.profileId) : null;
      const profile = profileDoc ? { ...profileDoc, exemplars: (profileDoc.exemplars || []).slice(0, controls.profileStrength === 'strong' ? 3 : 2) } : null;
      const analysis = session.analysis || analyze(session.original);
      const glossary = controls.keepTerminology ? (controls.glossary || []) : [];
      const voiceActive = Boolean(profile?.analysis) && controls.profileStrength !== 'subtle';
      const autoRepair = req.autoRepair !== false;

      const scope = Array.isArray(req.scope) && req.scope.length ? req.scope : null;
      const base = mode === 'refine' ? previous : originals;
      const targets = originals.map((p, i) => i).filter((i) => !isHeadingLike(originals[i]) && (!scope || scope.includes(i)));

      const ctx = {
        originals, base, previous, mode, expect, controls, analysis, profile, glossary, notes,
        emit: send,
        signal: controller.signal,
        chain: (role) => chainFor(role),
        models: new Set(),
        auditErrors: [],
        calls: {},
      };

      // Paragraphs outside the scope carry over from the previous version.
      const revised = originals.map((p, i) => (previous && !targets.includes(i) ? previous[i] : p));
      const status = originals.map((p, i) => (isHeadingLike(p) ? 'heading' : targets.includes(i) ? 'pending' : 'kept'));
      const pIssues = originals.map(() => []);
      const repaired = originals.map(() => false);
      const targetResults = [];
      const auditJobs = [];

      const chunks = chunkParagraphs(originals, targets);
      send({ type: 'stage', stage: 'analyse', detail: `${targets.length} paragraph${targets.length === 1 ? '' : 's'} in ${chunks.length} section${chunks.length === 1 ? '' : 's'}`, progress: 0.03 });

      let failure = null;
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const progressAt = (f) => 0.05 + 0.8 * ((ci + f) / chunks.length);
        const label = chunks.length > 1 ? `section ${ci + 1} of ${chunks.length}` : '';
        send({ type: 'stage', stage: 'rewrite', detail: label ? `Rewriting ${label}` : 'Rewriting', progress: progressAt(0) });
        try {
          const baseChunk = chunk.map((i) => base[i]).join('\n');
          const chunkTargets = [
            ...(mode === 'refine' ? feedbackTargets(matched, baseChunk) : []),
            ...(expect === 'closer' ? [] : qualityTargets(controls, baseChunk, { voiceActive })),
          ];
          let result = await rewriteChunk(ctx, chunk, { targets: chunkTargets });
          if (!result) result = await rewriteChunk(ctx, chunk, { attempt: 1, targets: chunkTargets });
          if (!result && chunk.length > 1) {
            // Fall back to one paragraph per request when the model will not keep the format.
            result = [];
            for (const i of chunk) {
              const single = await rewriteChunk(ctx, [i], { attempt: 1, targets: chunkTargets });
              result.push(single ? single[0] : null);
            }
          }
          if (!result || result.some((x) => !x)) throw new AIError('The model did not return the requested paragraphs.', { kind: 'format' });

          // One combined retry covering every miss: feedback targets, rhythm,
          // a round that did not move, and drift away from the writer's voice.
          const checkTargetsNeeded = chunkTargets.length || mode !== 'fresh' || (expect === 'closer' && previous);
          const score = (cand) => {
            const a = checkTargetsNeeded ? assess(ctx, chunk, cand, chunkTargets) : { score: 0, failed: [], stale: false };
            const v = voiceActive && countWords(baseChunk) >= 60 ? voiceAlignment(analyze(cand.join('\n')), profile.analysis) : null;
            return { a, v, total: a.score * 10 + (v ? v.score / 10 : 0) };
          };
          let current = score(result);
          const voiceBefore = voiceActive && countWords(baseChunk) >= 60 ? voiceAlignment(analyze(baseChunk), profile.analysis) : null;
          const missed = [...current.a.failed];
          if (current.a.stale) missed.push({ measured: 'almost no change from the version being revised', text: 'apply the notes so the text visibly changes' });
          if (current.v && voiceBefore && current.v.score < Math.min(90, voiceBefore.score + (controls.profileStrength === 'strong' ? 8 : 0))) {
            for (const d of [...current.v.dims].sort((x, y) => x.closeness - y.closeness).slice(0, 3)) {
              missed.push({ measured: `${d.label.toLowerCase()} ${d.text}`, text: `bring ${d.label.toLowerCase()} close to the writer's ${d.target}` });
            }
          }
          if (missed.length) {
            send({ type: 'stage', stage: 'rewrite', detail: label ? `Refining ${label}` : 'Refining the rewrite', progress: progressAt(0.5) });
            const retry = await rewriteChunk(ctx, chunk, { attempt: 1, temperatureBoost: 0.08, targets: chunkTargets, missed });
            if (retry) {
              const next = score(retry);
              const errs = (cand) => cand.reduce((n, t, k) => n + validateRevision(originals[chunk[k]], t, { glossary }).errorCount, 0);
              if (next.total > current.total && errs(retry) <= errs(result)) { result = retry; current = next; }
            }
          }
          if (checkTargetsNeeded) targetResults.push(...chunkTargets.map((t) => ({ id: t.id, met: !current.a.failed.some((f) => f.id === t.id) })));

          chunk.forEach((i, k) => { revised[i] = result[k]; status[i] = 'ok'; });

          // Validate every paragraph against the original; fix protected-detail
          // errors and surviving writing problems in one batched request.
          const checks = new Map(chunk.map((i) => [i, validateRevision(originals[i], revised[i], { glossary, concision: controls.concision })]));
          if (autoRepair) {
            const items = [];
            for (const i of chunk) {
              const v = checks.get(i);
              const left = leftoverProblems(revised[i], controls, profile);
              const problems = [
                ...v.issues.filter((x) => x.severity === 'error').map((x) => x.message),
                ...left.map((x) => `${x.message} — “${x.text}”${x.fix ? ` (write “${x.fix}”)` : ''}`),
              ];
              if (problems.length) items.push({ index: i, revised: revised[i], problems, errors: v.errorCount, leftovers: left.length });
            }
            if (items.length) {
              send({ type: 'stage', stage: 'repair', detail: `Fixing ${items.length} paragraph${items.length === 1 ? '' : 's'}${label ? ` in ${label}` : ''}`, progress: progressAt(0.8) });
              const fixed = await repairBatch(ctx, items);
              for (const it of items) {
                const t = fixed.get(it.index);
                if (!t) continue;
                const v2 = validateRevision(originals[it.index], t, { glossary, concision: controls.concision });
                const better = v2.errorCount < it.errors || (v2.errorCount === it.errors && leftoverProblems(t, controls, profile).length < it.leftovers);
                if (v2.errorCount <= it.errors && better) {
                  revised[it.index] = t;
                  checks.set(it.index, v2);
                  if (it.errors) repaired[it.index] = true;
                }
              }
            }
          }
          for (const i of chunk) {
            pIssues[i] = checks.get(i).issues.map((x) => ({ ...x, source: 'check' }));
            send({ type: 'paragraph', index: i, text: revised[i], issues: pIssues[i] });
          }

          // Meaning check for this section runs while the next one is rewritten.
          if (req.audit !== false) {
            const texts = Object.fromEntries(chunk.map((i) => [i, revised[i]]));
            auditJobs.push(audit(ctx, chunk, texts).catch((e) => {
              if (e.kind !== 'aborted') ctx.auditErrors.push(describeError(e));
              return [];
            }));
          }
        } catch (e) {
          if (e.kind === 'aborted') throw e;
          failure = e;
          for (const i of chunks.slice(ci).flat()) status[i] = 'failed';
          break;
        }
      }

      // Collect the meaning checks, then correct substantive findings together.
      if (auditJobs.length) {
        send({ type: 'stage', stage: 'audit', detail: 'Finishing the meaning check', progress: 0.88 });
        const results = await Promise.all(auditJobs);
        const toRepair = new Map();
        for (const it of results.flat()) {
          if (it.checkedText !== revised[it.paragraph]) continue;
          pIssues[it.paragraph].push(it);
          if (it.severity === 'error' || (it.severity === 'warn' && REPAIRABLE_AUDIT.has(it.type))) {
            toRepair.set(it.paragraph, [...(toRepair.get(it.paragraph) || []), it]);
          }
        }
        if (autoRepair && toRepair.size) {
          send({ type: 'stage', stage: 'repair', detail: `Correcting ${toRepair.size} meaning change${toRepair.size === 1 ? '' : 's'}`, progress: 0.94 });
          try {
            const items = [...toRepair].map(([i, list]) => ({ index: i, revised: revised[i], problems: list.map((x) => `${x.message}${x.original ? ` (original: “${x.original}”)` : ''}`) }));
            const fixed = await repairBatch(ctx, items);
            for (const [i, list] of toRepair) {
              const t = fixed.get(i);
              if (!t) continue;
              const v2 = validateRevision(originals[i], t, { glossary, concision: controls.concision });
              if (v2.errorCount === 0) {
                revised[i] = t;
                repaired[i] = true;
                pIssues[i] = [
                  ...v2.issues.map((x) => ({ ...x, source: 'check' })),
                  ...pIssues[i].filter((x) => x.source === 'audit' && !list.includes(x)),
                  ...list.map((x) => ({ ...x, severity: 'info', resolved: true, message: `Corrected automatically: ${x.message}` })),
                ];
                send({ type: 'paragraph', index: i, text: revised[i], issues: pIssues[i] });
              }
            }
          } catch (e) { if (e.kind === 'aborted') throw e; ctx.auditErrors.push(describeError(e)); }
        }
      }

      for (let i = 0; i < pIssues.length; i++) {
        const seen = new Set();
        pIssues[i] = pIssues[i].map(({ checkedText, ...x }) => x).filter((x) => { const k = issueKey(x); if (seen.has(k)) return false; seen.add(k); return true; });
      }
      const revisedText = revised.join('\n');
      const after = analyze(revisedText);
      const profileAlignment = profile && profile.analysis ? {
        before: alignment(analysis, profile.analysis),
        after: alignment(after, profile.analysis),
      } : null;

      const version = {
        n: (session.versions?.length || 0) + 1,
        createdAt: Date.now(),
        durationMs: Date.now() - t0,
        mode,
        controls,
        profileId: controls.profileId || null,
        profileName: profile ? profile.name : null,
        feedback: persistentNotes,
        newFeedback: hasFeedback ? [...(req.feedback.chipIds || []), String(req.feedback.text || '').trim()].filter(Boolean) : [],
        regenerate: mode === 'alternate',
        matchedFeedback: matched,
        targetResults,
        scope,
        calls: ctx.calls,
        paragraphs: revised.map((text, i) => ({
          text, status: status[i], repaired: repaired[i], issues: pIssues[i],
          similarity: Math.round(similarity(originals[i], text) * 100) / 100,
        })),
        metrics: {
          before: analysis,
          after,
          issuesBefore: summariseIssues(findIssues(session.original)),
          issuesAfter: summariseIssues(findIssues(revisedText)),
          profileAlignment,
        },
        models: [...ctx.models],
        auditErrors: ctx.auditErrors,
        error: failure ? { kind: failure.kind, message: describeError(failure), detail: failure.message } : null,
      };

      session = sessions.put({ ...session, versions: [...(session.versions || []), version] });
      send({ type: 'stage', stage: 'done', detail: failure ? 'Finished with errors' : 'Done', progress: 1 });
      return session;
    } finally {
      running.delete(runId);
    }
  }

  return {
    run,
    cancel(runId) { running.get(runId)?.abort(); },
    isRunning(runId) { return running.has(runId); },
  };
}
