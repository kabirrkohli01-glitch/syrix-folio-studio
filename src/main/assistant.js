// The SYRIX assistant inside Folio. It answers questions about the open
// document, explains, summarises and brainstorms, and can propose edits to
// the selected text. Proposed edits are returned inside an EDIT block that the
// interface shows as a reviewable change; nothing reaches the document until
// the writer applies it.

import { chatChain } from './ai/providers.js';
import { countWords } from '../shared/text/tokenize.js';

export const ASSISTANT_SYSTEM = `You are SYRIX, the writing assistant built into SYRIX Folio (made by Kabirr Kohli). You help the writer understand, plan and improve their own document.

How you work:
- Be direct and useful. Lead with the answer; add detail only where it helps. No filler openers ("Sure", "Great question") and no closing offers.
- Ground everything in the document and selection you are given. When you refer to the document, quote the relevant words briefly. If the answer is not in the document, say so plainly.
- Never invent facts, statistics, quotations, sources or citations. If the writer asks for evidence you do not have, say what kind of source would answer it instead of making one up.
- Be honest about weaknesses in the writing, and specific about how to fix them.
- When you propose replacement text for the selection, put the complete replacement — and nothing else — between a line containing <<<EDIT and a line containing EDIT>>>. Keep its meaning, facts, names, numbers, quotations and citations unless the writer asked you to change them. Put any explanation outside the block, briefly. Offer at most one EDIT block per reply.
- Only propose an EDIT block when the writer asked for a rewrite, correction or revision, or when the action requires one.
- Use British or American spelling to match the document.
- Plain text with light markdown (short lists, **bold** for key terms). No headings unless the answer is long.`;

export const ACTIONS = {
  explain: { label: 'Explain', needsSelection: true, prompt: 'Explain the selected passage in plain terms: what it says, what it assumes, and any terms a reader might not know.' },
  summarise: { label: 'Summarise', needsSelection: false, prompt: 'Summarise the selected passage (or the whole document if nothing is selected) in a few clear sentences, then list the key points.' },
  brainstorm: { label: 'Brainstorm', needsSelection: false, prompt: 'Brainstorm ideas that would strengthen this piece: angles, arguments, examples to look for, counterpoints to address and structure changes. Mark clearly which ideas would need new evidence the writer must find.' },
  clarify: { label: 'Clarify a concept', needsSelection: true, prompt: 'Identify the key concept in the selection and clarify it: define it, give a simple example, and point out common misunderstandings.' },
  grammar: { label: 'Fix grammar', needsSelection: true, edit: true, prompt: 'Correct grammar, spelling, punctuation and clear readability problems in the selection. Change as little as possible and keep the writer\'s voice. Return the corrected text in an EDIT block, then list the main corrections briefly.' },
  revise: { label: 'Suggest a revision', needsSelection: true, edit: true, prompt: 'Suggest a stronger revision of the selection: clearer, tighter and better structured, in the same voice and with the same meaning. Return it in an EDIT block, then explain the key changes in two or three bullets.' },
  feedback: { label: 'Review this', needsSelection: false, prompt: 'Review the selection (or the document if nothing is selected) as a careful editor: what works, what is unclear or unsupported, and the three most valuable improvements, in order of impact.' },
};

const DOC_WORD_LIMIT = 6000;

/** Compact document context: the whole text when short, otherwise an outline plus the region around the selection. */
export function documentContext({ title, text, selection, selectionOffset }) {
  const full = String(text || '');
  const wc = countWords(full);
  if (wc <= DOC_WORD_LIMIT) return { body: full, truncated: false, words: wc };
  const lines = full.split('\n');
  const outline = lines.filter((l) => l.trim() && l.trim().split(/\s+/).length <= 12 && !/[.!?]$/.test(l.trim())).slice(0, 60);
  const at = Number.isFinite(selectionOffset) ? selectionOffset : selection ? full.indexOf(selection) : 0;
  const start = Math.max(0, at - 12000);
  const region = full.slice(start, start + 24000);
  return {
    body: `[The document is long (${wc} words). Outline of headings:]\n${outline.join('\n')}\n\n[Text around the current position:]\n${start > 0 ? '…' : ''}${region}…`,
    truncated: true,
    words: wc,
  };
}

export function buildMessages({ history = [], message, action, doc = {}, selection = '' }) {
  const ctx = documentContext({ ...doc, selection });
  const contextBlock = `DOCUMENT: "${doc.title || 'Untitled'}" (${ctx.words} words${ctx.truncated ? ', excerpted' : ''})\n<document>\n${ctx.body}\n</document>${selection ? `\n\nSELECTED TEXT\n<selection>\n${selection}\n</selection>` : '\n\nNo text is selected.'}`;
  const ask = action && ACTIONS[action] ? `${ACTIONS[action].prompt}${message ? `\n\nThe writer adds: ${message}` : ''}` : message;
  const trimmedHistory = history.slice(-10).map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));
  return [
    { role: 'system', content: ASSISTANT_SYSTEM },
    { role: 'system', content: contextBlock },
    ...trimmedHistory,
    { role: 'user', content: ask },
  ];
}

/** Extract a proposed edit from a reply. */
export function extractEdit(reply) {
  const m = String(reply || '').match(/<<<EDIT\s*\n([\s\S]*?)\n?\s*EDIT>>>/);
  if (!m) return null;
  return m[1].replace(/^\n+|\n+$/g, '');
}

export function createAssistant({ chainFor }) {
  const running = new Map();
  return {
    async send(runId, req, emit) {
      const controller = new AbortController();
      running.set(runId, controller);
      try {
        const messages = buildMessages(req);
        const out = await chatChain(chainFor('assistant'), {
          messages,
          temperature: ACTIONS[req.action]?.edit ? 0.4 : 0.6,
          maxTokens: 3000,
          reasoningEffort: 'medium',
          signal: controller.signal,
          onToken: (t) => emit({ runId, type: 'token', text: t }),
          onStatus: (s) => emit({ runId, type: 'status', ...s }),
        });
        return { text: out.text, edit: extractEdit(out.text), model: `${out.provider}:${out.model}` };
      } finally {
        running.delete(runId);
      }
    },
    cancel(runId) { running.get(runId)?.abort(); },
  };
}
