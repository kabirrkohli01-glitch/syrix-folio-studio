// News and research retrieval for AI writing, AI-text detection and academic
// integrity. Every source is free:
//   arXiv API          research preprints (no key)
//   Google News RSS    targeted search across publishers (no key)
//   Publisher RSS      Inside Higher Ed, The Conversation, The Verge (no key, keyword-filtered)
//   NewsAPI            developer tier, used only when NEWS_API_KEY is set
//
// Each item carries the publication date reported by its source (or null)
// and the time Folio retrieved it, and the two are never conflated. Results
// are cached on disk; when a source fails the cached items are shown with the
// failure reported, never replaced with invented headlines.

import path from 'node:path';
import { getKey } from './env.js';
import { readJson, writeJsonAtomic } from './store/fsstore.js';

const UA = 'SYRIX-Folio/1.0 (desktop news reader)';

// An item from a general feed is kept only if it mentions one of these.
const RELEVANT = /\b(ai[- ]?detect\w*|detect\w* (?:ai|chatgpt|llm|machine)|ai[- ]generated (?:text|writing|essays?|content)|machine[- ]generated text|llm[- ]generated|turnitin|gptzero|originality\.ai|copyleaks|pangram|plagiari\w*|academic (?:integrity|misconduct|dishonesty)|cheat\w*|watermark\w*|ai writing|text provenance|content credentials|essay mills?|ai in (?:assessment|education|universities|schools)|assessment\w* .{0,40}\bai\b|\bai\b.{0,40}assessment\w*)\b/i;

const TOPICS = [
  ['Detection', /detect|turnitin|gptzero|originality|copyleaks|pangram|classifier/i],
  ['Watermarking', /watermark|provenance|content credentials|c2pa/i],
  ['Academic integrity', /academic|integrity|misconduct|cheat|plagiar|universit|school|student|assessment|exam|essay/i],
  ['Writing tools', /writing|paraphras|humaniz|rewrite|editor|grammarly/i],
  ['Research', /arxiv|study|paper|researchers|benchmark/i],
];

const SOURCES = [
  {
    id: 'arxiv-detection', name: 'arXiv', kind: 'research',
    url: `https://export.arxiv.org/api/query?search_query=${encodeURIComponent('(abs:"machine-generated text" OR abs:"AI-generated text" OR abs:"LLM-generated text" OR abs:"AI-written") AND (abs:detection OR abs:detector OR abs:detectors OR abs:detecting)')}&sortBy=submittedDate&sortOrder=descending&max_results=25`,
    parse: 'arxiv', filter: false,
  },
  {
    id: 'arxiv-watermark', name: 'arXiv', kind: 'research',
    url: `https://export.arxiv.org/api/query?search_query=${encodeURIComponent('(abs:watermark OR abs:watermarking) AND (abs:"language model" OR abs:LLM OR abs:text)')}&sortBy=submittedDate&sortOrder=descending&max_results=12`,
    parse: 'arxiv', filter: false,
  },
  {
    id: 'google-news', name: 'Google News', kind: 'news',
    url: `https://news.google.com/rss/search?q=${encodeURIComponent('("AI detector" OR "AI detection" OR "AI-generated text" OR "AI writing detection" OR Turnitin AI OR "academic integrity" AI) when:60d')}&hl=en-GB&gl=GB&ceid=GB:en`,
    parse: 'rss', filter: true,
  },
  { id: 'insidehighered', name: 'Inside Higher Ed', kind: 'news', url: 'https://www.insidehighered.com/rss.xml', parse: 'rss', filter: true },
  { id: 'conversation', name: 'The Conversation', kind: 'news', url: 'https://theconversation.com/uk/technology/articles.atom', parse: 'atom', filter: true },
  { id: 'verge-ai', name: 'The Verge', kind: 'news', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', parse: 'atom', filter: true },
  {
    id: 'newsapi', name: 'NewsAPI', kind: 'news', requiresKey: 'NEWS_API_KEY',
    url: () => `https://newsapi.org/v2/everything?q=${encodeURIComponent('"AI detection" OR "AI detector" OR "AI-generated text" OR "AI writing" OR Turnitin OR GPTZero OR "academic integrity"')}&language=en&sortBy=publishedAt&pageSize=40&apiKey=${getKey('NEWS_API_KEY')}`,
    parse: 'newsapi', filter: true,
  },
];

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function stripTags(s) { return decodeEntities(String(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}
function isoOrNull(s) {
  if (!s) return null;
  const d = new Date(String(s).trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseArxiv(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const absUrl = stripTags(tag(e, 'id'));
    return {
      title: stripTags(tag(e, 'title')),
      url: absUrl.replace(/^http:/, 'https:'),
      publishedAt: isoOrNull(stripTags(tag(e, 'published'))),
      summary: stripTags(tag(e, 'summary')).slice(0, 420),
      authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => stripTags(m[1])).slice(0, 6),
      publisher: 'arXiv',
    };
  });
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, e]) => {
    const source = e.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    return {
      title: stripTags(tag(e, 'title')).replace(/\s+-\s+[^-]+$/, (m) => (source ? '' : m)),
      url: stripTags(tag(e, 'link')),
      publishedAt: isoOrNull(stripTags(tag(e, 'pubDate')) || stripTags(tag(e, 'dc:date'))),
      summary: stripTags(tag(e, 'description')).slice(0, 360),
      publisher: source ? stripTags(source[1]) : null,
    };
  });
}

function parseAtom(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const link = e.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || e.match(/<link[^>]*href=["']([^"']+)["']/i);
    return {
      title: stripTags(tag(e, 'title')),
      url: link ? decodeEntities(link[1]) : '',
      publishedAt: isoOrNull(stripTags(tag(e, 'published')) || stripTags(tag(e, 'updated'))),
      summary: stripTags(tag(e, 'summary') || tag(e, 'content')).slice(0, 360),
      publisher: null,
    };
  });
}

function parseNewsApi(text) {
  const j = JSON.parse(text);
  if (j.status !== 'ok') throw new Error(j.message || 'NewsAPI error');
  return (j.articles || []).map((a) => ({
    title: stripTags(a.title), url: a.url, publishedAt: isoOrNull(a.publishedAt),
    summary: stripTags(a.description || '').slice(0, 360), publisher: a.source?.name || null,
  }));
}

const PARSERS = { arxiv: parseArxiv, rss: parseRss, atom: parseAtom, newsapi: parseNewsApi };

function topicsFor(item) {
  const hay = `${item.title} ${item.summary}`;
  return TOPICS.filter(([, re]) => re.test(hay)).map(([t]) => t);
}

function normTitle(t) { return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

async function fetchSource(src) {
  if (src.requiresKey && !getKey(src.requiresKey)) return { id: src.id, name: src.name, status: 'skipped', message: `${src.requiresKey} is not set`, items: [] };
  const url = typeof src.url === 'function' ? src.url() : src.url;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/rss+xml, application/xml, application/json, text/xml' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const retrievedAt = new Date().toISOString();
  let items = PARSERS[src.parse](body).filter((i) => i.title && /^https?:\/\//.test(i.url));
  if (src.filter) items = items.filter((i) => RELEVANT.test(`${i.title} ${i.summary}`));
  items = items.map((i) => ({
    ...i,
    id: `${src.id}:${i.url}`,
    kind: src.kind,
    source: src.name,
    publisher: i.publisher || src.name,
    retrievedAt,
    topics: topicsFor(i),
  }));
  return { id: src.id, name: src.name, status: 'ok', count: items.length, items };
}

export function createNews(root) {
  const cacheFile = path.join(root, 'news-cache.json');

  return {
    sources() { return SOURCES.map(({ id, name, kind, requiresKey }) => ({ id, name, kind, requiresKey: requiresKey || null, keySet: requiresKey ? Boolean(getKey(requiresKey)) : true })); },

    cached() {
      return readJson(cacheFile, { items: [], sources: [], refreshedAt: null });
    },

    async refresh() {
      const prev = this.cached();
      const results = await Promise.allSettled(SOURCES.map(fetchSource));
      const sources = [];
      const fresh = [];
      results.forEach((r, i) => {
        const src = SOURCES[i];
        if (r.status === 'fulfilled') {
          sources.push({ id: r.value.id, name: r.value.name, status: r.value.status, count: r.value.count || 0, message: r.value.message || null });
          fresh.push(...r.value.items);
        } else {
          const kept = (prev.items || []).filter((x) => x.id.startsWith(`${src.id}:`));
          sources.push({ id: src.id, name: src.name, status: 'error', count: kept.length, message: String(r.reason?.message || r.reason).slice(0, 200), stale: kept.length > 0 });
          fresh.push(...kept.map((x) => ({ ...x, stale: true })));
        }
      });
      // De-duplicate by URL and by near-identical title (the same story via two feeds).
      const seenUrl = new Set();
      const seenTitle = new Set();
      const items = [];
      for (const it of fresh.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))) {
        const nt = normTitle(it.title);
        if (seenUrl.has(it.url) || seenTitle.has(nt)) continue;
        seenUrl.add(it.url);
        seenTitle.add(nt);
        items.push(it);
      }
      const out = { items: items.slice(0, 250), sources, refreshedAt: new Date().toISOString() };
      writeJsonAtomic(cacheFile, out);
      return out;
    },
  };
}
