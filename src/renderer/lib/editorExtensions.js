import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// ---------------------------------------------------------------------------
// Find and replace. Matches are computed per text block so a match never spans
// two paragraphs, and are shown as decorations (the document is not changed
// until a replacement is made).

export const searchKey = new PluginKey('folio-search');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function findMatches(doc, { term, caseSensitive, wholeWord, regex }) {
  if (!term) return [];
  let re;
  try {
    const src = regex ? term : escapeRe(term);
    re = new RegExp(wholeWord ? `\\b(?:${src})\\b` : src, caseSensitive ? 'g' : 'gi');
  } catch {
    return [];
  }
  const results = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Map text offsets back to document positions, skipping non-text inline nodes.
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(-1);
        text += '￼';
      }
    });
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const from = map[m.index];
      const to = map[m.index + m[0].length - 1] + 1;
      if (from >= 0 && to > from) results.push({ from, to });
      if (results.length > 5000) return false;
    }
    return false;
  });
  return results;
}

export const Search = Extension.create({
  name: 'folioSearch',
  addStorage() {
    return { term: '', caseSensitive: false, wholeWord: false, regex: false, results: [], index: 0 };
  },
  addCommands() {
    const refresh = (editor, tr) => {
      const s = editor.storage.folioSearch;
      s.results = findMatches(tr ? tr.doc : editor.state.doc, s);
      if (s.index >= s.results.length) s.index = Math.max(0, s.results.length - 1);
    };
    return {
      setSearch: (opts) => ({ editor, tr, dispatch }) => {
        Object.assign(editor.storage.folioSearch, opts);
        editor.storage.folioSearch.index = 0;
        refresh(editor);
        if (dispatch) tr.setMeta(searchKey, { updated: true });
        return true;
      },
      clearSearch: () => ({ editor, tr, dispatch }) => {
        Object.assign(editor.storage.folioSearch, { term: '', results: [], index: 0 });
        if (dispatch) tr.setMeta(searchKey, { updated: true });
        return true;
      },
      searchStep: (dir) => ({ editor, tr, dispatch }) => {
        const s = editor.storage.folioSearch;
        if (!s.results.length) return false;
        s.index = (s.index + dir + s.results.length) % s.results.length;
        if (dispatch) tr.setMeta(searchKey, { updated: true });
        return true;
      },
      replaceCurrent: (replacement) => ({ editor, tr, dispatch }) => {
        const s = editor.storage.folioSearch;
        const hit = s.results[s.index];
        if (!hit) return false;
        if (dispatch) {
          tr.insertText(replacement, hit.from, hit.to);
          tr.setMeta(searchKey, { updated: true });
        }
        return true;
      },
      replaceAll: (replacement) => ({ editor, tr, dispatch }) => {
        const s = editor.storage.folioSearch;
        if (!s.results.length) return false;
        if (dispatch) {
          // Replace from the end so earlier positions stay valid.
          for (const hit of [...s.results].reverse()) tr.insertText(replacement, hit.from, hit.to);
          tr.setMeta(searchKey, { updated: true });
        }
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const ext = this;
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, old) {
          const s = ext.editor?.storage?.folioSearch;
          if (!s) return DecorationSet.empty;
          if (!tr.docChanged && !tr.getMeta(searchKey)) return old.map(tr.mapping, tr.doc);
          if (tr.docChanged) {
            s.results = findMatches(tr.doc, s);
            if (s.index >= s.results.length) s.index = Math.max(0, s.results.length - 1);
          }
          if (!s.term) return DecorationSet.empty;
          return DecorationSet.create(tr.doc, s.results.map((r, i) => Decoration.inline(r.from, r.to, { class: i === s.index ? 'search-hit current' : 'search-hit' })));
        },
      },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});

export function baseExtensions({ placeholder = 'Start writing…' } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({ placeholder }),
    CharacterCount,
    Search,
  ];
}

/** Plain text of a document with one line per block. */
export function docText(editor) {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n');
}
