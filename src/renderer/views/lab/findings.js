// Research notes for the detector lab. Every entry states what the source
// reports, with a link to it. Vendor statements are kept separate from
// independent research, and nothing here is a Folio measurement — those live
// in the Evaluation tab and come only from runs completed on this computer.

export const METHODS = [
  {
    name: 'Trained classifiers',
    text: 'A model is fine-tuned on labelled human and machine text and outputs a probability. Commercial detectors are generally believed to work this way, but their models and training data are not published, so their behaviour on new generators, domains and writers cannot be checked independently.',
  },
  {
    name: 'Zero-shot statistics',
    text: 'Score a text with a language model and measure how predictable it is: average log-perplexity, the rank of each actual word among the model’s predictions (GLTR), the curvature of log-probability under small rewrites (DetectGPT), or perplexity relative to a second model (Binoculars). No training data is needed, but results depend heavily on which scoring model is used and how close it is to the generator.',
  },
  {
    name: 'Watermarking',
    text: 'The generator itself biases its word choices toward a secret, pseudo-random subset of the vocabulary, which a statistical test can later detect. It only works if the model provider embeds the watermark, and heavy paraphrasing weakens it.',
  },
  {
    name: 'Retrieval',
    text: 'The provider stores what its model produced and checks a candidate text against that store for semantically similar generations. It needs the provider’s cooperation and a record of every output.',
  },
];

export const RESEARCH = [
  {
    title: 'GPT detectors are biased against non-native English writers',
    who: 'Liang, Yuksekgonul, Mao, Wu & Zou', where: 'Patterns, July 2023',
    finding: 'Seven widely used detectors were run on 91 TOEFL essays written by non-native English speakers and 88 essays by US eighth-graders. The detectors flagged the non-native essays as AI-generated at an average false-positive rate of 61.3%, while classifying the native essays accurately. The authors caution against using detectors in evaluative or educational settings.',
    tags: ['False positives', 'Fairness'],
    url: 'https://doi.org/10.1016/j.patter.2023.100779', alt: 'https://arxiv.org/abs/2304.02819',
  },
  {
    title: 'Testing of detection tools for AI-generated text',
    who: 'Weber-Wulff et al.', where: 'International Journal for Educational Integrity 19, 26 (2023)',
    finding: 'Twelve publicly available tools and two commercial systems used in education (Turnitin and PlagiarismCheck) were tested. The authors conclude the tools are “neither accurate nor reliable”, with a bias towards classifying text as human-written, and that machine translation and content obfuscation substantially worsen performance.',
    tags: ['Accuracy', 'Education'],
    url: 'https://doi.org/10.1007/s40979-023-00146-z',
  },
  {
    title: 'RAID: a shared benchmark for robust evaluation of machine-generated text detectors',
    who: 'Dugan et al.', where: 'ACL 2024',
    finding: 'Over 6 million generations across 11 models, 8 domains, 11 adversarial attacks and 4 decoding strategies. Testing 12 detectors, the authors found them easily fooled by adversarial attacks, changes in sampling, repetition penalties and unseen generators, and argue that claimed accuracies of 99% rarely survive shared, harder benchmarks.',
    tags: ['Robustness', 'Benchmark'],
    url: 'https://aclanthology.org/2024.acl-long.674', alt: 'https://arxiv.org/abs/2405.07940',
  },
  {
    title: 'Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense',
    who: 'Krishna, Song, Karpinska, Wieting & Iyyer', where: 'NeurIPS 2023',
    finding: 'A paraphrasing model reduced DetectGPT’s detection rate from 70.3% to 4.6% at a fixed 1% false-positive rate with little change in meaning, and also evaded watermarking, GPTZero and OpenAI’s classifier. A retrieval defence run by the model provider recovered 80–97% of paraphrased generations at a 1% false-positive rate.',
    tags: ['Robustness', 'Paraphrasing'],
    url: 'https://arxiv.org/abs/2303.13408',
  },
  {
    title: 'Can AI-generated text be reliably detected?',
    who: 'Sadasivan, Kumar, Balasubramanian, Wang & Feizi', where: 'TMLR (arXiv 2303.11156)',
    finding: 'Shows that recursive paraphrasing degrades watermarking, neural, zero-shot and retrieval detectors, and gives a theoretical bound: as the distributions of human and model text converge, even the best possible detector approaches random guessing.',
    tags: ['Theory', 'Robustness'],
    url: 'https://arxiv.org/abs/2303.11156',
  },
  {
    title: 'DetectGPT: zero-shot machine-generated text detection using probability curvature',
    who: 'Mitchell et al.', where: 'ICML 2023',
    finding: 'Model-written text tends to sit where small rewrites lower its log-probability. Using this curvature raised AUROC on fake news from a 20B-parameter model from 0.81 (best zero-shot baseline) to 0.95. Requires access to a scoring model similar to the generator.',
    tags: ['Method'],
    url: 'https://arxiv.org/abs/2301.11305',
  },
  {
    title: 'Spotting LLMs with Binoculars: zero-shot detection of machine-generated text',
    who: 'Hans et al.', where: 'ICML 2024',
    finding: 'Divides perplexity by the cross-perplexity between two related models. With 7-billion-parameter Falcon models it reports detecting over 90% of ChatGPT samples at a 0.01% false-positive rate on its benchmarks, without training data.',
    tags: ['Method'],
    url: 'https://arxiv.org/abs/2401.12070',
  },
  {
    title: 'GLTR: statistical detection and visualization of generated text',
    who: 'Gehrmann, Strobelt & Rush', where: 'ACL 2019 demonstrations',
    finding: 'Colours each word by its rank in a language model’s predictions. In a study, it raised untrained people’s accuracy at spotting generated text from 54% to 72% — an aid for human judgement rather than an automatic verdict.',
    tags: ['Method', 'Human judgement'],
    url: 'https://aclanthology.org/P19-3019/',
  },
  {
    title: 'A watermark for large language models',
    who: 'Kirchenbauer et al.', where: 'ICML 2023',
    finding: 'Proposes biasing generation toward a pseudo-random “green list” of tokens, detectable with a statistical test that yields interpretable p-values, without access to the model. Detection depends on the provider applying the watermark at generation time.',
    tags: ['Watermarking'],
    url: 'https://arxiv.org/abs/2301.10226',
  },
];

export const VENDOR = [
  {
    title: 'OpenAI AI Text Classifier — withdrawn',
    finding: 'At launch (January 2023) OpenAI reported that its classifier identified 26% of AI-written text as “likely AI-written” while labelling 9% of human-written text as AI, and that it was unreliable below 1,000 characters. It was withdrawn on 20 July 2023 “due to its low rate of accuracy”.',
    url: 'https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/', alt: 'https://searchengineland.com/openai-ai-classifier-no-longer-available-429912',
  },
  {
    title: 'Turnitin AI writing detection — published false-positive rates',
    finding: 'Turnitin states a document-level false-positive rate below 1% for documents with 20% or more AI writing, and a sentence-level rate of around 4%, noting that false positives cluster next to genuinely AI-written passages (blog post, 14 June 2023). Its reports state that the assessment “may not always be accurate” and “should not be used as the sole basis for adverse actions against a student”. These are the vendor’s own figures, not independent measurements.',
    url: 'https://www.turnitin.co.uk/blog/understanding-the-false-positive-rate-for-sentences-of-our-ai-writing-detection-capability',
  },
];

export const LIMITS = [
  ['Base rates matter', 'A 1% false-positive rate sounds small, but applied to 10,000 genuinely human essays it means about 100 people wrongly flagged. When most submissions are honest, a large share of flags can be wrong even for an accurate detector.'],
  ['Short texts are unreliable', 'Statistical signals need length. Vendors and researchers report much weaker results on short passages.'],
  ['Some writers are flagged more', 'Plain, predictable prose — common among non-native writers and in formulaic genres — scores as “machine-like” more often (Liang et al. 2023).'],
  ['Mixed authorship is ambiguous', 'Drafts edited with grammar tools, translated text, or human text revised by AI do not have a single correct label, and detectors treat them inconsistently.'],
  ['Scores are not proof', 'A detector score is a statistical estimate. Researchers and the vendors themselves advise treating it as a reason to look closer, never as proof of authorship.'],
  ['Results go stale', 'Each new model generation and decoding setting shifts the statistics, so an evaluation describes the detectors and generators at the time it was run.'],
];
