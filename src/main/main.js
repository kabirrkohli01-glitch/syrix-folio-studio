// SYRIX Folio — Electron main process.
//
// The main process owns everything that touches the disk, the network or a
// credential: storage, file conversion, AI providers, news retrieval. The
// renderer is sandboxed (contextIsolation, no Node) and reaches these through
// the narrow API in preload.cjs. Every IPC handler returns
// { ok: true, data } or { ok: false, error: { message, kind } } so failures
// reach the interface with a readable message instead of a generic
// "Error invoking remote method".

import { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { initEnv, keyStatus, envPaths, setFolioKey, reloadEnv } from './env.js';
import { catalogue, testTarget, rateSnapshot, describeError } from './ai/providers.js';
import { chainFor as resolveChain } from './ai/roles.js';
import { createDocumentStore } from './store/documents.js';
import { createCollection, createSettings } from './store/collections.js';
import { createHumanizer } from './humanizer/pipeline.js';
import { createProfiles } from './profiles.js';
import { createAssistant, ACTIONS } from './assistant.js';
import { createNews } from './news.js';
import { createLab } from './lab/lab.js';
import { importFile, extractText, setOcrCacheDir, ImportError, IMPORT_EXTENSIONS } from './files/import.js';
import { countWords } from '../shared/text/tokenize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

app.setName('SYRIX Folio');
if (process.env.FOLIO_USER_DATA) app.setPath('userData', process.env.FOLIO_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let services = null;
const isDev = Boolean(process.env.FOLIO_DEV);

function log(...args) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'folio.log'), `${new Date().toISOString()} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
  } catch { /* logging must never throw */ }
}

function initServices() {
  const userData = app.getPath('userData');
  const settings = createSettings(userData);
  initEnv({ userDataDir: userData, syrixEnvPath: settings.get().syrix?.envPath });
  setOcrCacheDir(path.join(userData, 'ocr'));
  const chainFor = (role) => resolveChain(settings, role);
  const docs = createDocumentStore(userData);
  const sessions = createCollection(userData, 'sessions', 'h', { max: 80 });
  const profileCollection = createCollection(userData, 'profiles', 'p');
  const threads = createCollection(userData, 'threads', 't', { max: 200 });
  const profiles = createProfiles({ collection: profileCollection, chainFor });
  const humanizer = createHumanizer({ chainFor, sessions, profiles: profileCollection });
  const assistant = createAssistant({ chainFor });
  const news = createNews(userData);
  const lab = createLab({ root: userData, chainFor });
  return { userData, settings, docs, sessions, profiles, humanizer, assistant, threads, news, lab, chainFor };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Register an IPC handler with uniform error wrapping. */
function handle(name, fn) {
  ipcMain.handle(`folio:${name}`, async (event, ...args) => {
    if (event.senderFrame && !event.senderFrame.url.startsWith('file://')) return { ok: false, error: { message: 'Untrusted sender', kind: 'security' } };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      if (e?.kind !== 'aborted') log(`IPC ${name} failed:`, e);
      return { ok: false, error: { message: e instanceof ImportError ? e.message : (e?.kind ? describeError(e) : e?.message || String(e)), detail: e?.message, kind: e?.kind || null } };
    }
  });
}

function registerIpc() {
  const s = services;

  // App
  handle('app:info', () => ({
    version: app.getVersion(), userData: s.userData, platform: process.platform,
    electron: process.versions.electron, firstRun: s.settings.get().firstRun,
  }));
  handle('app:openDataFolder', () => shell.openPath(s.userData));
  handle('app:openExternal', (url) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('Only web links can be opened.');
    return shell.openExternal(String(url));
  });

  // Settings and providers
  handle('settings:get', () => s.settings.get());
  handle('settings:update', (patch) => {
    const next = s.settings.update(patch || {});
    if (patch?.syrix?.envPath !== undefined) initEnv({ userDataDir: s.userData, syrixEnvPath: next.syrix.envPath });
    return next;
  });
  handle('settings:reset', (section) => s.settings.reset(section));
  handle('providers:keys', () => ({ keys: keyStatus(), paths: envPaths() }));
  handle('providers:setKey', (name, value) => { setFolioKey(name, value); return keyStatus(); });
  handle('providers:reload', () => { reloadEnv(); return keyStatus(); });
  handle('providers:catalogue', () => catalogue());
  handle('providers:test', (target) => testTarget(target));
  handle('providers:rates', () => rateSnapshot());
  handle('providers:chain', (role) => s.chainFor(role));

  // Documents
  handle('docs:list', (opts) => s.docs.list(opts || {}));
  handle('docs:get', (id) => s.docs.get(id));
  handle('docs:create', (opts) => s.docs.create(opts || {}));
  handle('docs:save', (id, patch, opts) => s.docs.save(id, patch || {}, opts || {}));
  handle('docs:trash', (id) => s.docs.trash(id));
  handle('docs:restore', (id) => s.docs.restore(id));
  handle('docs:destroy', (id) => s.docs.destroy(id));
  handle('docs:duplicate', (id) => s.docs.duplicate(id));
  handle('docs:history', (id) => s.docs.history(id));
  handle('docs:snapshot', (id, reason) => s.docs.snapshot(id, reason));
  handle('docs:getSnapshot', (id, at) => s.docs.getSnapshot(id, at));
  handle('docs:restoreSnapshot', (id, at) => s.docs.restoreSnapshot(id, at));

  // Files
  const importFilters = [
    { name: 'Documents', extensions: IMPORT_EXTENSIONS },
    { name: 'Word', extensions: ['docx'] },
    { name: 'Text and Markdown', extensions: ['txt', 'md', 'markdown'] },
    { name: 'PDF', extensions: ['pdf'] },
    { name: 'Images (OCR)', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'] },
  ];
  async function importPaths(paths, { create = true } = {}) {
    const imported = [];
    const failed = [];
    for (const p of paths) {
      try {
        const r = await importFile(p);
        if (create) {
          const doc = s.docs.create({ title: r.title, html: r.html, text: r.text, wordCount: countWords(r.text), source: { kind: r.kind, name: path.basename(p) } });
          imported.push({ id: doc.id, title: doc.title, warnings: r.warnings, name: path.basename(p) });
        } else {
          imported.push({ title: r.title, html: r.html, text: r.text, warnings: r.warnings, name: path.basename(p) });
        }
      } catch (e) {
        failed.push({ name: path.basename(p), message: e instanceof ImportError ? e.message : `Could not import: ${e.message}` });
        if (!(e instanceof ImportError)) log('import failed', p, e);
      }
    }
    return { imported, failed };
  }
  handle('files:importDialog', async (opts = {}) => {
    const r = await dialog.showOpenDialog(win, { title: opts.insert ? 'Insert a file' : 'Import documents', properties: opts.insert ? ['openFile'] : ['openFile', 'multiSelections'], filters: importFilters });
    if (r.canceled || !r.filePaths.length) return { canceled: true, imported: [], failed: [] };
    return importPaths(r.filePaths, { create: !opts.insert });
  });
  handle('files:importPaths', (paths, opts = {}) => importPaths((paths || []).filter((p) => typeof p === 'string'), { create: !opts.insert }));
  handle('files:samplesDialog', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add writing samples', properties: ['openFile', 'multiSelections'], filters: importFilters });
    if (r.canceled) return { canceled: true, files: [] };
    const files = [];
    for (const p of r.filePaths) {
      try { files.push({ name: path.basename(p), ...(await extractText(p)) }); } catch (e) { files.push({ name: path.basename(p), error: e.message }); }
    }
    return { files };
  });
  handle('files:samplesFromPaths', async (paths) => {
    const files = [];
    for (const p of paths || []) {
      try { files.push({ name: path.basename(p), ...(await extractText(p)) }); } catch (e) { files.push({ name: path.basename(p), error: e.message }); }
    }
    return { files };
  });
  handle('files:saveBytes', async ({ defaultName, filters, data }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(data));
    return { path: r.filePath };
  });
  handle('files:saveText', async ({ defaultName, filters, text }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, String(text), 'utf8');
    return { path: r.filePath };
  });
  handle('files:printPdf', async ({ html, defaultName, targetPath }) => {
    let out = targetPath || null;
    if (!out) {
      const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return { canceled: true };
      out = r.filePath;
    }
    const tmp = path.join(os.tmpdir(), `folio-print-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    try {
      await printer.loadFile(tmp);
      const pdf = await printer.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'custom', top: 0.8, bottom: 0.8, left: 0.85, right: 0.85 }, displayHeaderFooter: false });
      fs.writeFileSync(out, pdf);
      return { path: out, bytes: pdf.length };
    } finally {
      printer.destroy();
      fs.rm(tmp, { force: true }, () => {});
    }
  });
  handle('files:showInFolder', (p) => shell.showItemInFolder(String(p)));

  // Humanizer
  handle('humanizer:run', (runId, req) => {
    s.humanizer.run(runId, req, (e) => send('folio:humanizer', e))
      .then((session) => send('folio:humanizer', { runId, type: 'done', session }))
      .catch((e) => {
        if (e?.kind !== 'aborted') log('humanizer failed', e);
        send('folio:humanizer', { runId, type: e?.kind === 'aborted' ? 'cancelled' : 'error', error: { message: describeError(e), detail: e?.message, kind: e?.kind || null } });
      });
    return { started: true };
  });
  handle('humanizer:cancel', (runId) => s.humanizer.cancel(runId));
  handle('sessions:list', () => s.sessions.list().map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt, versions: (x.versions || []).length, words: x.analysis?.wordCount || 0, source: x.source || null })));
  handle('sessions:get', (id) => s.sessions.get(id));
  handle('sessions:update', (id, patch) => {
    const cur = s.sessions.get(id);
    if (!cur) throw new Error('Session not found');
    const allowed = {};
    for (const k of ['title', 'decisions', 'edits', 'appliedAt']) if (k in patch) allowed[k] = patch[k];
    return s.sessions.put({ ...cur, ...allowed });
  });
  handle('sessions:remove', (id) => s.sessions.remove(id));

  // Profiles
  handle('profiles:list', () => s.profiles.list());
  handle('profiles:get', (id) => s.profiles.get(id));
  handle('profiles:create', (opts) => s.profiles.create(opts || {}));
  handle('profiles:update', (id, patch) => s.profiles.update(id, patch || {}));
  handle('profiles:remove', (id) => s.profiles.remove(id));
  handle('profiles:addSamples', (id, samples) => s.profiles.addSamples(id, samples || []));
  handle('profiles:removeSample', (id, sampleId) => s.profiles.removeSample(id, sampleId));
  handle('profiles:pinExemplar', (id, text, pinned) => s.profiles.pinExemplar(id, text, pinned));
  handle('profiles:summarise', (id) => s.profiles.summarise(id));

  // Assistant
  handle('assistant:actions', () => Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, { label: v.label, needsSelection: v.needsSelection, edit: Boolean(v.edit) }])));
  handle('assistant:send', (runId, req) => s.assistant.send(runId, req, (e) => send('folio:assistant', e)));
  handle('assistant:cancel', (runId) => s.assistant.cancel(runId));
  handle('threads:get', (docId) => s.threads.get(`t${String(docId).replace(/[^a-z0-9]/gi, '')}`));
  handle('threads:save', (docId, messages) => s.threads.put({ id: `t${String(docId).replace(/[^a-z0-9]/gi, '')}`, docId, messages: (messages || []).slice(-100) }));
  handle('threads:clear', (docId) => s.threads.remove(`t${String(docId).replace(/[^a-z0-9]/gi, '')}`));

  // News
  handle('news:cached', () => s.news.cached());
  handle('news:refresh', () => s.news.refresh());
  handle('news:sources', () => s.news.sources());

  // Detector lab
  handle('lab:state', () => s.lab.state());
  handle('lab:addSamples', (samples) => s.lab.addSamples(samples || []));
  handle('lab:removeSample', (id) => s.lab.removeSample(id));
  handle('lab:buildCorpus', (opts) => s.lab.buildCorpus(opts || {}, (e) => send('folio:lab', e)));
  handle('lab:runEvaluation', (opts) => s.lab.runEvaluation(opts || {}, (e) => send('folio:lab', e)));
  handle('lab:cancel', () => s.lab.cancel());
  handle('lab:removeRun', (id) => s.lab.removeRun(id));
  handle('lab:getRun', (id) => s.lab.getRun(id));
  handle('lab:exportRun', async (id) => {
    const run = s.lab.getRun(id);
    if (!run) throw new Error('Run not found');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `folio-detector-evaluation-${id}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(run, null, 2));
    return { path: r.filePath };
  });

  // Close handshake: the renderer confirms its pending save has been written.
  ipcMain.on('folio:flushed', () => { flushResolve?.(); });
}

let flushResolve = null;
let quitting = false;

function createWindow() {
  const bounds = services.settings.get().window || {};
  win = new BrowserWindow({
    width: bounds.width || 1440,
    height: bounds.height || 920,
    x: bounds.x, y: bounds.y,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0a0a0b',
    title: 'SYRIX Folio',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0a0b', symbolColor: '#b9b9bd', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: services.settings.get().editor?.spellcheck !== false,
      devTools: isDev,
    },
  });
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'dist', 'renderer', 'index.html'));

  // Links never navigate the app window; web links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log('renderer gone', details);
    if (details.reason !== 'clean-exit' && !quitting) win.reload();
  });
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const sug of params.dictionarySuggestions.slice(0, 5)) items.push({ label: sug, click: () => win.webContents.replaceMisspelling(sug) });
      if (params.dictionarySuggestions.length) items.push({ type: 'separator' });
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    services.settings.update({ window: { ...b, maximized: win.isMaximized() } });
  };
  win.on('resize', debounce(saveBounds, 600));
  win.on('move', debounce(saveBounds, 600));

  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    saveBounds();
    // Ask the renderer to flush any pending autosave, then close regardless after 2.5 s.
    const done = new Promise((resolve) => { flushResolve = resolve; });
    send('folio:flush', {});
    Promise.race([done, new Promise((r) => setTimeout(r, 2500))]).then(() => {
      quitting = true;
      win.close();
    });
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  // The renderer makes no network requests of its own.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith('file://') || details.url.startsWith('devtools://') || details.url.startsWith('data:') || details.url.startsWith('blob:');
    cb({ cancel: !ok });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  services = initServices();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', (e) => log('uncaught', e));
process.on('unhandledRejection', (e) => log('unhandled rejection', e));
