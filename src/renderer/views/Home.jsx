import React, { useEffect, useState } from 'react';
import { FilePlus2, FileUp, Wand2, UserRound, FlaskConical, Newspaper, FileText, Clock } from 'lucide-react';
import { useApp, folioLogoUrl } from '../App.jsx';
import { relTime, num } from '../lib/format.js';

const folio = window.folio;

export default function Home() {
  const app = useApp();
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    if (app.view !== 'home') return;
    folio.sessions.list().then((s) => setSessions(s.slice(0, 5))).catch(() => {});
  }, [app.view]);
  const recent = app.docs.slice(0, 6);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page-scroll">
      <div className="hero">
        <img src={folioLogoUrl} alt="SYRIX Folio" />
        <div>
          <h1>{greeting}.</h1>
          <p>Write, revise in your own voice, and check that every fact survives the edit.</p>
        </div>
      </div>

      <div className="quick">
        <button onClick={() => app.newDoc()}><FilePlus2 /><b>New document</b><span>Start a blank page. Saved automatically. <span className="kbd">Ctrl N</span></span></button>
        <button onClick={() => app.importDocs()}><FileUp /><b>Import a file</b><span>Word, PDF, Markdown, text, or an image with OCR. <span className="kbd">Ctrl O</span></span></button>
        <button onClick={() => app.setView('humanizer')}><Wand2 /><b>Humanize text</b><span>Paste a passage, choose a voice and tone, and review every change.</span></button>
        <button onClick={() => app.setView('profiles')}><UserRound /><b>Build a writing profile</b><span>Teach Folio your voice from samples of your own writing.</span></button>
      </div>

      <div className="section-title"><FileText size={15} />Recent documents<span className="spacer" />{app.docs.length > 6 && <button className="btn ghost sm" onClick={() => app.setView('library')}>All documents</button>}</div>
      <div className="page-pad">
        {recent.length ? (
          <div className="doc-grid">
            {recent.map((d) => (
              <div key={d.id} className="doc-card" onClick={() => app.openDoc(d.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') app.openDoc(d.id); }}>
                <h3>{d.title}</h3>
                <p>{d.preview || 'Empty document'}</p>
                <div className="meta"><span>{num(d.wordCount)} words</span><span>·</span><span>{relTime(d.updatedAt)}</span></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="note">No documents yet. Create one, or drop a file anywhere in this window to import it.</div>
        )}
      </div>

      {sessions.length > 0 && (
        <>
          <div className="section-title"><Clock size={15} />Recent revisions</div>
          <div className="page-pad">
            <div className="card">
              {sessions.map((s) => (
                <div key={s.id} className="sample-row" style={{ cursor: 'pointer' }} onClick={() => app.sendToHumanizer({ sessionId: s.id })}>
                  <Wand2 size={15} className="muted" />
                  <div className="grow">
                    <div className="t ellipsis">{s.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{num(s.words)} words · {s.versions} version{s.versions === 1 ? '' : 's'}{s.source?.title ? ` · from “${s.source.title}”` : ''}</div>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>{relTime(s.updatedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="section-title">Research</div>
      <div className="quick" style={{ paddingTop: 0, paddingBottom: 40 }}>
        <button onClick={() => app.setView('lab')}><FlaskConical /><b>Detector lab</b><span>What published research says about AI-text detectors, plus a reproducible test of open detectors.</span></button>
        <button onClick={() => app.setView('news')}><Newspaper /><b>AI and detector news</b><span>Current reporting and new research, with publication and retrieval dates.</span></button>
      </div>
    </div>
  );
}
