// Word lists used for style measurement and issue detection.

// Function words: the standard stylometric signal for authorial habit because
// they are used largely unconsciously and are mostly topic-independent
// (Stamatatos 2009; Burrows 2002). Used for the profile "voice fingerprint".
export const FUNCTION_WORDS = [
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'yet', 'nor', 'for', 'of', 'in', 'on',
  'at', 'to', 'from', 'by', 'with', 'about', 'as', 'into', 'like', 'through', 'after',
  'over', 'between', 'out', 'against', 'during', 'without', 'before', 'under', 'around',
  'among', 'that', 'which', 'who', 'whom', 'whose', 'this', 'these', 'those', 'it',
  'its', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'she', 'they', 'them',
  'their', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might',
  'must', 'not', 'no', 'all', 'some', 'any', 'more', 'most', 'very', 'just', 'also',
  'then', 'than', 'there', 'here', 'when', 'where', 'while', 'because', 'if', 'although',
  'though', 'however', 'what', 'how', 'why', 'one', 'only', 'even', 'really', 'quite',
];

// Discourse connectives. "Formal" ones read as stiff when stacked at the start
// of consecutive sentences, which is a common revision target.
export const TRANSITIONS = {
  formal: [
    'furthermore', 'moreover', 'additionally', 'consequently', 'nevertheless',
    'nonetheless', 'hence', 'thus', 'therefore', 'accordingly', 'subsequently',
    'conversely', 'notably', 'importantly', 'ultimately', 'overall', 'in addition',
    'in conclusion', 'to conclude', 'in summary', 'as a result', 'on the other hand',
    'in contrast', 'similarly', 'likewise', 'for instance', 'for example',
    'in particular', 'specifically', 'indeed', 'meanwhile', 'firstly', 'secondly',
    'thirdly', 'finally', 'lastly',
  ],
  plain: [
    'but', 'so', 'and', 'also', 'still', 'then', 'yet', 'plus', 'even so', 'after that',
    'because of this', 'that said', 'instead', 'on top of that', 'in the end', 'first',
    'second', 'next', 'now', 'though', 'anyway',
  ],
};

export const ALL_TRANSITIONS = [...TRANSITIONS.formal, ...TRANSITIONS.plain];

// Phrases that add length without adding meaning, or that have been used so
// often they read as filler. Each entry carries a category and a short note
// shown to the writer. Patterns are matched case-insensitively on word
// boundaries.
export const FORMULAIC = [
  // Padding
  { p: "it is important to note that", c: 'Padding', note: 'Usually deletable — state the point directly.' },
  { p: "it is worth noting that", c: 'Padding', note: 'Usually deletable — state the point directly.' },
  { p: "it's worth noting that", c: 'Padding', note: 'Usually deletable — state the point directly.' },
  { p: "it should be noted that", c: 'Padding', note: 'Usually deletable — state the point directly.' },
  { p: "it is essential to", c: 'Padding', note: 'Consider saying who must do what.' },
  { p: "it is crucial to", c: 'Padding', note: 'Consider saying who must do what.' },
  { p: "the fact that", c: 'Padding', note: 'Often replaceable with "that" or a rewrite.' },
  { p: "in order to", c: 'Padding', note: '"To" is usually enough.' },
  { p: "due to the fact that", c: 'Padding', note: '"Because" is shorter and clearer.' },
  { p: "at this point in time", c: 'Padding', note: '"Now" says the same thing.' },
  { p: "for all intents and purposes", c: 'Padding', note: 'Rarely adds meaning.' },
  { p: "when it comes to", c: 'Padding', note: 'Name the subject directly.' },
  { p: "in terms of", c: 'Padding', note: 'Often vague — be specific.' },
  { p: "a wide range of", c: 'Padding', note: 'Say what the range is, or cut.' },
  { p: "a variety of", c: 'Padding', note: 'Say what the variety is, or cut.' },
  { p: "plays a crucial role", c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: "plays a pivotal role", c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: "plays a vital role", c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: "plays a key role", c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: "plays an important role", c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: "a testament to", c: 'Cliché', note: 'Overused; show the evidence instead.' },
  { p: "in today's fast-paced world", c: 'Cliché', note: 'Generic opener — start with the real point.' },
  { p: "in today's digital age", c: 'Cliché', note: 'Generic opener — start with the real point.' },
  { p: "in today's digital landscape", c: 'Cliché', note: 'Generic opener — start with the real point.' },
  { p: "in today's world", c: 'Cliché', note: 'Generic opener — start with the real point.' },
  { p: "in today's", c: 'Cliché', note: 'Generic time-setting opener — start with the real point.' },
  { p: 'digital landscape', c: 'Cliché', note: 'Vague metaphor — name the actual setting.' },
  { p: 'digital age', c: 'Cliché', note: 'Vague framing — name the actual setting.' },
  { p: 'ever-evolving landscape', c: 'Cliché', note: 'Vague metaphor.' },
  { p: 'in this day and age', c: 'Cliché', note: '"Now" or "today" is enough, or cut it.' },
  { p: 'it goes without saying', c: 'Padding', note: 'If it goes without saying, cut it.' },
  { p: 'needless to say', c: 'Padding', note: 'Usually deletable.' },
  { p: 'a crucial role', c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: 'a pivotal role', c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: 'a vital role', c: 'Inflated wording', note: 'Say what it actually does.' },
  { p: 'thereby', c: 'Inflated wording', note: 'Often a stiff link — split the sentence or use "so".' },
  // Word families matched in every inflection.
  { rx: '\\butili[sz](?:e|es|ed|ing|ation)\\b', c: 'Inflated wording', note: '"Use" is plainer.' },
  { rx: '\\bleverag(?:e|es|ed|ing)\\b', c: 'Inflated wording', note: '"Use" is usually what is meant.' },
  { rx: '\\bfacilitat(?:e|es|ed|ing)\\b', c: 'Inflated wording', note: '"Help" or "allow" may be plainer.' },
  { rx: '\\bnavigat(?:e|es|ing) the complexit(?:y|ies)\\b', c: 'Inflated wording', note: 'Abstract; name the actual difficulty.' },
  { rx: '\\bdelv(?:e|es|ed|ing) (?:into|deeper)\\b', c: 'Inflated wording', note: '"Look at" or "examine" is plainer.' },
  { rx: '\\bunderscor(?:e|es|ed|ing)\\b', c: 'Inflated wording', note: '"Shows" or "highlights" is plainer.' },
  { rx: '\\bpivotal\\b', c: 'Inflated wording', note: 'Say why it matters instead.' },
  // Correspondence stock phrases.
  { p: 'i hope this email finds you well', c: 'Cliché', note: 'Stock opener — start with the point.' },
  { p: 'i hope this message finds you well', c: 'Cliché', note: 'Stock opener — start with the point.' },
  { p: 'i am writing to inform you that', c: 'Padding', note: 'Say the news directly.' },
  { p: 'i am writing to let you know', c: 'Padding', note: 'Say the news directly.' },
  { p: 'take this opportunity to', c: 'Padding', note: 'Usually deletable.' },
  { p: 'do not hesitate to', c: 'Cliché', note: 'Stock closer — "please get in touch" is plainer.' },
  { p: "don't hesitate to", c: 'Cliché', note: 'Stock closer — "please get in touch" is plainer.' },
  { p: 'please find attached', c: 'Cliché', note: '"I\'ve attached" is plainer.' },
  { p: "in the modern era", c: 'Cliché', note: 'Generic opener — start with the real point.' },
  { p: "ever-evolving", c: 'Cliché', note: 'Overused descriptor.' },
  { p: "ever-changing", c: 'Cliché', note: 'Overused descriptor.' },
  { p: "fast-paced", c: 'Cliché', note: 'Overused descriptor.' },
  { p: "game-changer", c: 'Cliché', note: 'Overused descriptor.' },
  { p: "double-edged sword", c: 'Cliché', note: 'Overused metaphor.' },
  { p: "at the end of the day", c: 'Cliché', note: 'Conversational filler.' },
  { p: "first and foremost", c: 'Cliché', note: '"First" is enough.' },
  { p: "last but not least", c: 'Cliché', note: '"Finally" is enough.' },
  { p: "navigate the complexities", c: 'Inflated wording', note: 'Abstract; name the actual difficulty.' },
  { p: "the realm of", c: 'Inflated wording', note: 'Usually deletable.' },
  { p: "the landscape of", c: 'Inflated wording', note: 'Usually deletable.' },
  { p: "a myriad of", c: 'Inflated wording', note: '"Many" is plainer.' },
  { p: "a plethora of", c: 'Inflated wording', note: '"Many" is plainer.' },
  { p: "delve into", c: 'Inflated wording', note: '"Look at" or "examine" is plainer.' },
  { p: "delves into", c: 'Inflated wording', note: '"Looks at" or "examines" is plainer.' },
  { p: "tapestry", c: 'Inflated wording', note: 'Ornamental; rarely literal.' },
  { p: "seamless", c: 'Inflated wording', note: 'Vague praise — what is actually smooth?' },
  { p: "seamlessly", c: 'Inflated wording', note: 'Vague praise — what is actually smooth?' },
  { p: "leverage", c: 'Inflated wording', note: '"Use" is usually what is meant.' },
  { p: "leveraging", c: 'Inflated wording', note: '"Using" is usually what is meant.' },
  { p: "utilise", c: 'Inflated wording', note: '"Use" is plainer.' },
  { p: "utilize", c: 'Inflated wording', note: '"Use" is plainer.' },
  { p: "utilising", c: 'Inflated wording', note: '"Using" is plainer.' },
  { p: "utilizing", c: 'Inflated wording', note: '"Using" is plainer.' },
  { p: "facilitate", c: 'Inflated wording', note: '"Help" or "allow" may be plainer.' },
  { p: "robust", c: 'Inflated wording', note: 'Vague praise unless technical.' },
  { p: "cutting-edge", c: 'Cliché', note: 'Overused descriptor.' },
  { p: "state-of-the-art", c: 'Cliché', note: 'Overused unless literally true.' },
  { p: "unlock the potential", c: 'Cliché', note: 'Marketing phrasing.' },
  { p: "unlock the full potential", c: 'Cliché', note: 'Marketing phrasing.' },
  { p: "harness the power", c: 'Cliché', note: 'Marketing phrasing.' },
  { p: "embark on a journey", c: 'Cliché', note: 'Overused metaphor.' },
  { p: "pave the way", c: 'Cliché', note: 'Overused metaphor.' },
  { p: "paving the way", c: 'Cliché', note: 'Overused metaphor.' },
  { p: "shed light on", c: 'Cliché', note: '"Explain" or "show" is plainer.' },
  { p: "stands as", c: 'Inflated wording', note: '"Is" is usually enough.' },
  { p: "serves as a", c: 'Inflated wording', note: '"Is a" is usually enough.' },
  { p: "not only", c: 'Construction', note: '"Not only … but also" loses force when repeated.' },
  { p: "in conclusion", c: 'Construction', note: 'Signposting the ending is rarely needed.' },
  { p: "overall,", c: 'Construction', note: 'Often a weak sentence opener.' },
  { p: "ultimately,", c: 'Construction', note: 'Often a weak sentence opener.' },
  { p: "very unique", c: 'Empty intensifier', note: 'Unique cannot be graded.' },
  { p: "truly", c: 'Empty intensifier', note: 'Rarely adds meaning.' },
  { p: "incredibly", c: 'Empty intensifier', note: 'Rarely adds meaning.' },
  { p: "extremely", c: 'Empty intensifier', note: 'Prefer a more exact word.' },
];

// Words that soften or strengthen a claim. A rewrite that swaps one for the
// other can change meaning, so the validator watches the balance.
export const HEDGES = ['may', 'might', 'could', 'possibly', 'perhaps', 'likely', 'unlikely', 'suggests', 'appears', 'seems', 'somewhat', 'arguably', 'probably', 'potentially', 'often', 'sometimes', 'usually', 'generally', 'tends'];
export const BOOSTERS = ['always', 'never', 'definitely', 'certainly', 'clearly', 'undoubtedly', 'proves', 'must', 'will', 'obviously', 'all', 'every', 'none', 'guarantees'];
export const NEGATIONS = ['not', 'no', 'never', 'none', 'nobody', 'nothing', 'neither', 'nor', 'without', 'cannot'];

export const FIRST_PERSON = ['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves'];
export const SECOND_PERSON = ['you', 'your', 'yours', 'yourself', 'yourselves'];

// Spelling pairs for British/American detection and for the spelling option.
export const UK_US = [
  ['colour', 'color'], ['favour', 'favor'], ['behaviour', 'behavior'], ['honour', 'honor'],
  ['labour', 'labor'], ['neighbour', 'neighbor'], ['organise', 'organize'],
  ['organisation', 'organization'], ['realise', 'realize'], ['recognise', 'recognize'],
  ['analyse', 'analyze'], ['optimise', 'optimize'], ['optimisation', 'optimization'],
  ['prioritise', 'prioritize'], ['summarise', 'summarize'], ['utilise', 'utilize'],
  ['centre', 'center'], ['metre', 'meter'], ['theatre', 'theater'], ['programme', 'program'],
  ['defence', 'defense'], ['licence', 'license'], ['travelled', 'traveled'],
  ['modelling', 'modeling'], ['catalogue', 'catalog'], ['grey', 'gray'],
  ['judgement', 'judgment'], ['emphasise', 'emphasize'], ['minimise', 'minimize'],
  ['maximise', 'maximize'], ['characterise', 'characterize'], ['criticise', 'criticize'],
  ['apologise', 'apologize'], ['customise', 'customize'], ['visualise', 'visualize'],
];

export const NOMINAL_SUFFIX = /(tion|sion|ment|ness|ity|ance|ence|ism)s?$/i;

// Irregular past participles for the passive-voice heuristic.
export const IRREGULAR_PARTICIPLES = new Set([
  'been', 'born', 'brought', 'built', 'bought', 'caught', 'chosen', 'done', 'drawn',
  'driven', 'eaten', 'fallen', 'felt', 'found', 'forgotten', 'given', 'gone', 'grown',
  'heard', 'held', 'hidden', 'kept', 'known', 'laid', 'led', 'left', 'lost', 'made',
  'meant', 'met', 'paid', 'put', 'read', 'run', 'said', 'seen', 'sent', 'set', 'shown',
  'sold', 'spent', 'spoken', 'stolen', 'taken', 'taught', 'thought', 'told', 'understood',
  'won', 'written', 'begun', 'broken', 'cut', 'hit', 'hurt', 'let', 'shut', 'spread',
]);

// Frequent real errors in drafts. Each has a correction and is matched
// case-insensitively on word boundaries. These are corrected by the rewrite
// and flagged in the analysis.
export const COMMON_ERRORS = [
  { p: 'could of', fix: 'could have' }, { p: 'should of', fix: 'should have' },
  { p: 'would of', fix: 'would have' }, { p: 'must of', fix: 'must have' },
  { p: 'might of', fix: 'might have' }, { p: 'alot', fix: 'a lot' },
  { p: 'definately', fix: 'definitely' }, { p: 'definatly', fix: 'definitely' },
  { p: 'seperate', fix: 'separate' }, { p: 'seperately', fix: 'separately' },
  { p: 'recieve', fix: 'receive' }, { p: 'recieved', fix: 'received' },
  { p: 'thier', fix: 'their' }, { p: 'wich', fix: 'which' }, { p: 'untill', fix: 'until' },
  { p: 'occured', fix: 'occurred' }, { p: 'begining', fix: 'beginning' },
  { p: 'beleive', fix: 'believe' }, { p: 'acheive', fix: 'achieve' }, { p: 'acheived', fix: 'achieved' },
  { p: 'enviroment', fix: 'environment' }, { p: 'goverment', fix: 'government' },
  { p: 'tommorow', fix: 'tomorrow' }, { p: 'wierd', fix: 'weird' }, { p: 'basicly', fix: 'basically' },
  { p: 'dose not', fix: 'does not' }, { p: 'there own', fix: 'their own' },
  { p: 'your welcome', fix: "you're welcome" }, { p: 'less people', fix: 'fewer people' },
  { p: 'irregardless', fix: 'regardless' }, { p: 'suppose to', fix: 'supposed to' },
  { p: 'use to', fix: 'used to' }, { p: 'alright', fix: 'all right', soft: true },
  { p: 'went threw', fix: 'went through' }, { p: 'going threw', fix: 'going through' },
  { p: 'compliment the', fix: 'complement the', soft: true },
];

// Verbal filler that adds nothing in written prose.
export const FILLERS = [
  'and all', 'and stuff', 'and that', 'you know', 'i mean', 'kind of', 'sort of', 'basically',
  'literally', 'actually', 'honestly', 'like i said', 'at the end of the day', 'to be fair',
  'pretty much', 'or something', 'and everything', 'really really', 'just basically',
];

// Words and phrases that carry a writer's register. A profile records how often
// the writer uses each, so a rewrite can keep the ones they use and avoid the
// ones they never do.
export const VOICE_MARKERS = [
  'really', 'quite', 'very', 'pretty', 'a lot', 'lots of', 'loads of', 'a bit', 'so', 'just',
  'also', 'actually', 'basically', 'probably', 'maybe', 'perhaps', 'definitely', 'obviously',
  'though', 'although', 'however', 'but', 'because', 'since', 'which means', 'this means',
  'for example', 'for instance', 'such as', 'overall', 'in my opinion', 'i think',
  'i feel', 'i believe', 'personally', 'in general', 'mainly', 'mostly', 'especially',
  'make sure', 'still', 'anyway', 'to be honest', 'of course', 'in fact', 'clearly',
];
