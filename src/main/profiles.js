// Writing-profile service. Samples stay on this machine; the measured
// analysis is computed locally. Text is sent to an AI provider only when the
// writer explicitly asks for a voice summary, or when a rewrite uses the
// profile (its excerpts are then part of the rewrite request).

import { buildProfile, selectExemplars, describeProfile } from '../shared/profile/profile.js';
import { countWords } from '../shared/text/tokenize.js';
import { PROFILE_SYSTEM, buildProfilePrompt, parseJsonObject } from '../shared/humanizer/prompt.js';
import { chatChain } from './ai/providers.js';
import { newId } from './store/fsstore.js';

const MAX_SAMPLE_WORDS = 40000;

export function createProfiles({ collection, chainFor }) {
  function rebuild(p) {
    const samples = p.samples || [];
    const analysis = samples.length ? buildProfile(samples) : null;
    // Keep pinned excerpts that still exist; fill the rest automatically.
    const pinned = (p.exemplars || []).filter((e) => e.pinned && samples.some((s) => s.id === e.sampleId && s.text.includes(e.text)));
    const auto = analysis ? selectExemplars(samples, analysis, 3).filter((e) => !pinned.some((x) => x.text === e.text)) : [];
    const exemplars = [...pinned, ...auto].slice(0, Math.max(3, pinned.length));
    return { ...p, analysis, exemplars, traits: analysis ? describeProfile(analysis) : [] };
  }

  return {
    list() {
      return collection.list().map((p) => ({
        id: p.id, name: p.name, description: p.description || '', sampleCount: (p.samples || []).length,
        wordCount: p.analysis?.wordCount || 0, reliability: p.analysis?.reliability || null,
        updatedAt: p.updatedAt, hasSummary: Boolean(p.summary),
      }));
    },
    get(id) { return collection.get(id); },
    create({ name, description = '' }) {
      return collection.put(rebuild({ name: String(name || 'Untitled profile').slice(0, 80), description, samples: [], notes: '', rules: [], summary: '' }));
    },
    update(id, patch) {
      const p = collection.get(id);
      if (!p) throw new Error('Profile not found');
      const allowed = ['name', 'description', 'notes', 'rules', 'summary'];
      const next = { ...p };
      for (const k of allowed) if (k in patch) next[k] = patch[k];
      return collection.put(next);
    },
    remove(id) { collection.remove(id); },
    addSamples(id, samples) {
      const p = collection.get(id);
      if (!p) throw new Error('Profile not found');
      const added = [];
      const rejected = [];
      for (const s of samples) {
        const text = String(s.text || '').replace(/\r\n?/g, '\n').trim();
        const words = countWords(text);
        if (words < 30) { rejected.push({ title: s.title, reason: 'Too short (under 30 words).' }); continue; }
        if (words > MAX_SAMPLE_WORDS) { rejected.push({ title: s.title, reason: `Too long (over ${MAX_SAMPLE_WORDS.toLocaleString()} words). Split it into parts.` }); continue; }
        if ((p.samples || []).some((x) => x.text === text)) { rejected.push({ title: s.title, reason: 'Already in this profile.' }); continue; }
        added.push({ id: newId('s'), title: String(s.title || 'Sample').slice(0, 120), text, words, source: s.source || 'paste', addedAt: Date.now() });
      }
      const next = collection.put(rebuild({ ...p, samples: [...(p.samples || []), ...added] }));
      return { profile: next, added: added.length, rejected };
    },
    removeSample(id, sampleId) {
      const p = collection.get(id);
      if (!p) throw new Error('Profile not found');
      return collection.put(rebuild({ ...p, samples: (p.samples || []).filter((s) => s.id !== sampleId) }));
    },
    pinExemplar(id, text, pinned) {
      const p = collection.get(id);
      if (!p) throw new Error('Profile not found');
      const exemplars = (p.exemplars || []).map((e) => (e.text === text ? { ...e, pinned } : e));
      return collection.put(rebuild({ ...p, exemplars }));
    },
    rebuild(id) {
      const p = collection.get(id);
      return p ? collection.put(rebuild(p)) : null;
    },
    /** Ask a model to describe the voice. Sends up to ~2,500 words of samples. */
    async summarise(id, { signal } = {}) {
      const p = collection.get(id);
      if (!p || !(p.samples || []).length) throw new Error('Add writing samples first.');
      const excerpts = [];
      let budget = 2500;
      for (const e of p.exemplars || []) { if (budget <= 0) break; excerpts.push(e.text); budget -= countWords(e.text); }
      for (const s of p.samples) {
        if (budget <= 0) break;
        const cut = s.text.split(/\s+/).slice(0, Math.min(budget, 700)).join(' ');
        if (!excerpts.some((x) => cut.includes(x.slice(0, 80)))) { excerpts.push(cut); budget -= countWords(cut); }
      }
      const out = await chatChain(chainFor('profile'), {
        messages: [{ role: 'system', content: PROFILE_SYSTEM }, { role: 'user', content: buildProfilePrompt({ name: p.name, excerpts, traits: describeProfile(p.analysis) }) }],
        temperature: 0.3, maxTokens: 2000, json: true, reasoningEffort: 'medium', signal,
      });
      const j = parseJsonObject(out.text);
      if (!j || !j.summary) throw new Error('The model did not return a usable summary. Try again.');
      return collection.put({
        ...p,
        summary: String(j.summary).trim(),
        rules: Array.isArray(j.rules) ? j.rules.map((r) => String(r).trim()).filter(Boolean).slice(0, 12) : p.rules,
        summaryModel: `${out.provider}:${out.model}`,
        summaryAt: Date.now(),
      });
    },
  };
}
