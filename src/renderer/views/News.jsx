import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, Newspaper, AlertTriangle, CheckCircle2, MinusCircle, Search } from 'lucide-react';
import { useUi, Seg, Empty } from '../components/ui.jsx';
import { dateOnly, dateTime, relTime } from '../lib/format.js';

const folio = window.folio;
const TOPICS = ['All', 'Detection', 'Academic integrity', 'Watermarking', 'Writing tools', 'Research'];

export default function News() {
  const { toast } = useUi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState('all');
  const [topic, setTopic] = useState('All');
  const [q, setQ] = useState('');

  const refresh = async () => {
    setLoading(true);
    try { setData(await folio.news.refresh()); } catch (e) { toast('Could not refresh news', { kind: 'error', detail: e.message }); }
    setLoading(false);
  };

  useEffect(() => {
    folio.news.cached().then((c) => {
      setData(c);
      const stale = !c.refreshedAt || Date.now() - new Date(c.refreshedAt).getTime() > 3 * 3600 * 1000;
      if (stale) refresh();
    }).catch(() => refresh());
  }, []);

  const items = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.items.filter((i) => (kind === 'all' || i.kind === kind)
      && (topic === 'All' || (i.topics || []).includes(topic))
      && (!needle || `${i.title} ${i.summary} ${i.publisher}`.toLowerCase().includes(needle)));
  }, [data, kind, topic, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AI and detector news</h1>
          <div className="lede">Reporting and new research on AI writing, AI-text detection and academic integrity, from free public sources.</div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={refresh} disabled={loading}>{loading ? <span className="spinner" /> : <RefreshCw />}Refresh</button>
      </div>
      <div className="lib-toolbar" style={{ flexWrap: 'wrap' }}>
        <div className="search"><Search /><input className="input" placeholder="Filter headlines" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Seg value={kind} onChange={setKind} options={[['all', 'All'], ['news', 'News'], ['research', 'Research']]} />
        <select className="select" style={{ width: 190 }} value={topic} onChange={(e) => setTopic(e.target.value)}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select>
        <span className="spacer" />
        {data?.refreshedAt && <span className="note">Retrieved {dateTime(data.refreshedAt)}</span>}
      </div>
      <div className="page-scroll">
        <div className="page-pad">
          {data?.sources?.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              {data.sources.map((s) => (
                <span key={s.id} className={`badge ${s.status === 'ok' ? '' : s.status === 'error' ? 'neg' : ''}`} data-tip={s.message || `${s.count} relevant item${s.count === 1 ? '' : 's'}`}>
                  {s.status === 'ok' ? <CheckCircle2 /> : s.status === 'error' ? <AlertTriangle /> : <MinusCircle />}
                  {s.name}{s.id.startsWith('arxiv-') ? (s.id === 'arxiv-watermark' ? ' (watermarking)' : ' (detection)') : ''} · {s.status === 'ok' ? s.count : s.status === 'skipped' ? 'not configured' : s.stale ? 'unavailable, showing saved' : 'unavailable'}
                </span>
              ))}
            </div>
          )}
          {data?.sources?.some((s) => s.status === 'error') && <div className="note" style={{ marginBottom: 8 }}>Some sources could not be reached. Their last saved items are shown where available and marked “saved”.</div>}
          {(!data || (loading && !data.items.length)) && <div className="row muted" style={{ padding: '14px 0' }}><span className="spinner" />Fetching from arXiv, Google News, publisher feeds and NewsAPI…</div>}
          {data && !items.length && !loading && (
            <Empty icon={<Newspaper />} title={data.items.length ? 'Nothing matches these filters' : 'No items yet'}>
              {data.items.length ? 'Try a different topic or clear the filter.' : 'Refresh to fetch the latest items. An internet connection is required.'}
            </Empty>
          )}
          {items.map((i) => (
            <article key={i.id} className="news-item">
              <div className="kind"><span className={`badge ${i.kind === 'research' ? 'info' : ''}`}>{i.kind === 'research' ? 'Research' : 'News'}</span></div>
              <div className="grow">
                <h3><a href={i.url} onClick={(e) => { e.preventDefault(); folio.app.openExternal(i.url); }}>{i.title} <ExternalLink size={12} style={{ verticalAlign: -1, opacity: 0.6 }} /></a></h3>
                {i.summary && <p>{i.summary}</p>}
                <div className="meta">
                  <span>{i.publisher}{i.authors?.length ? ` · ${i.authors.slice(0, 3).join(', ')}${i.authors.length > 3 ? ' et al.' : ''}` : ''}</span>
                  <span data-tip="Publication date reported by the source">Published {i.publishedAt ? dateOnly(i.publishedAt) : 'date not given'}</span>
                  <span data-tip={`Retrieved ${dateTime(i.retrievedAt)}`}>Retrieved {relTime(i.retrievedAt)}{i.stale ? ' (saved)' : ''}</span>
                  {i.source !== i.publisher && <span>via {i.source}</span>}
                  {(i.topics || []).map((t) => <span key={t} className="badge" style={{ height: 18 }}>{t}</span>)}
                </div>
              </div>
            </article>
          ))}
          <div className="note" style={{ marginTop: 18 }}>
            Sources: arXiv API, Google News search feed, Inside Higher Ed, The Conversation and The Verge feeds (filtered for relevance), and NewsAPI when a key is configured. Headlines link to the original publisher; Google News links pass through a Google redirect. Publication dates come from each source; retrieval dates are when Folio fetched them.
          </div>
        </div>
      </div>
    </>
  );
}
