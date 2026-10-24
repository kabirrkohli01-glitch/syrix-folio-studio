// Credential resolution. Keys are read in the main process only and are never
// sent to the renderer; the interface receives set/unset status and the
// source file, never a value.
//
// Precedence: process environment > Folio's own .env (in the user-data
// folder) > the SYRIX .env (reused so a SYRIX install needs no extra setup).

import fs from 'node:fs';
import path from 'node:path';

const KEY_NAMES = ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_2', 'NEWS_API_KEY', 'OLLAMA_HOST'];

let state = { folioEnvPath: null, syrixEnvPath: null, folio: {}, syrix: {} };

export function parseDotenv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

function readEnvFile(p) {
  try { return p && fs.existsSync(p) ? parseDotenv(fs.readFileSync(p, 'utf8')) : {}; } catch { return {}; }
}

export function initEnv({ userDataDir, syrixEnvPath }) {
  const folioEnvPath = path.join(userDataDir, '.env');
  state = {
    folioEnvPath,
    syrixEnvPath: syrixEnvPath || null,
    folio: readEnvFile(folioEnvPath),
    syrix: readEnvFile(syrixEnvPath),
  };
}

export function reloadEnv() {
  state.folio = readEnvFile(state.folioEnvPath);
  state.syrix = readEnvFile(state.syrixEnvPath);
}

export function getKey(name) {
  if (process.env[name]) return process.env[name];
  if (state.folio[name]) return state.folio[name];
  if (state.syrix[name]) return state.syrix[name];
  return '';
}

function sourceOf(name) {
  if (process.env[name]) return 'environment';
  if (state.folio[name]) return 'folio';
  if (state.syrix[name]) return 'syrix';
  return null;
}

/** Presence of each credential, without values. */
export function keyStatus() {
  return KEY_NAMES.map((name) => ({ name, set: Boolean(getKey(name)), source: sourceOf(name) }));
}

export function envPaths() {
  return { folio: state.folioEnvPath, syrix: state.syrixEnvPath, syrixFound: Boolean(state.syrixEnvPath && fs.existsSync(state.syrixEnvPath)) };
}

/**
 * Write or clear one key in Folio's own .env. Only the named line changes;
 * other lines and comments are preserved.
 */
export function setFolioKey(name, value) {
  if (!KEY_NAMES.includes(name)) throw new Error(`Unknown setting ${name}`);
  let lines = [];
  try { lines = fs.readFileSync(state.folioEnvPath, 'utf8').split(/\r?\n/); } catch { lines = []; }
  const re = new RegExp(`^\\s*${name}\\s*=`);
  lines = lines.filter((l) => !re.test(l));
  if (value) lines.push(`${name}=${String(value).replace(/[\r\n]/g, '')}`);
  fs.mkdirSync(path.dirname(state.folioEnvPath), { recursive: true });
  fs.writeFileSync(state.folioEnvPath, lines.filter((l, i) => l || i < lines.length - 1).join('\n') + '\n', { mode: 0o600 });
  reloadEnv();
}
