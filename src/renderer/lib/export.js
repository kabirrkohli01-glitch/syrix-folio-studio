// Document export. Conversion happens here, where the editor schema and a DOM
// are available; the main process only writes the bytes (or prints the PDF).

import { generateJSON } from '@tiptap/core';
import TurndownService from 'turndown';
import { buildDocx, Packer } from '../../shared/files/docx-export.js';
import { baseExtensions } from './editorExtensions.js';

const folio = window.folio;

export const EXPORT_FORMATS = [
  { id: 'docx', label: 'Word document (.docx)', ext: 'docx' },
  { id: 'pdf', label: 'PDF (.pdf)', ext: 'pdf' },
  { id: 'md', label: 'Markdown (.md)', ext: 'md' },
  { id: 'txt', label: 'Plain text (.txt)', ext: 'txt' },
  { id: 'html', label: 'Web page (.html)', ext: 'html' },
];

export function safeFileName(title, ext) {
  const base = String(title || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  return `${base}.${ext}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlToMarkdown(html) {
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
  td.addRule('underline', { filter: ['u'], replacement: (c) => `<u>${c}</u>` });
  // Compact list items: "- item" / "1. item", without the blank lines turndown
  // adds when an item wraps its text in a paragraph.
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n\n+/g, '\n').replace(/\n/g, '\n   ');
      const parent = node.parentNode;
      let prefix = '- ';
      if (parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') || 1);
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      return `${prefix}${body}\n`;
    },
  });
  td.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: (c) => `~~${c}~~` });
  return td.turndown(html);
}

/** Standalone, print-ready HTML for PDF and .html export. */
export function printableHtml(title, bodyHtml) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.6; color: #111; margin: 0; }
  h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 10pt; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; }
  h3 { font-size: 12.5pt; margin: 14pt 0 4pt; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
  li > p { margin: 0 0 2pt; }
  blockquote { margin: 10pt 0; padding-left: 12pt; border-left: 2pt solid #bbb; color: #444; font-style: italic; }
  pre { font-family: Consolas, monospace; font-size: 9.5pt; background: #f4f4f4; padding: 8pt; border-radius: 4pt; white-space: pre-wrap; }
  code { font-family: Consolas, monospace; font-size: 0.9em; }
  hr { border: 0; border-top: 1px solid #bbb; margin: 16pt 0; }
  a { color: #1a4c8b; }
  h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
  p, li, blockquote { orphans: 3; widows: 3; }
  .doc-title { font-size: 22pt; margin-bottom: 16pt; }
</style></head><body>${bodyHtml}</body></html>`;
}

function withTitle(title, html, json) {
  const first = json?.content?.[0];
  const firstText = first ? (first.content || []).map((n) => n.text || '').join('').trim() : '';
  if (title && firstText.toLowerCase() !== String(title).trim().toLowerCase()) {
    return `<h1 class="doc-title">${escapeHtml(title)}</h1>${html}`;
  }
  return html;
}

/**
 * Export a document. `doc` is { title, html, json?, text? }.
 * Returns { path } on success, { canceled: true } if the save dialog was dismissed.
 */
export async function exportDocument(doc, format) {
  const title = doc.title || 'Untitled document';
  const json = doc.json || generateJSON(doc.html || '<p></p>', baseExtensions());
  const html = doc.html || '';
  switch (format) {
    case 'docx': {
      const blob = await Packer.toBlob(buildDocx(json, { title }));
      const data = new Uint8Array(await blob.arrayBuffer());
      return folio.files.saveBytes({ defaultName: safeFileName(title, 'docx'), filters: [{ name: 'Word document', extensions: ['docx'] }], data });
    }
    case 'pdf':
      return folio.files.printPdf({ html: printableHtml(title, withTitle(title, html, json)), defaultName: safeFileName(title, 'pdf') });
    case 'md': {
      const md = `${withTitle(title, '', json) ? `# ${title}\n\n` : ''}${htmlToMarkdown(html)}\n`;
      return folio.files.saveText({ defaultName: safeFileName(title, 'md'), filters: [{ name: 'Markdown', extensions: ['md'] }], text: md });
    }
    case 'txt': {
      const text = doc.text ?? '';
      return folio.files.saveText({ defaultName: safeFileName(title, 'txt'), filters: [{ name: 'Plain text', extensions: ['txt'] }], text: `${title}\n\n${text}\n` });
    }
    case 'html':
      return folio.files.saveText({ defaultName: safeFileName(title, 'html'), filters: [{ name: 'Web page', extensions: ['html'] }], text: printableHtml(title, withTitle(title, html, json)).replace('@page { size: A4; margin: 0; }', '').replace('margin: 0; }', 'margin: 48px auto; max-width: 720px; padding: 0 24px; }') });
    default:
      throw new Error(`Unknown export format ${format}`);
  }
}
