// Block-level text access for handing editor content to the humanizer and
// applying results back. Each non-empty text block inside a range becomes one
// paragraph; hard line breaks inside a block are read as spaces so the
// paragraph count always equals the block count. Applying a result replaces
// the text of each block in place, so headings, list items and alignment are
// kept.

export function collectBlocks(doc, from = 0, to = doc.content.size) {
  const blocks = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = Math.max(pos + 1, from);
    const end = Math.min(pos + 1 + node.content.size, to);
    if (end <= start) return false;
    const text = doc.textBetween(start, end, ' ', ' ');
    if (text.trim()) blocks.push({ from: start, to: end, text, type: node.type.name });
    return false;
  });
  return blocks;
}

export function blocksText(blocks) {
  return blocks.map((b) => b.text.trim()).join('\n');
}

/**
 * Replace each block's text with the matching revised paragraph, in one
 * transaction. Fails (returns { ok: false }) if the range no longer contains
 * the text that was sent for revision.
 */
export function applyBlockRevisions(editor, range, expectedText, revised) {
  const { state } = editor;
  const size = state.doc.content.size;
  if (range.to > size) return { ok: false, reason: 'The document has changed since the text was sent.' };
  const blocks = collectBlocks(state.doc, range.from, range.to);
  if (blocksText(blocks) !== expectedText) return { ok: false, reason: 'The document has changed since the text was sent.' };
  if (blocks.length !== revised.length) return { ok: false, reason: 'The number of paragraphs no longer matches.' };
  const tr = state.tr;
  let changed = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const next = revised[i];
    if (next == null || next === b.text.trim()) continue;
    // Keep any leading/trailing whitespace that was inside the block range.
    const lead = b.text.match(/^\s*/)[0];
    const trail = b.text.match(/\s*$/)[0];
    tr.insertText(lead + next + trail, b.from, b.to);
    changed++;
  }
  if (changed) editor.view.dispatch(tr.scrollIntoView());
  return { ok: true, changed };
}
