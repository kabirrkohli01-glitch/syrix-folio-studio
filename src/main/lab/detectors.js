// Local, open detectors used for evaluation. All run on this machine with
// small open models (onnx-community/gpt2-ONNX and distilgpt2-ONNX, quantised),
// downloaded once from Hugging Face. They implement published methods so the
// lab measures documented approaches rather than opaque services:
//
//   perplexity  Mean token log-perplexity under GPT-2. Model-written text
//               tends to be more predictable (Mitchell et al. 2023 use this as
//               the standard zero-shot baseline).
//   gltr-top10  Share of tokens that are in GPT-2's top-10 predictions
//               (Gehrmann, Strobelt & Rush 2019, GLTR).
//   binoculars  log-perplexity under GPT-2 divided by the cross-perplexity
//               between DistilGPT-2 and GPT-2 (Hans et al. 2024). The paper uses
//               Falcon-7B models; these small proxies are far weaker.
//
// Every score is oriented so that higher = "more likely AI-generated".

export const DETECTORS = [
  { id: 'perplexity', name: 'Perplexity (GPT-2)', method: 'Mean token log-perplexity under GPT-2, negated.', source: 'https://arxiv.org/abs/2301.11305', sourceLabel: 'Mitchell et al. 2023 (baseline)' },
  { id: 'gltr', name: 'GLTR top-10 rank', method: 'Share of tokens ranked in GPT-2’s top 10 predictions.', source: 'https://aclanthology.org/P19-3019/', sourceLabel: 'Gehrmann et al. 2019' },
  { id: 'binoculars', name: 'Binoculars (small proxy)', method: 'GPT-2 log-perplexity ÷ DistilGPT-2→GPT-2 cross-perplexity, negated.', source: 'https://arxiv.org/abs/2401.12070', sourceLabel: 'Hans et al. 2024' },
];

export const MODEL_IDS = { observer: 'onnx-community/gpt2-ONNX', performer: 'onnx-community/distilgpt2-ONNX' };
const MAX_TOKENS = 512;

let loaded = null;

export async function loadDetectors(cacheDir, onProgress) {
  if (loaded) return loaded;
  const tf = await import('@huggingface/transformers');
  tf.env.cacheDir = cacheDir;
  tf.env.allowLocalModels = false;
  const progress = (p) => {
    if (p.status === 'progress' && p.total) onProgress?.({ file: p.file, loaded: p.loaded, total: p.total });
  };
  const tokenizer = await tf.AutoTokenizer.from_pretrained(MODEL_IDS.observer, { progress_callback: progress });
  const observer = await tf.AutoModelForCausalLM.from_pretrained(MODEL_IDS.observer, { dtype: 'q8', progress_callback: progress });
  const performer = await tf.AutoModelForCausalLM.from_pretrained(MODEL_IDS.performer, { dtype: 'q8', progress_callback: progress });
  loaded = { tokenizer, observer, performer };
  return loaded;
}

/** Score one text with all detectors from a single pair of forward passes. */
export async function scoreText(text) {
  if (!loaded) throw new Error('Detector models are not loaded.');
  const { tokenizer, observer, performer } = loaded;
  const enc = tokenizer(String(text), { truncation: true, max_length: MAX_TOKENS });
  const ids = Array.from(enc.input_ids.data, Number);
  const L = ids.length;
  if (L < 16) return null;
  const [o1, o2] = await Promise.all([observer(enc), performer(enc)]);
  const V = o1.logits.dims[2];
  const l1 = o1.logits.data;
  const l2 = o2.logits.data;

  let nll = 0; let xent = 0; let top10 = 0;
  for (let t = 0; t < L - 1; t++) {
    const off = t * V;
    const target = ids[t + 1];
    let max1 = -Infinity; let max2 = -Infinity;
    for (let j = 0; j < V; j++) { if (l1[off + j] > max1) max1 = l1[off + j]; if (l2[off + j] > max2) max2 = l2[off + j]; }
    let sum1 = 0; let sum2 = 0;
    for (let j = 0; j < V; j++) { sum1 += Math.exp(l1[off + j] - max1); sum2 += Math.exp(l2[off + j] - max2); }
    const lse1 = max1 + Math.log(sum1);
    const targetLogit = l1[off + target];
    nll += lse1 - targetLogit;
    // Cross-entropy of the performer's distribution against the observer's log-probs.
    let cross = 0;
    let rank = 0;
    for (let j = 0; j < V; j++) {
      const p2 = Math.exp(l2[off + j] - max2) / sum2;
      cross += p2 * (lse1 - l1[off + j]);
      if (l1[off + j] > targetLogit) rank++;
    }
    xent += cross;
    if (rank < 10) top10++;
  }
  const n = L - 1;
  const logPpl = nll / n;
  const xPpl = xent / n;
  return {
    tokens: L,
    truncated: L >= MAX_TOKENS,
    logPerplexity: logPpl,
    crossPerplexity: xPpl,
    scores: {
      perplexity: -logPpl,
      gltr: top10 / n,
      binoculars: -(logPpl / xPpl),
    },
  };
}
