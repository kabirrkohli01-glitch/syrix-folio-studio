export function relTime(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function clock(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export const num = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-GB'));
export const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);

export function plural(n, one, many) {
  return `${num(n)} ${n === 1 ? one : many || `${one}s`}`;
}

export function readingTime(words) {
  const m = Math.max(1, Math.round(words / 230));
  return `${m} min read`;
}

export function newRunId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
