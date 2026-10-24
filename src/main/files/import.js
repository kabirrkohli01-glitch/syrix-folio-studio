// File import. Every importer returns HTML for the editor plus warnings about
// anything that could not be carried over; nothing fails silently.
//
//   .docx           mammoth (semantic HTML: headings, lists, emphasis, links, tables)
//   .md / .markdown marked
//   .txt            plain text, one paragraph per blank-line block
//   .html / .htm    as-is (the renderer sanitises before loading)
//   .pdf            pdf.js text extraction; scanned PDFs are reported, not guessed
//   images          tesseract.js OCR (English); language data is downloaded once

import fs from 'node:fs';
import path from 'node:path';

export const IMPORT_EXTENSIONS = ['docx', 'md', 'markdown', 'txt', 'html', 'htm', 'pdf', 'png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'];
const UNSUPPORTED = {
  doc: 'Legacy Word .doc files are not supported. Open the file in Word and save it as .docx.',
  rtf: 'RTF is not supported. Save the file as .docx or .txt.',
  odt: 'OpenDocument .odt is not supported. Save the file as .docx.',
  pages: 'Apple Pages files are not supported. Export the file as .docx.',
};

export class ImportError extends Error {}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function textToHtml(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) { swapped[i - 2] = buf[i + 1]; swapped[i - 1] = buf[i]; }
    return swapped.toString('utf16le');
  }
  const s = buf.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function htmlToText(html) {
  return String(html)
    .replace(/<\/(p|h[1-6]|li|blockquote|div|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function importDocx(file) {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.convertToHtml({ path: file }, {
    styleMap: [
      'u => u',
      'strike => s',
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Subtitle'] => h2:fresh",
      "p[style-name='Quote'] => blockquote > p:fresh",
      "p[style-name='Intense Quote'] => blockquote > p:fresh",
    ],
    convertImage: mammoth.images.imgElement(() => ({ src: '' })),
  });
  const html = result.value.replace(/<img src=""[^>]*>/g, '');
  const warnings = [];
  const images = (result.value.match(/<img /g) || []).length;
  if (images) warnings.push(`${images} image${images > 1 ? 's were' : ' was'} not imported (Folio documents are text-only).`);
  const unrecognised = new Set();
  for (const m of result.messages) {
    if (/Unrecognised paragraph style/i.test(m.message)) unrecognised.add(m.message.match(/'([^']+)'/)?.[1] || 'unknown');
  }
  if (unrecognised.size) warnings.push(`Custom Word styles were imported as normal text: ${[...unrecognised].slice(0, 6).join(', ')}.`);
  if (/<table/i.test(html)) warnings.push('Tables were converted to plain paragraphs.');
  warnings.push('Text alignment, fonts and colours are not read from Word files; structure and emphasis are.');
  return { html, warnings };
}

async function importPdf(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  let doc;
  const task = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  try {
    doc = await task.promise;
  } catch (e) {
    if (/password/i.test(e.message)) throw new ImportError('This PDF is password-protected.');
    throw new ImportError(`This PDF could not be read: ${e.message}`);
  }
  const paragraphs = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // Rebuild lines from positioned text runs, then paragraphs from vertical gaps.
    const lines = [];
    let cur = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5];
      const h = Math.abs(item.transform[3]) || item.height || 10;
      if (!cur || Math.abs(cur.y - y) > h * 0.5) {
        if (cur) lines.push(cur);
        cur = { y, h, text: item.str };
      } else {
        cur.text += item.str;
      }
      if (item.hasEOL) { lines.push(cur); cur = null; }
    }
    if (cur) lines.push(cur);
    let para = '';
    let prev = null;
    for (const line of lines) {
      const t = line.text.replace(/\s+/g, ' ').trim();
      if (!t) { if (para) { paragraphs.push(para); para = ''; } prev = null; continue; }
      const gap = prev ? prev.y - line.y : 0;
      if (prev && (gap > prev.h * 1.7 || gap < 0)) { if (para) paragraphs.push(para); para = ''; }
      para = para ? (para.endsWith('-') ? para.slice(0, -1) + t : `${para} ${t}`) : t;
      prev = line;
    }
    if (para) paragraphs.push(para);
    page.cleanup();
  }
  await task.destroy();
  const text = paragraphs.join('\n\n');
  if (text.replace(/\s/g, '').length < 20) {
    throw new ImportError('This PDF has no text layer (it is probably a scan). Export its pages as images and import those to use OCR.');
  }
  return {
    html: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join(''),
    warnings: ['PDF import recovers text and paragraphs only; headings, lists and emphasis are not preserved.'],
  };
}

let ocrCacheDir = null;
export function setOcrCacheDir(dir) { ocrCacheDir = dir; }

async function importImage(file) {
  const { createWorker } = await import('tesseract.js');
  let worker;
  try {
    worker = await createWorker('eng', 1, { cachePath: ocrCacheDir || undefined, errorHandler: () => {} });
  } catch (e) {
    throw new ImportError(`OCR could not start. The English language data is downloaded the first time OCR is used, so an internet connection is needed once. (${e.message || e})`);
  }
  try {
    const { data } = await worker.recognize(file);
    const text = (data.text || '').trim();
    if (text.replace(/\s/g, '').length < 5) throw new ImportError('No readable text was found in this image.');
    const confidence = Math.round(data.confidence || 0);
    const warnings = [`Text recognised by OCR (average confidence ${confidence}%). Proofread it against the image.`];
    if (confidence < 70) warnings.push('Low OCR confidence: the image may be blurred, small or handwritten.');
    return { html: textToHtml(text.replace(/([^\n])\n(?!\n)/g, '$1 ')), warnings };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/** Import one file. Returns { title, html, text, warnings, kind }. Throws ImportError. */
export async function importFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const title = path.basename(file, path.extname(file));
  if (UNSUPPORTED[ext]) throw new ImportError(UNSUPPORTED[ext]);
  if (!IMPORT_EXTENSIONS.includes(ext)) throw new ImportError(`.${ext || '(no extension)'} files are not supported.`);
  const stat = fs.statSync(file);
  if (stat.size > 60 * 1024 * 1024) throw new ImportError('The file is larger than 60 MB.');

  let out;
  if (ext === 'docx') out = await importDocx(file);
  else if (ext === 'pdf') out = await importPdf(file);
  else if (['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'].includes(ext)) out = await importImage(file);
  else {
    const raw = decodeText(fs.readFileSync(file));
    if (ext === 'md' || ext === 'markdown') {
      const { marked } = await import('marked');
      out = { html: marked.parse(raw, { gfm: true, breaks: false }), warnings: [] };
    } else if (ext === 'html' || ext === 'htm') {
      const body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      out = { html: (body ? body[1] : raw).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''), warnings: [] };
    } else {
      out = { html: textToHtml(raw), warnings: [] };
    }
  }
  const text = htmlToText(out.html);
  if (!text.trim()) throw new ImportError('The file contains no text.');
  return { title, html: out.html, text, warnings: out.warnings, kind: ext };
}

/** Plain text from a file, for writing-profile samples. */
export async function extractText(file) {
  const r = await importFile(file);
  return { title: r.title, text: r.text, warnings: r.warnings };
}

