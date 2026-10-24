// End-to-end tests against the built app (run `npm run build` first, or use
// `npm run test:e2e`). Uses real AI providers for the humanizer and assistant
// flows; set FOLIO_E2E_OFFLINE=1 to skip those.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './launch.mjs';

const OFFLINE = process.env.FOLIO_E2E_OFFLINE === '1';
const SHOTS = process.env.FOLIO_E2E_SHOTS || null;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-e2e-'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-e2e-out-'));
let ctx;

async function shot(name) {
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await ctx.page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }
}
const api = (fn, arg) => ctx.page.evaluate(fn, arg);
/** Make the next save dialog return a fixed path. */
async function mockSave(file) {
  await ctx.app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
}
async function waitFor(fn, { timeout = 15000, interval = 200 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, interval));
  }
}

const SAMPLE = `In today's fast-paced digital landscape, social media plays a pivotal role in how organisations engage with their customers. Furthermore, it is important to note that platforms such as Instagram, which had over 2 billion monthly users in 2024, offer businesses a seamless way to leverage visual content.

However, there are also risks. According to Smith (2021), "most small firms never measure engagement properly", which means they may not notice problems until it is too late.`;

before(async () => { ctx = await launch({ userData: dataDir }); });
after(async () => { await ctx?.app.close().catch(() => {}); });

test('starts with no renderer errors', async () => {
  await ctx.page.waitForTimeout(500);
  assert.deepEqual(ctx.errors, []);
  await shot('home');
});

let docId;
test('creates a document, formats text and autosaves it', async () => {
  const { page } = ctx;
  await page.click('.view:not([hidden]) .quick button:has-text("New document")');
  await page.waitForSelector('.ProseMirror');
  await page.fill('.ed-title', 'E2E test document');
  await page.press('.ed-title', 'Enter');
  await page.click('.ProseMirror');
  await page.keyboard.type('Heading line');
  await page.selectOption('.tb-select', 'h1');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A plain sentence with ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold words');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' in it.');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Shift+8');
  await page.keyboard.type('First bullet');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second bullet');
  await page.waitForSelector('.save-state:has-text("Saved")', { timeout: 8000 });
  docId = await api(async () => (await window.folio.docs.list())[0].id);
  const doc = await api((id) => window.folio.docs.get(id), docId);
  assert.equal(doc.title, 'E2E test document');
  assert.match(doc.html, /<h1>Heading line<\/h1>/);
  assert.match(doc.html, /<strong>bold words<\/strong>/);
  assert.match(doc.html, /<ul><li><p>First bullet<\/p><\/li><li><p>Second bullet<\/p><\/li><\/ul>/);
  assert.ok(doc.wordCount >= 10);
  await shot('editor');
});

test('find and replace changes every match', async () => {
  const { page } = ctx;
  await page.click('.ProseMirror');
  await page.keyboard.press('Control+h');
  await page.fill('.findbar input[placeholder="Find"]', 'bullet');
  await page.waitForSelector('.findbar .count:has-text("of 2")');
  await page.fill('.findbar input[placeholder="Replace with"]', 'item');
  await page.click('.findbar button:has-text("All")');
  await page.waitForSelector('.findbar .count:has-text("0 of 0")');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.save-state:has-text("Saved")', { timeout: 8000 });
  const doc = await api((id) => window.folio.docs.get(id), docId);
  assert.match(doc.text, /First item/);
  assert.doesNotMatch(doc.text, /bullet/);
});

test('undo and redo work', async () => {
  const { page } = ctx;
  await page.click('.ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' extra');
  await page.keyboard.press('Control+z');
  let text = await page.textContent('.ProseMirror');
  assert.ok(!text.includes('extra'));
  await page.keyboard.press('Control+y');
  text = await page.textContent('.ProseMirror');
  assert.ok(text.includes('extra'));
});

test('exports DOCX, PDF, Markdown and text, and re-imports the DOCX with structure intact', async () => {
  const { page } = ctx;
  const docx = path.join(outDir, 'out.docx');
  await mockSave(docx);
  await page.click('.ed-head button:has-text("Export")');
  await page.click('.menu button:has-text("Word document")');
  await waitFor(() => fs.existsSync(docx));
  const pdf = path.join(outDir, 'out.pdf');
  await mockSave(pdf);
  await page.click('.ed-head button:has-text("Export")');
  await page.click('.menu button:has-text("PDF")');
  await waitFor(() => fs.existsSync(pdf) && fs.statSync(pdf).size > 1000);
  assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
  for (const [label, ext] of [['Markdown', 'md'], ['Plain text', 'txt']]) {
    const f = path.join(outDir, `out.${ext}`);
    await mockSave(f);
    await page.click('.ed-head button:has-text("Export")');
    await page.click(`.menu button:has-text("${label}")`);
    await waitFor(() => fs.existsSync(f));
  }
  const md = fs.readFileSync(path.join(outDir, 'out.md'), 'utf8');
  assert.match(md, /# Heading line/);
  assert.match(md, /\*\*bold words\*\*/);
  assert.match(md, /- First item/);

  const r = await api((p) => window.folio.files.importPaths([p]), docx);
  assert.equal(r.failed.length, 0);
  const back = await api((id) => window.folio.docs.get(id), r.imported[0].id);
  assert.match(back.html, /<h1>Heading line<\/h1>/);
  assert.match(back.html, /<strong>bold words<\/strong>/);
  assert.match(back.html, /<ul><li>First item<\/li><li>Second item/);

  const pr = await api((p) => window.folio.files.importPaths([p]), pdf);
  assert.equal(pr.failed.length, 0, JSON.stringify(pr.failed));
  const pdfDoc = await api((id) => window.folio.docs.get(id), pr.imported[0].id);
  assert.match(pdfDoc.text, /plain sentence with bold words/);
});

test('reports files that cannot be imported', async () => {
  const bad = path.join(outDir, 'legacy.doc');
  fs.writeFileSync(bad, 'not really a doc');
  const empty = path.join(outDir, 'empty.txt');
  fs.writeFileSync(empty, '   ');
  const r = await api((p) => window.folio.files.importPaths(p), [bad, empty]);
  assert.equal(r.imported.length, 0);
  assert.match(r.failed[0].message, /save it as \.docx/);
  assert.match(r.failed[1].message, /no text/);
});

test('documents survive a restart and a corrupted file is recovered from backup', async () => {
  await ctx.app.close();
  const file = path.join(dataDir, 'documents', `${docId}.json`);
  assert.ok(fs.existsSync(`${file}.bak`), 'a backup copy exists');
  fs.writeFileSync(file, '{ this is not json');
  ctx = await launch({ userData: dataDir });
  const doc = await api((id) => window.folio.docs.get(id), docId);
  assert.ok(doc, 'document readable');
  assert.equal(doc.recovered, true);
  assert.match(doc.text, /Heading line/);
});

test('humanizer: revise, review, accept and apply to the document', { skip: OFFLINE }, async () => {
  const { page } = ctx;
  const d = await api((html) => window.folio.docs.create({ title: 'Humanizer target', html }), SAMPLE.split('\n\n').map((p) => `<p>${p}</p>`).join(''));
  await api(() => window.location.reload());
  await page.waitForSelector('.sidebar');
  await page.click('.nav-item:has-text("Documents")');
  await page.click(`.view:not([hidden]) .doc-card:has-text("Humanizer target")`);
  await page.waitForSelector('.ProseMirror p');
  await page.click('.ed-head button:has-text("Humanize")');
  await page.waitForSelector('.hz-top .source-chip:has-text("Humanizer target")');
  await page.waitForSelector('.analysis .stat');
  await shot('humanizer-input');
  await page.click('.hz-input-foot button:has-text("Revise")');
  await page.waitForSelector('.run-panel');
  await shot('humanizer-running');
  await page.waitForSelector('.paras .para', { timeout: 180000 });
  await page.waitForSelector('.run-panel', { state: 'detached', timeout: 180000 });
  await shot('humanizer-review');
  const cards = await page.$$('.paras .para');
  assert.equal(cards.length, 2);
  // Meaning check: protected details must survive.
  const session = await api(async () => {
    const list = await window.folio.sessions.list();
    return window.folio.sessions.get(list[0].id);
  });
  const v1 = session.versions[0];
  const revised = v1.paragraphs.map((p) => p.text).join('\n');
  for (const must of ['2 billion', '2024', 'Smith (2021)', '"most small firms never measure engagement properly"', 'Instagram']) {
    assert.ok(revised.includes(must), `revision keeps ${must}`);
  }
  assert.ok(v1.metrics.after.formulaicCount < v1.metrics.before.formulaicCount, 'fewer formulaic phrases');

  await page.click('.review-bar button:has-text("Accept all")');
  await page.click('button:has-text("Apply to document")');
  await page.click('.modal button:has-text("Apply changes")');
  await page.waitForSelector('.toast:has-text("Applied")', { timeout: 10000 });
  await page.waitForSelector('.save-state:has-text("Saved")', { timeout: 8000 });
  const after = await api((id) => window.folio.docs.get(id), d.id);
  assert.ok(!after.text.includes("In today's fast-paced digital landscape"), 'document updated');
  const hist = await api((id) => window.folio.docs.history(id), d.id);
  assert.ok(hist.some((h) => h.reason === 'before humanizer changes'), 'snapshot taken before applying');
  await shot('editor-after-apply');
});

test('humanizer: feedback produces a new version that meets its targets', { skip: OFFLINE }, async () => {
  const { page } = ctx;
  await page.click('.nav-item:has-text("Humanizer")');
  await page.click('.composer .chip:has-text("More concise")');
  await page.click('.composer button:has-text("Revise")');
  await page.waitForSelector('.versions button:has-text("v2")', { timeout: 180000 });
  await page.waitForSelector('.run-panel', { state: 'detached', timeout: 180000 });
  const session = await api(async () => {
    const list = await window.folio.sessions.list();
    return window.folio.sessions.get(list[0].id);
  });
  const [v1, v2] = session.versions;
  assert.equal(v2.mode, 'refine');
  assert.ok(v2.metrics.after.wordCount < v1.metrics.after.wordCount, `v2 shorter (${v1.metrics.after.wordCount} → ${v2.metrics.after.wordCount})`);
  await shot('humanizer-v2');
});

test('humanizer: provider failure is reported and retryable', async () => {
  const { page } = ctx;
  const saved = await api(() => window.folio.settings.get());
  await api(() => window.folio.settings.update({ roles: { rewrite: [{ provider: 'openrouter', model: 'some/paid-model' }] } }));
  await page.click('.nav-item:has-text("Humanizer")');
  if (await page.$('.hz-top button:has-text("Edit input")')) await page.click('.hz-top button:has-text("Edit input")');
  await page.fill('.hl-text', 'A short passage that needs a revision so the failure path can be exercised properly.');
  await page.click('.hz-input-foot button:has-text("Revise")');
  await page.waitForSelector('.toast.error', { timeout: 30000 });
  const msg = await page.textContent('.toast.error');
  assert.match(msg, /not free|did not complete|could not/i);
  await shot('humanizer-error');
  await api((roles) => window.folio.settings.update({ roles }), saved.roles);
});

test('assistant answers a question about the open document', { skip: OFFLINE }, async () => {
  const { page } = ctx;
  await page.click('.nav-item:has-text("Documents")');
  await page.click('.view:not([hidden]) .doc-card:has-text("Humanizer target")');
  await page.waitForSelector('.ProseMirror p');
  await page.keyboard.press('Control+j');
  await page.waitForSelector('.assistant');
  await page.fill('.as-input textarea', 'Which platform and which year does this document mention? Answer in one sentence.');
  await page.press('.as-input textarea', 'Enter');
  await page.waitForSelector('.msg.assistant .meta', { timeout: 90000 });
  const reply = await page.textContent('.msg.assistant .bubble-text');
  assert.match(reply, /Instagram/);
  assert.match(reply, /2024/);
  await shot('assistant');
  await page.keyboard.press('Control+j');
});

test('news page retrieves items with dates and source status', { skip: OFFLINE }, async () => {
  const r = await api(() => window.folio.news.refresh());
  assert.ok(r.items.length > 0, 'some items');
  assert.ok(r.items.every((i) => i.retrievedAt && /^https?:/.test(i.url)));
  assert.ok(r.sources.length >= 5);
});

test('window resizes without layout errors', async () => {
  const { app, page } = ctx;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 640));
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false);
  await shot('small-window');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  assert.deepEqual(ctx.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});
