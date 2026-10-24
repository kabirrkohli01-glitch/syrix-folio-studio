// Detector evaluation lab.
//
// Corpus (every sample carries its provenance):
//   human — lead sections of English and Simple English Wikipedia articles,
//           taken from the revision in force on 1 June 2019, before public
//           large-language-model chat tools existed (ChatGPT launched
//           30 November 2022). Licensed CC BY-SA; the permanent revision URL
//           is recorded. Writers can also add their own labelled samples.
//   ai    — generated for the same topics by the configured free model, with
//           the model, prompt, temperature and time recorded.
//
// Evaluation runs the local detectors on every sample and reports AUROC with
// a bootstrap interval, detection rate at fixed false-positive rates, and
// confusion matrices, overall and per text type. Results are saved as
// immutable runs with their conditions.

import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJsonAtomic, newId, ensureDir } from '../store/fsstore.js';
import { chatChain, describeError } from '../ai/providers.js';
import { countWords } from '../../shared/text/tokenize.js';
import { summarise } from '../../shared/lab/metrics.js';
import { DETECTORS, MODEL_IDS, loadDetectors, scoreText } from './detectors.js';

export const TOPICS = [
  'Photosynthesis', 'Volcano', 'Roman Empire', 'Jazz', 'Penicillin', 'Great Barrier Reef',
  'Printing press', 'Black hole', 'Honey bee', 'Industrial Revolution', 'Chess', 'Tea',
  'Antarctica', 'Vaccine', 'Football', 'Renaissance', 'Coral reef', 'Internet', 'Tiger',
  'Pyramid', 'Electricity', 'Climate', 'Bicycle', 'Shakespeare', 'Rainforest',
];

const SNAPSHOT = '2019-06-01T00:00:00Z';
const UA = 'SYRIX-Folio/1.0 (detector evaluation; contact via app)';

const TYPES = {
  encyclopedic: { label: 'Encyclopedic (English Wikipedia)', host: 'en.wikipedia.org', prompt: (t) => `Write the opening section of an encyclopedia article about "${t}" in about 200 words. Neutral encyclopedic register. Plain prose paragraphs only: no title, headings, lists or markdown.` },
  simple: { label: 'Plain English (Simple English Wikipedia)', host: 'simple.wikipedia.org', prompt: (t) => `Write the opening section of a Simple English Wikipedia article about "${t}" in about 150 words: short sentences and basic, common words. Plain prose only: no title, headings, lists or markdown.` },
};

// Typography is normalised for both classes before scoring so a detector
// cannot separate them on character choice (models often emit non-breaking
// hyphens and curly quotes that the human sources do not).
export function normaliseForScoring(text) {
  return String(text)
    .replace(/[‐‑‒–]/g, '-').replace(/—/g, ' - ')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/ /g, ' ').replace(/[ 	]+/g, ' ').trim();
}

function hash(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16); }

function stripHtml(html) {
  return html
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\[\d+\]|\[citation needed\]|\[note \d+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trim to at most `max` words, ending on a sentence boundary. */
function trimWords(text, max) {
  const ws = text.split(/\s+/);
  if (ws.length <= max) return text;
  const cut = ws.slice(0, max).join(' ');
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'));
  return end > cut.length * 0.5 ? cut.slice(0, end + 1) : cut;
}

async function wikiLead(host, title, signal) {
  const q = `https://${host}/w/api.php?action=query&format=json&formatversion=2&prop=revisions&rvprop=ids|timestamp&rvlimit=1&rvdir=older&rvstart=${encodeURIComponent(SNAPSHOT)}&redirects=1&titles=${encodeURIComponent(title)}`;
  const r = await fetch(q, { headers: { 'User-Agent': UA }, signal });
  const j = await r.json();
  const page = j.query?.pages?.[0];
  const rev = page?.revisions?.[0];
  if (!rev) throw new Error(`No 2019 revision of "${title}" on ${host}`);
  const p = await fetch(`https://${host}/w/api.php?action=parse&format=json&formatversion=2&prop=text&disablelimitreport=1&oldid=${rev.revid}`, { headers: { 'User-Agent': UA }, signal });
  const pj = await p.json();
  const html = pj.parse?.text || '';
  const lead = html.split(/<h2[\s>]/)[0];
  const paras = [...lead.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => stripHtml(m[1])).filter((x) => countWords(x) >= 12);
  let text = '';
  for (const para of paras) { text = text ? `${text}\n\n${para}` : para; if (countWords(text) >= 140) break; }
  text = trimWords(text, 260);
  if (countWords(text) < 60) throw new Error(`Lead of "${title}" on ${host} is too short`);
  return { text, revid: rev.revid, timestamp: rev.timestamp, url: `https://${host}/w/index.php?oldid=${rev.revid}`, pageTitle: page.title };
}

export function createLab({ root, chainFor }) {
  const dir = ensureDir(path.join(root, 'lab'));
  const corpusFile = path.join(dir, 'corpus.json');
  const runsFile = path.join(dir, 'runs.json');
  const scoreCacheFile = path.join(dir, 'score-cache.json');
  const modelDir = path.join(root, 'models');
  let controller = null;

  const corpus = () => readJson(corpusFile, { samples: [], builds: [] });
  const runs = () => readJson(runsFile, { runs: [] });

  return {
    state() {
      const c = corpus();
      const counts = {};
      for (const s of c.samples) {
        const k = `${s.textType}:${s.label}`;
        counts[k] = (counts[k] || 0) + 1;
      }
      return {
        detectors: DETECTORS,
        models: MODEL_IDS,
        types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.label])),
        samples: c.samples.map(({ text, ...rest }) => ({ ...rest, preview: text.slice(0, 220) })),
        builds: c.builds,
        counts,
        runs: runs().runs.map(({ sampleScores, ...rest }) => rest),
        modelsDownloaded: Boolean(readJson(path.join(dir, 'models-ready.json'))),
      };
    },

    addSamples(samples) {
      const c = corpus();
      let added = 0;
      for (const s of samples) {
        const text = String(s.text || '').trim();
        if (countWords(text) < 40) continue;
        if (!['human', 'ai'].includes(s.label)) continue;
        if (c.samples.some((x) => x.hash === hash(text))) continue;
        c.samples.push({
          id: newId('x'), label: s.label, textType: s.textType || 'own', text, hash: hash(text), words: countWords(text),
          provenance: { source: 'Added by the writer', note: String(s.note || '').slice(0, 400), addedAt: new Date().toISOString() },
        });
        added++;
      }
      writeJsonAtomic(corpusFile, c);
      return { added };
    },

    removeSample(id) {
      const c = corpus();
      c.samples = c.samples.filter((s) => s.id !== id);
      writeJsonAtomic(corpusFile, c);
    },

    getRun(id) { return runs().runs.find((r) => r.id === id) || null; },

    removeRun(id) {
      const r = runs();
      r.runs = r.runs.filter((x) => x.id !== id);
      writeJsonAtomic(runsFile, r);
    },

    cancel() { controller?.abort(); },

    /** Build or extend the reference corpus. */
    async buildCorpus({ topics = TOPICS.slice(0, 12), types = ['encyclopedic', 'simple'], generate = true }, emit) {
      controller = new AbortController();
      const signal = controller.signal;
      const c = corpus();
      const build = { id: newId('b'), startedAt: new Date().toISOString(), topics, types, errors: [], added: 0, models: [] };
      const total = topics.length * types.length * (generate ? 2 : 1);
      let step = 0;
      const tick = (detail) => emit({ type: 'progress', phase: 'corpus', detail, progress: ++step / total });
      try {
        for (const type of types) {
          const T = TYPES[type];
          for (const topic of topics) {
            if (signal.aborted) throw Object.assign(new Error('Cancelled'), { kind: 'aborted' });
            const hasHuman = c.samples.some((s) => s.label === 'human' && s.textType === type && s.topic === topic);
            if (!hasHuman) {
              try {
                const w = await wikiLead(T.host, topic, signal);
                c.samples.push({
                  id: newId('x'), label: 'human', textType: type, topic, text: w.text, hash: hash(w.text), words: countWords(w.text),
                  provenance: { source: T.host === 'en.wikipedia.org' ? 'English Wikipedia' : 'Simple English Wikipedia', url: w.url, revisionTimestamp: w.timestamp, license: 'CC BY-SA', retrievedAt: new Date().toISOString(), note: 'Revision in force on 1 June 2019, before public LLM chat tools.' },
                });
                build.added++;
              } catch (e) { if (signal.aborted) throw e; build.errors.push(`${T.host} · ${topic}: ${e.message}`); }
            }
            tick(`${T.label}: ${topic} (human)`);
            if (!generate) continue;
            const hasAi = c.samples.some((s) => s.label === 'ai' && s.textType === type && s.topic === topic);
            if (!hasAi) {
              const prompt = T.prompt(topic);
              try {
                const out = await chatChain(chainFor('rewrite'), {
                  messages: [{ role: 'user', content: prompt }], temperature: 0.7, maxTokens: 1400, reasoningEffort: 'low', signal,
                });
                const text = trimWords(out.text.replace(/^#+.*\n/gm, '').replace(/\*\*/g, '').trim(), 260);
                c.samples.push({
                  id: newId('x'), label: 'ai', textType: type, topic, text, hash: hash(text), words: countWords(text),
                  provenance: { source: 'Generated for this evaluation', provider: out.provider, model: out.model, prompt, temperature: 0.7, generatedAt: new Date().toISOString() },
                });
                if (!build.models.includes(`${out.provider}:${out.model}`)) build.models.push(`${out.provider}:${out.model}`);
                build.added++;
              } catch (e) { if (signal.aborted || e.kind === 'aborted') throw e; build.errors.push(`Generation · ${topic}: ${describeError(e)}`); }
            }
            tick(`${T.label}: ${topic} (AI)`);
            writeJsonAtomic(corpusFile, c);
          }
        }
      } finally {
        build.finishedAt = new Date().toISOString();
        c.builds = [...(c.builds || []), build].slice(-20);
        writeJsonAtomic(corpusFile, c);
        controller = null;
      }
      return build;
    },

    /** Score every sample and compute metrics. */
    async runEvaluation({ note = '' }, emit) {
      controller = new AbortController();
      const signal = controller.signal;
      const c = corpus();
      if (c.samples.filter((s) => s.label === 'human').length < 3 || c.samples.filter((s) => s.label === 'ai').length < 3) {
        throw new Error('The corpus needs at least three human and three AI samples. Build the reference corpus or add samples first.');
      }
      try {
        emit({ type: 'progress', phase: 'models', detail: 'Loading detector models (downloaded once, about 520 MB)', progress: 0 });
        await loadDetectors(path.join(modelDir), (p) => emit({ type: 'progress', phase: 'models', detail: `Downloading ${p.file}`, progress: p.loaded / p.total }));
        writeJsonAtomic(path.join(dir, 'models-ready.json'), { at: new Date().toISOString(), models: MODEL_IDS });

        const cache = readJson(scoreCacheFile, {});
        const sampleScores = [];
        for (let i = 0; i < c.samples.length; i++) {
          if (signal.aborted) throw Object.assign(new Error('Cancelled'), { kind: 'aborted' });
          const s = c.samples[i];
          emit({ type: 'progress', phase: 'scoring', detail: `Scoring sample ${i + 1} of ${c.samples.length}`, progress: i / c.samples.length });
          const key = hash(normaliseForScoring(s.text));
          let r = cache[key];
          if (!r) {
            r = await scoreText(normaliseForScoring(s.text));
            if (r) cache[key] = r;
            await new Promise((res) => setImmediate(res));
          }
          if (r) sampleScores.push({ id: s.id, label: s.label, textType: s.textType, topic: s.topic || null, words: s.words, tokens: r.tokens, scores: r.scores, logPerplexity: r.logPerplexity });
        }
        writeJsonAtomic(scoreCacheFile, cache);

        const evalSet = (rows) => Object.fromEntries(DETECTORS.map((d) => [d.id, summarise(rows.map((x) => x.scores[d.id]), rows.map((x) => (x.label === 'ai' ? 1 : 0)))]));
        const byType = {};
        for (const t of [...new Set(sampleScores.map((x) => x.textType))]) {
          const rows = sampleScores.filter((x) => x.textType === t);
          if (rows.some((x) => x.label === 'ai') && rows.some((x) => x.label === 'human')) byType[t] = evalSet(rows);
        }
        const run = {
          id: newId('r'),
          createdAt: new Date().toISOString(),
          note: String(note).slice(0, 300),
          conditions: {
            detectors: DETECTORS.map(({ id, name, method, source }) => ({ id, name, method, source })),
            models: MODEL_IDS,
            quantisation: '8-bit ONNX (model_quantized.onnx)',
            maxTokens: 512,
            preprocessing: 'Typography normalised for both classes (hyphens, dashes, quotes, spaces).',
            samples: sampleScores.length,
            human: sampleScores.filter((x) => x.label === 'human').length,
            ai: sampleScores.filter((x) => x.label === 'ai').length,
            textTypes: Object.fromEntries([...new Set(sampleScores.map((x) => x.textType))].map((t) => [t, sampleScores.filter((x) => x.textType === t).length])),
            generators: [...new Set(c.samples.filter((s) => s.label === 'ai').map((s) => s.provenance?.model).filter(Boolean))],
            thresholdNote: 'Thresholds are chosen on the same samples they are evaluated on, so detection rates are optimistic.',
          },
          overall: evalSet(sampleScores),
          byType,
          sampleScores,
        };
        const all = runs();
        all.runs = [run, ...all.runs].slice(0, 30);
        writeJsonAtomic(runsFile, all);
        emit({ type: 'progress', phase: 'done', detail: 'Evaluation complete', progress: 1 });
        const { sampleScores: _omit, ...summary } = run;
        return summary;
      } finally {
        controller = null;
      }
    },
  };
}
