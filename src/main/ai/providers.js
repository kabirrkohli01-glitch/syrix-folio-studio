// AI provider layer. Three free back ends, all reached from the main process:
//   groq        — Groq free tier (OpenAI-compatible API)
//   openrouter  — OpenRouter, restricted to ":free" model ids
//   ollama      — a local Ollama server (offline, private)
//
// Each task role has an ordered chain of targets. A call walks the chain:
// it paces itself against the rate-limit headers the provider returns,
// retries transient failures, and falls through to the next target on
// errors that a retry will not fix. Paid models are refused outright.

import { getKey } from '../env.js';

export const PROVIDERS = {
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1', keyName: 'GROQ_API_KEY', local: false },
  openrouter: { name: 'OpenRouter (free models)', base: 'https://openrouter.ai/api/v1', keyName: 'OPENROUTER_API_KEY', local: false },
  ollama: { name: 'Ollama (local)', base: null, keyName: null, local: true },
};

// Groq models known to be on the free tier. Output-token caps reflect the
// free tier's per-minute limits for each model.
export const GROQ_MODELS = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', reasoning: true, maxOutput: 6000 },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', reasoning: true, maxOutput: 6000 },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', reasoning: false, maxOutput: 900 },
];

export const DEFAULT_ROLES = {
  rewrite: [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'ollama', model: 'qwen3:8b' },
  ],
  // The meaning check runs on a different model from rewriting so the two
  // draw on separate free-tier allowances and can run at the same time.
  audit: [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'ollama', model: 'qwen3:8b' },
  ],
  assistant: [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'ollama', model: 'qwen3:8b' },
  ],
  profile: [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'ollama', model: 'qwen3:8b' },
  ],
};

export class AIError extends Error {
  constructor(message, { kind = 'unknown', provider = null, model = null, status = null, retryAfterMs = null, attempts = [] } = {}) {
    super(message);
    this.name = 'AIError';
    this.kind = kind;
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.attempts = attempts;
  }
}

const KIND_MESSAGES = {
  auth: 'The API key was rejected. Check it in Settings → AI providers.',
  'no-key': 'No API key is configured for this provider.',
  payment: 'This model requires payment, so Folio will not use it.',
  'not-free': 'This model is not free, so Folio will not use it.',
  'not-found': 'The model is not available from this provider.',
  quota: 'The free daily allowance for this model is used up.',
  rate: 'The free per-minute allowance is used up. Folio waits and retries automatically.',
  server: 'The provider returned a server error.',
  network: 'Could not reach the provider. Check the internet connection.',
  timeout: 'The provider took too long to respond.',
  unavailable: 'The local Ollama server is not running.',
  aborted: 'Cancelled.',
};

export function describeError(err) {
  if (!err) return 'Unknown error';
  if (err.kind && KIND_MESSAGES[err.kind]) return KIND_MESSAGES[err.kind];
  return err.message || String(err);
}

// ---------------------------------------------------------------------------
// Rate-limit tracking

const limits = new Map(); // "provider:model" → { tokens, tokenReset, requests, requestReset, blockedUntil, reason }

/** Parse Groq-style durations such as "2m52.8s", "2.047s", "450ms". */
export function parseDuration(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str) * 1000;
  let ms = 0; let matched = false;
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const v = Number(m[1]);
    ms += m[2] === 'h' ? v * 3600000 : m[2] === 'm' ? v * 60000 : m[2] === 's' ? v * 1000 : v;
  }
  return matched ? ms : null;
}

function recordHeaders(key, headers) {
  const cur = limits.get(key) || {};
  const now = Date.now();
  const tok = headers.get('x-ratelimit-remaining-tokens');
  const tokReset = parseDuration(headers.get('x-ratelimit-reset-tokens'));
  const req = headers.get('x-ratelimit-remaining-requests');
  const reqReset = parseDuration(headers.get('x-ratelimit-reset-requests'));
  if (tok != null) { cur.tokens = Number(tok); cur.tokenReset = now + (tokReset || 0); }
  if (req != null) { cur.requests = Number(req); cur.requestReset = now + (reqReset || 0); }
  limits.set(key, cur);
}

function retryAfterFrom(res, bodyText) {
  const h = res.headers.get('retry-after');
  if (h) { const v = parseDuration(h); if (v != null) return v; }
  const m = String(bodyText || '').match(/try again in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i);
  if (m) return parseDuration(m[1]);
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset && /^\d{12,}$/.test(reset)) return Math.max(0, Number(reset) - Date.now());
  return null;
}

/** Milliseconds to wait before a request of `estTokens` fits the known budget. */
function waitNeeded(key, estTokens) {
  const l = limits.get(key);
  if (!l) return 0;
  const now = Date.now();
  if (l.blockedUntil && l.blockedUntil > now) return l.blockedUntil - now;
  if (l.requests === 0 && l.requestReset > now) return l.requestReset - now;
  if (l.tokens != null && l.tokenReset > now && estTokens > l.tokens) return l.tokenReset - now;
  return 0;
}

export function rateSnapshot() {
  const now = Date.now();
  return [...limits.entries()].map(([key, l]) => ({
    key, tokens: l.tokens ?? null, requests: l.requests ?? null,
    blockedFor: l.blockedUntil && l.blockedUntil > now ? Math.round((l.blockedUntil - now) / 1000) : 0,
    reason: l.reason || null,
  }));
}

// ---------------------------------------------------------------------------
// Low-level calls

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AIError('Cancelled', { kind: 'aborted' }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new AIError('Cancelled', { kind: 'aborted' })); }, { once: true });
  });
}

export function assertFree(provider, model) {
  if (provider === 'openrouter' && !String(model).endsWith(':free')) {
    throw new AIError(`${model} is a paid OpenRouter model`, { kind: 'not-free', provider, model });
  }
  if (!PROVIDERS[provider]) throw new AIError(`Unknown provider ${provider}`, { kind: 'not-found', provider, model });
}

export function ollamaHost() {
  return (getKey('OLLAMA_HOST') || 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

async function readSSE(res, onToken) {
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const d = j.choices?.[0]?.delta?.content;
        if (d) { text += d; onToken?.(d); }
        if (j.usage || j.x_groq?.usage) usage = j.usage || j.x_groq.usage;
        if (j.error) throw new AIError(j.error.message || 'Stream error', { kind: 'server' });
      } catch (e) { if (e instanceof AIError) throw e; }
    }
  }
  return { text, usage };
}

async function readNDJSON(res, onToken) {
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (j.error) throw new AIError(j.error, { kind: 'server', provider: 'ollama' });
        const d = j.message?.content;
        if (d) { text += d; onToken?.(d); }
        if (j.done) usage = { prompt_tokens: j.prompt_eval_count, completion_tokens: j.eval_count };
      } catch (e) { if (e instanceof AIError) throw e; }
    }
  }
  return { text, usage };
}

function classifyStatus(status, bodyText) {
  if (status === 401 || status === 403) return /agentic|harness/i.test(bodyText) ? 'not-found' : 'auth';
  if (status === 402) return 'payment';
  if (status === 404 || status === 410) return 'not-found';
  if (status === 413) return 'rate';
  if (status === 429) return /per[- ]day|daily|TPD|RPD|free-models-per-day/i.test(bodyText) ? 'quota' : 'rate';
  if (status >= 500) return 'server';
  if (status === 400 && /context|too large|maximum/i.test(bodyText)) return 'rate';
  return 'server';
}

/** One HTTP request to one target. Throws AIError with a kind. */
async function callTarget(target, req) {
  const { provider, model } = target;
  assertFree(provider, model);
  const timeoutMs = req.timeoutMs || 120000;
  const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const stream = Boolean(req.onToken);

  let url; let headers; let body;
  if (provider === 'ollama') {
    url = `${ollamaHost()}/api/chat`;
    headers = { 'Content-Type': 'application/json' };
    body = {
      model, messages: req.messages, stream, think: false,
      options: { temperature: req.temperature ?? 0.7, num_predict: req.maxTokens || 2048, num_ctx: 16384 },
    };
    if (req.json) body.format = 'json';
  } else {
    const p = PROVIDERS[provider];
    const key = getKey(target.keySlot === 2 ? `${p.keyName}_2` : p.keyName);
    if (!key) throw new AIError(`${p.name}: no API key`, { kind: 'no-key', provider, model });
    url = `${p.base}/chat/completions`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://syrix.app/folio'; headers['X-Title'] = 'SYRIX Folio'; }
    const gm = GROQ_MODELS.find((m) => m.id === model);
    const maxTokens = Math.min(req.maxTokens || 2048, gm?.maxOutput || 8192);
    body = { model, messages: req.messages, temperature: req.temperature ?? 0.7, max_tokens: maxTokens, stream };
    if (provider === 'groq' && gm?.reasoning) {
      body.reasoning_effort = req.reasoningEffort || 'low';
      body.include_reasoning = false;
    }
    if (req.json) body.response_format = { type: 'json_object' };
  }

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (req.signal?.aborted) throw new AIError('Cancelled', { kind: 'aborted', provider, model });
    if (e?.name === 'TimeoutError' || /timeout/i.test(String(e?.message))) throw new AIError(`${model} timed out`, { kind: 'timeout', provider, model });
    if (provider === 'ollama') throw new AIError('Ollama is not running', { kind: 'unavailable', provider, model });
    throw new AIError(`Network error: ${e.message}`, { kind: 'network', provider, model });
  }

  const key = laneKey(target);
  recordHeaders(key, res.headers);

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    let kind = classifyStatus(res.status, bodyText);
    if (provider === 'ollama' && res.status === 404) kind = 'not-found';
    // Ollama rejects think:false for models without a thinking mode; retry without it.
    if (provider === 'ollama' && /think/i.test(bodyText) && !req._noThink) {
      return callTarget(target, { ...req, _noThink: true });
    }
    const retryAfterMs = retryAfterFrom(res, bodyText);
    let msg = bodyText;
    try { const j = JSON.parse(bodyText); msg = j.error?.message || j.error || j.message || bodyText; } catch { /* keep text */ }
    throw new AIError(String(msg).slice(0, 300), { kind, provider, model, status: res.status, retryAfterMs });
  }

  let text; let usage;
  if (stream) {
    ({ text, usage } = provider === 'ollama' ? await readNDJSON(res, req.onToken) : await readSSE(res, req.onToken));
  } else {
    const j = await res.json();
    text = provider === 'ollama' ? j.message?.content : j.choices?.[0]?.message?.content;
    usage = provider === 'ollama' ? { prompt_tokens: j.prompt_eval_count, completion_tokens: j.eval_count } : j.usage;
  }
  // Strip any reasoning that leaked into the content of a local model.
  text = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new AIError(`${model} returned an empty response`, { kind: 'server', provider, model });
  return { text, usage, provider, model };
}

// Rate tracking is per account: the second key's lane has its own entry.
export function laneKey(target) {
  return `${target.provider}:${target.model}${target.keySlot === 2 ? '#2' : ''}`;
}

/**
 * Each Groq or OpenRouter target is followed by the same model on the second
 * account's key (GROQ_API_KEY_2 / OPENROUTER_API_KEY_2) when that key is set,
 * so a used-up allowance moves to the backup key before any other model.
 */
export function withBackupKeys(chain) {
  const out = [];
  for (const t of chain) {
    out.push(t);
    const p = PROVIDERS[t.provider];
    if (!t.keySlot && p && p.keyName && getKey(`${p.keyName}_2`)) out.push({ ...t, keySlot: 2 });
  }
  return out;
}

const MAX_INLINE_WAIT_MS = 65000; // Groq per-minute allowances reset within 60 s

/**
 * Run a chat request against a chain of targets.
 * req: { messages, temperature, maxTokens, json, signal, onToken, onStatus, timeoutMs, reasoningEffort }
 */
export async function chatChain(inputChain, req) {
  const chain = withBackupKeys(inputChain);
  const attempts = [];
  const estTokens = Math.ceil(JSON.stringify(req.messages).length / 3.5) + (req.maxTokens || 2048);
  for (let ti = 0; ti < chain.length; ti++) {
    const target = chain[ti];
    const key = laneKey(target);
    const next = chain[ti + 1];
    const backupNext = Boolean(next && next.keySlot === 2 && next.provider === target.provider && next.model === target.model);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (req.signal?.aborted) throw new AIError('Cancelled', { kind: 'aborted' });
      const wait = waitNeeded(key, estTokens);
      // With a second account's key next in line, switch to it instead of waiting.
      if (wait > 0 && backupNext) {
        attempts.push({ ...target, kind: 'rate', message: 'Allowance used; switching to the backup key' });
        break;
      }
      if (wait > MAX_INLINE_WAIT_MS) {
        attempts.push({ ...target, kind: 'rate', message: `Rate-limited for ${Math.round(wait / 1000)}s` });
        break;
      }
      if (wait > 0) {
        req.onStatus?.({ type: 'waiting', seconds: Math.ceil(wait / 1000), provider: target.provider, model: target.model });
        await sleep(wait + 250, req.signal);
      }
      try {
        if (ti > 0 && attempt === 0) req.onStatus?.({ type: 'fallback', provider: target.provider, model: target.model, reason: attempts[attempts.length - 1]?.kind });
        const out = await callTarget(target, req);
        return { ...out, attempts };
      } catch (err) {
        if (!(err instanceof AIError)) throw err;
        if (err.kind === 'aborted') throw err;
        attempts.push({ ...target, kind: err.kind, message: err.message });
        if (err.kind === 'rate' && backupNext) {
          if (err.retryAfterMs) limits.set(key, { ...(limits.get(key) || {}), blockedUntil: Date.now() + err.retryAfterMs, reason: 'rate' });
          break;
        }
        if (err.kind === 'rate') {
          const ms = err.retryAfterMs ?? 4000 * (attempt + 1);
          if (ms > MAX_INLINE_WAIT_MS) {
            limits.set(key, { ...(limits.get(key) || {}), blockedUntil: Date.now() + ms, reason: 'rate' });
            break;
          }
          req.onStatus?.({ type: 'waiting', seconds: Math.ceil(ms / 1000), provider: target.provider, model: target.model });
          await sleep(ms + 250, req.signal);
          continue;
        }
        if (err.kind === 'quota') {
          limits.set(key, { ...(limits.get(key) || {}), blockedUntil: Date.now() + (err.retryAfterMs || 3600000), reason: 'quota' });
          break;
        }
        if ((err.kind === 'server' || err.kind === 'timeout') && attempt === 0) {
          await sleep(1500, req.signal);
          continue;
        }
        break; // auth, payment, not-free, not-found, unavailable, no-key, repeated failures → next target
      }
    }
  }
  const primary = attempts.find((a) => !['unavailable', 'no-key'].includes(a.kind)) || attempts[0];
  const err = new AIError(
    primary ? `${describeError(primary)} (${primary.provider} · ${primary.model})` : 'No AI provider is configured.',
    { kind: primary?.kind || 'no-key', provider: primary?.provider, model: primary?.model, attempts },
  );
  throw err;
}

// ---------------------------------------------------------------------------
// Catalogue and health

export async function listOllamaModels() {
  try {
    const r = await fetch(`${ollamaHost()}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { running: false, models: [] };
    const j = await r.json();
    return { running: true, models: (j.models || []).map((m) => ({ id: m.name, label: m.name, size: m.size })) };
  } catch {
    return { running: false, models: [] };
  }
}

let orCache = { at: 0, models: [] };
export async function listOpenRouterFree() {
  if (Date.now() - orCache.at < 3600000 && orCache.models.length) return orCache.models;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    orCache = {
      at: Date.now(),
      models: (j.data || []).filter((m) => m.id.endsWith(':free')).map((m) => ({ id: m.id, label: m.name || m.id, context: m.context_length })),
    };
  } catch { /* offline: keep the previous cache */ }
  return orCache.models;
}

export async function catalogue() {
  const [ollama, openrouter] = await Promise.all([listOllamaModels(), listOpenRouterFree()]);
  return {
    groq: { configured: Boolean(getKey('GROQ_API_KEY')), models: GROQ_MODELS },
    openrouter: { configured: Boolean(getKey('OPENROUTER_API_KEY')), models: openrouter },
    ollama: { configured: ollama.running, running: ollama.running, models: ollama.models },
  };
}

export async function testTarget(target) {
  const t0 = Date.now();
  try {
    const out = await callTarget(target, { messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 300, temperature: 0, timeoutMs: 30000 });
    return { ok: true, ms: Date.now() - t0, reply: out.text.slice(0, 40) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, kind: e.kind, message: describeError(e), detail: e.message };
  }
}
