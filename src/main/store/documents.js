// Document library. Each document is one JSON file holding the editor JSON
// (source of truth), its HTML rendering and a plain-text copy for search and
// counts. index.json caches the metadata for the library view and is rebuilt
// from the document files whenever it is missing or unreadable.
//
// Version history: a snapshot is taken at most every SNAPSHOT_INTERVAL while
// a document is being edited, and always before an operation that replaces
// content (humanizer apply, assistant edit, import into, restore).

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJsonAtomic, readJsonSafe, readJson, newId, removeFile } from './fsstore.js';
import { htmlToText } from '../files/import.js';
import { countWords } from '../../shared/text/tokenize.js';

const SNAPSHOT_INTERVAL = 5 * 60 * 1000;
const MAX_SNAPSHOTS = 40;
const TRASH_RETENTION = 30 * 24 * 3600 * 1000;

export function createDocumentStore(root) {
  const dir = ensureDir(path.join(root, 'documents'));
  const indexFile = path.join(dir, 'index.json');
  const docFile = (id) => path.join(dir, `${id}.json`);
  const histDir = (id) => path.join(dir, `${id}.history`);
  let index = null;
  const lastSnapshot = new Map();

  function meta(doc) {
    return {
      id: doc.id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
      wordCount: doc.wordCount || 0, preview: (doc.text || '').slice(0, 220),
      pinned: Boolean(doc.pinned), trashedAt: doc.trashedAt || null, source: doc.source || null,
    };
  }

  function rebuildIndex() {
    const entries = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/^d[a-z0-9]+\.json$/.test(f)) continue;
      const { data } = readJsonSafe(path.join(dir, f));
      if (data && data.id) entries.push(meta(data));
    }
    index = { version: 1, documents: entries };
    writeJsonAtomic(indexFile, index);
    return index;
  }

  function loadIndex() {
    if (index) return index;
    const { data } = readJsonSafe(indexFile);
    if (!data || !Array.isArray(data.documents)) return rebuildIndex();
    index = data;
    return index;
  }

  function putMeta(doc) {
    const idx = loadIndex();
    const i = idx.documents.findIndex((d) => d.id === doc.id);
    if (i >= 0) idx.documents[i] = meta(doc); else idx.documents.push(meta(doc));
    writeJsonAtomic(indexFile, idx);
  }

  function snapshot(doc, reason = 'autosave') {
    const hd = ensureDir(histDir(doc.id));
    const at = Date.now();
    writeJsonAtomic(path.join(hd, `${at}.json`), {
      at, reason, title: doc.title, json: doc.json, html: doc.html, text: doc.text, wordCount: doc.wordCount,
    });
    lastSnapshot.set(doc.id, at);
    const files = fs.readdirSync(hd).filter((f) => /^\d+\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) removeFile(path.join(hd, f));
  }

  return {
    list({ trashed = false } = {}) {
      const idx = loadIndex();
      const now = Date.now();
      // Purge trash older than the retention period.
      for (const d of idx.documents.filter((x) => x.trashedAt && now - x.trashedAt > TRASH_RETENTION)) this.destroy(d.id);
      return loadIndex().documents
        .filter((d) => (trashed ? d.trashedAt : !d.trashedAt))
        .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
    },

    get(id) {
      const { data, recovered } = readJsonSafe(docFile(id));
      if (!data) return null;
      return { ...data, recovered };
    },

    create({ title = 'Untitled document', html = '', json = null, text = '', wordCount = 0, source = null } = {}) {
      const now = Date.now();
      // Callers may pass HTML only; derive the plain text used for search and counts.
      if (html && !text) { text = htmlToText(html); wordCount = countWords(text); }
      const doc = { id: newId('d'), title, html, json, text, wordCount, createdAt: now, updatedAt: now, pinned: false, trashedAt: null, source };
      writeJsonAtomic(docFile(doc.id), doc);
      putMeta(doc);
      return doc;
    },

    /** Save editor content. Returns the saved metadata. */
    save(id, patch, { snapshotReason = null } = {}) {
      const current = readJson(docFile(id));
      if (!current) throw new Error('Document not found');
      const contentChanged = ['html', 'json', 'title'].some((k) => k in patch);
      const due = !lastSnapshot.has(id) || Date.now() - lastSnapshot.get(id) > SNAPSHOT_INTERVAL;
      if (snapshotReason) snapshot(current, snapshotReason);
      else if (contentChanged && due && current.text) snapshot(current, 'autosave');
      const allowed = ['title', 'html', 'json', 'text', 'wordCount', 'pinned'];
      const next = { ...current };
      for (const k of allowed) if (k in patch) next[k] = patch[k];
      if (contentChanged) next.updatedAt = Date.now();
      writeJsonAtomic(docFile(id), next);
      putMeta(next);
      return meta(next);
    },

    trash(id) {
      const d = readJson(docFile(id));
      if (!d) return;
      d.trashedAt = Date.now();
      writeJsonAtomic(docFile(id), d);
      putMeta(d);
    },

    restore(id) {
      const d = readJson(docFile(id));
      if (!d) return;
      d.trashedAt = null;
      writeJsonAtomic(docFile(id), d);
      putMeta(d);
    },

    destroy(id) {
      removeFile(docFile(id));
      fs.rmSync(histDir(id), { recursive: true, force: true });
      const idx = loadIndex();
      idx.documents = idx.documents.filter((d) => d.id !== id);
      writeJsonAtomic(indexFile, idx);
    },

    duplicate(id) {
      const d = readJson(docFile(id));
      if (!d) return null;
      return this.create({ title: `${d.title} (copy)`, html: d.html, json: d.json, text: d.text, wordCount: d.wordCount });
    },

    snapshot(id, reason) {
      const d = readJson(docFile(id));
      if (d) snapshot(d, reason);
    },

    history(id) {
      const hd = histDir(id);
      if (!fs.existsSync(hd)) return [];
      return fs.readdirSync(hd).filter((f) => /^\d+\.json$/.test(f)).sort().reverse().map((f) => {
        const { data } = readJsonSafe(path.join(hd, f));
        return data ? { at: data.at, reason: data.reason, title: data.title, wordCount: data.wordCount, preview: (data.text || '').slice(0, 160) } : null;
      }).filter(Boolean);
    },

    getSnapshot(id, at) {
      return readJson(path.join(histDir(id), `${Number(at)}.json`));
    },

    /** Replace content with a snapshot, snapshotting the current state first. */
    restoreSnapshot(id, at) {
      const snap = this.getSnapshot(id, at);
      if (!snap) throw new Error('Version not found');
      return this.save(id, { html: snap.html, json: snap.json, text: snap.text, wordCount: snap.wordCount }, { snapshotReason: 'before restore' });
    },

    dir,
  };
}
