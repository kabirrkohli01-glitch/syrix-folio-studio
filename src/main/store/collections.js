// Small file-per-item collections for profiles, humanizer sessions and
// assistant threads, plus the settings file.

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJsonAtomic, readJson, newId, removeFile } from './fsstore.js';
import { DEFAULT_ROLES } from '../ai/providers.js';
import { DEFAULT_CONTROLS } from '../../shared/humanizer/controls.js';

export function createCollection(root, name, prefix, { max = Infinity } = {}) {
  const dir = ensureDir(path.join(root, name));
  const file = (id) => path.join(dir, `${id}.json`);
  const valid = (id) => typeof id === 'string' && /^[a-z0-9_-]+$/i.test(id);
  return {
    dir,
    list() {
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson(path.join(dir, f)))
        .filter(Boolean)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    get(id) { return valid(id) ? readJson(file(id)) : null; },
    put(item) {
      const now = Date.now();
      const next = { ...item, id: item.id || newId(prefix), createdAt: item.createdAt || now, updatedAt: now };
      writeJsonAtomic(file(next.id), next);
      if (Number.isFinite(max)) {
        const all = this.list();
        for (const old of all.slice(max)) removeFile(file(old.id));
      }
      return next;
    },
    remove(id) { if (valid(id)) removeFile(file(id)); },
  };
}

const ROLES_VERSION = 2;

export const DEFAULT_SETTINGS = {
  roles: DEFAULT_ROLES,
  rolesVersion: ROLES_VERSION,
  privacy: { mode: 'cloud' }, // cloud | local — local restricts every role to Ollama
  editor: { page: 'dark', fontSize: 18, width: 760, spellcheck: true },
  humanizer: { defaultPreset: 'natural', audit: true, autoRepair: true, controls: DEFAULT_CONTROLS },
  syrix: { envPath: '' },
  news: { newsApi: true, arxiv: true, feeds: true },
  firstRun: true,
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

export function createSettings(root) {
  const file = path.join(root, 'settings.json');
  const stored = readJson(file, {});
  let cache = merge(DEFAULT_SETTINGS, stored);
  // Model chains saved before the current defaults are replaced with them.
  if (stored.roles && (stored.rolesVersion || 1) < ROLES_VERSION) {
    cache = { ...cache, roles: DEFAULT_ROLES, rolesVersion: ROLES_VERSION };
    writeJsonAtomic(file, cache);
  }
  return {
    get() { return cache; },
    update(patch) {
      cache = merge(cache, patch);
      writeJsonAtomic(file, cache);
      return cache;
    },
    reset(section) {
      cache = { ...cache, [section]: DEFAULT_SETTINGS[section] };
      writeJsonAtomic(file, cache);
      return cache;
    },
  };
}
