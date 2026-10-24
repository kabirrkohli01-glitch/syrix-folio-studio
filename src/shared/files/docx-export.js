// Editor JSON (ProseMirror/TipTap) → .docx using the `docx` library.
// Supported: headings 1–3, paragraphs with alignment, bold, italic, underline,
// strikethrough, inline code, links, bullet and numbered lists (nested, with
// numbering restarting per list), block quotes, code blocks, horizontal rules
// and line breaks. Runs in the browser (Packer.toBlob) and in Node
// (Packer.toBuffer) so export can be tested headlessly.

import {
  Document, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink,
  LevelFormat, BorderStyle, Packer,
} from 'docx';

const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };

function runsFor(nodes = [], extra = {}) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') { out.push(new TextRun({ text: '', break: 1, ...extra })); continue; }
    if (n.type !== 'text') continue;
    const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || true]));
    const opts = {
      text: n.text,
      bold: Boolean(marks.bold) || extra.bold,
      italics: Boolean(marks.italic) || extra.italics,
      underline: marks.underline ? {} : undefined,
      strike: Boolean(marks.strike),
      font: marks.code || extra.code ? 'Consolas' : undefined,
    };
    if (marks.link && marks.link.href) {
      out.push(new ExternalHyperlink({ link: marks.link.href, children: [new TextRun({ ...opts, style: 'Hyperlink' })] }));
    } else {
      out.push(new TextRun(opts));
    }
  }
  return out;
}

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  return (node.content || []).map(textOf).join('');
}

export function jsonToDocxParagraphs(doc) {
  const paragraphs = [];
  let listInstance = 0;

  function walk(node, ctx = {}) {
    switch (node.type) {
      case 'doc':
        (node.content || []).forEach((c) => walk(c, ctx));
        break;
      case 'paragraph':
        paragraphs.push(new Paragraph({
          children: runsFor(node.content, ctx.runs),
          alignment: ALIGN[node.attrs?.textAlign] || undefined,
          numbering: ctx.list ? { reference: ctx.list.ref, level: ctx.list.level, instance: ctx.list.instance } : undefined,
          style: ctx.quote ? 'Quote' : undefined,
        }));
        break;
      case 'heading':
        paragraphs.push(new Paragraph({
          children: runsFor(node.content),
          heading: HEADINGS[node.attrs?.level] || HeadingLevel.HEADING_2,
          alignment: ALIGN[node.attrs?.textAlign] || undefined,
        }));
        break;
      case 'bulletList':
      case 'orderedList': {
        const ref = node.type === 'bulletList' ? 'folio-bullets' : 'folio-numbers';
        const level = ctx.list ? Math.min(ctx.list.level + 1, 5) : 0;
        const instance = ctx.list && ctx.list.ref === ref ? ctx.list.instance : ++listInstance;
        for (const item of node.content || []) walk(item, { ...ctx, list: { ref, level, instance } });
        break;
      }
      case 'listItem': {
        let first = true;
        for (const c of node.content || []) {
          if (c.type === 'paragraph') {
            if (first) walk(c, ctx);
            else walk(c, { ...ctx, list: null, indentLevel: ctx.list?.level });
            first = false;
          } else {
            walk(c, ctx);
          }
        }
        break;
      }
      case 'blockquote':
        for (const c of node.content || []) walk(c, { ...ctx, quote: true });
        break;
      case 'codeBlock':
        for (const line of textOf(node).split('\n')) {
          paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })] }));
        }
        break;
      case 'horizontalRule':
        paragraphs.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } } }));
        break;
      default:
        if (node.content) node.content.forEach((c) => walk(c, ctx));
    }
  }
  walk(doc);
  return paragraphs;
}

function numberingLevels(kind) {
  const formats = kind === 'bullet'
    ? ['•', '◦', '▪', '•', '◦', '▪']
    : [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  return formats.map((f, level) => ({
    level,
    format: kind === 'bullet' ? LevelFormat.BULLET : f,
    text: kind === 'bullet' ? f : `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
}

/** Build a docx Document. Includes the title as a Title paragraph unless the text already opens with it. */
export function buildDocx(doc, { title = '', author = 'SYRIX Folio' } = {}) {
  const body = jsonToDocxParagraphs(doc || { type: 'doc', content: [] });
  const firstText = textOf((doc?.content || [])[0]).trim();
  const children = [];
  if (title && firstText.toLowerCase() !== title.trim().toLowerCase()) {
    children.push(new Paragraph({ children: [new TextRun({ text: title })], heading: HeadingLevel.TITLE }));
  }
  children.push(...body);
  return new Document({
    creator: author,
    title,
    description: 'Created with SYRIX Folio',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [{
        id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { italics: true, color: '555555' },
        paragraph: { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 12 } } },
      }],
    },
    numbering: {
      config: [
        { reference: 'folio-bullets', levels: numberingLevels('bullet') },
        { reference: 'folio-numbers', levels: numberingLevels('number') },
      ],
    },
    sections: [{ properties: {}, children }],
  });
}

export { Packer };
