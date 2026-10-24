// Crash-safe JSON persistence. A write goes to a temporary file which is then
// renamed over the target, so a crash mid-write never leaves a half-written
// file. The previous contents are kept as <file>.bak and used automatically
// if the main file is ever unreadable.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  const body = JSON.stringify(data, null, 0);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); } catch { /* a missing backup is not fatal */ }
  }
  // Windows can briefly lock a file that antivirus or indexing is reading.
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); break; } catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
      const until = Date.now() + 40 * (i + 1);
      while (Date.now() < until) { /* short synchronous back-off */ }
    }
  }
}

/** Read JSON, falling back to the .bak copy. Returns { data, recovered }. */
export function readJsonSafe(file, fallback = null) {
  for (const [candidate, recovered] of [[file, false], [`${file}.bak`, true]]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return { data, recovered };
    } catch { /* try the next candidate */ }
  }
  return { data: fallback, recovered: false };
}

export function readJson(file, fallback = null) {
  return readJsonSafe(file, fallback).data;
}

export function newId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export function removeFile(file) {
  for (const f of [file, `${file}.bak`]) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
}
