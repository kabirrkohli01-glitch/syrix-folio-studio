import React, { useEffect, useState } from 'react';
import { Plus, UserRound, FileUp, ClipboardPaste, Trash2, Pin, PinOff, Sparkles, Lock, Pencil, Check, X, Wand2, Info } from 'lucide-react';
import { useApp } from '../App.jsx';
import { useUi, Modal, Empty } from '../components/ui.jsx';
import { relTime, num } from '../lib/format.js';

const folio = window.folio;

function PasteSample({ onAdd, onClose }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <Modal title="Add a writing sample" onClose={onClose} wide footer={(
      <>
        <span className="note grow">{num(words)} words{words && words < 30 ? ' — samples need at least 30 words' : ''}</span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={words < 30} onClick={() => onAdd({ title: title.trim() || `Sample ${new Date().toLocaleDateString('en-GB')}`, text, source: 'paste' })}>Add sample</button>
      </>
    )}>
      <div className="col" style={{ gap: 12 }}>
        <input className="input" placeholder="Title (optional), e.g. “Blog post, March”" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="textarea" style={{ minHeight: 280, fontFamily: 'var(--serif)', fontSize: 15 }} autoFocus placeholder="Paste something you wrote yourself. Writing you produced without AI help gives the most accurate profile." value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    </Modal>
  );
}

function RulesEditor({ rules, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (editing) {
    return (
      <div className="col">
        <textarea className="textarea" style={{ minHeight: 140 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="One rule per line, e.g. “Never use semicolons”" />
        <div className="row"><button className="btn sm primary" onClick={() => { onSave(draft.split('\n').map((x) => x.trim()).filter(Boolean)); setEditing(false); }}><Check />Save</button><button className="btn sm" onClick={() => setEditing(false)}>Cancel</button></div>
      </div>
    );
  }
  return (
    <div className="col">
      {rules?.length ? <ul className="rule-list">{rules.map((r, i) => <li key={i}>{r}</li>)}</ul> : <div className="note">No rules yet. Add your own, or generate a voice summary to suggest some.</div>}
      <div><button className="btn sm ghost" onClick={() => { setDraft((rules || []).join('\n')); setEditing(true); }}><Pencil />Edit rules</button></div>
    </div>
  );
}

export default function Profiles() {
  const app = useApp();
  const { toast, confirm } = useUi();
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [profile, setProfile] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [summarising, setSummarising] = useState(false);
  const [nameDraft, setNameDraft] = useState(null);
  const [notes, setNotes] = useState('');

  const refresh = async (keep) => {
    const l = await folio.profiles.list();
    setList(l);
    const id = keep ?? sel ?? l[0]?.id ?? null;
    setSel(id);
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!sel) { setProfile(null); return; }
    folio.profiles.get(sel).then((p) => { setProfile(p); setNotes(p?.notes || ''); }).catch(() => setProfile(null));
  }, [sel]);

  const update = async (patch) => {
    const p = await folio.profiles.update(sel, patch);
    setProfile(p);
    refresh(sel);
  };

  const create = async () => {
    const p = await folio.profiles.create({ name: newName.trim() || 'My writing' });
    setCreating(false);
    setNewName('');
    await refresh(p.id);
  };

  const addSamples = async (samples) => {
    try {
      const r = await folio.profiles.addSamples(sel, samples);
      setProfile(r.profile);
      refresh(sel);
      if (r.added) toast(`Added ${r.added} sample${r.added === 1 ? '' : 's'}`, { kind: 'ok' });
      for (const x of r.rejected) toast(`${x.title}: not added`, { kind: 'warn', detail: x.reason });
    } catch (e) { toast('Could not add samples', { kind: 'error', detail: e.message }); }
  };

  const fromFiles = async () => {
    const r = await folio.files.samplesDialog();
    if (r.canceled) return;
    for (const f of r.files.filter((x) => x.error)) toast(`${f.name} could not be read`, { kind: 'error', detail: f.error });
    const ok = r.files.filter((x) => !x.error).map((f) => ({ title: f.title || f.name, text: f.text, source: f.name }));
    if (ok.length) addSamples(ok);
  };

  const fromDocuments = async () => {
    const docs = app.docs.slice(0, 50);
    if (!docs.length) { toast('There are no documents yet', { kind: 'warn' }); return; }
    setDocPicker(docs);
  };
  const [docPicker, setDocPicker] = useState(null);
  const [picked, setPicked] = useState([]);

  const summarise = async () => {
    const ok = await confirm({
      title: 'Generate a voice summary?',
      message: 'Up to about 2,500 words of this profile’s samples will be sent to the configured AI provider to describe your voice. The samples themselves stay stored only on this computer.',
      confirmLabel: 'Generate',
    });
    if (!ok) return;
    setSummarising(true);
    try {
      const p = await folio.profiles.summarise(sel);
      setProfile(p);
      toast('Voice summary updated', { kind: 'ok' });
    } catch (e) { toast('Could not generate the summary', { kind: 'error', detail: e.message }); }
    finally { setSummarising(false); }
  };

  const a = profile?.analysis;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Writing profiles</h1>
          <div className="lede">Profiles describe how you write, measured from your own samples. The humanizer uses them to match your voice.</div>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setCreating(true)}><Plus />New profile</button>
      </div>
      <div className="split" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="list-pane">
          {!list.length && <div className="note" style={{ padding: 8 }}>No profiles yet.</div>}
          {list.map((p) => (
            <button key={p.id} className={`list-item${sel === p.id ? ' on' : ''}`} onClick={() => setSel(p.id)}>
              <span className="t">{p.name}</span>
              <span className="s">{p.sampleCount} sample{p.sampleCount === 1 ? '' : 's'} · {num(p.wordCount)} words{p.reliability ? ` · ${p.reliability === 'good' ? 'reliable' : p.reliability === 'fair' ? 'fair' : 'limited'}` : ''}</span>
            </button>
          ))}
        </div>
        <div className="detail-pane">
          {!profile ? (
            <Empty icon={<UserRound />} title="Create your first profile" action={<button className="btn primary" onClick={() => setCreating(true)}><Plus />New profile</button>}>
              Add a few pieces of your own writing — essays, emails, posts. 2,000 words or more gives a reliable profile.
            </Empty>
          ) : (
            <div className="page-pad" style={{ paddingTop: 22 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                {nameDraft != null ? (
                  <>
                    <input className="input" style={{ maxWidth: 360, fontSize: 18, height: 38 }} autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { update({ name: nameDraft.trim() || profile.name }); setNameDraft(null); } if (e.key === 'Escape') setNameDraft(null); }} />
                    <button className="btn icon" onClick={() => { update({ name: nameDraft.trim() || profile.name }); setNameDraft(null); }}><Check /></button>
                    <button className="btn icon ghost" onClick={() => setNameDraft(null)}><X /></button>
                  </>
                ) : (
                  <>
                    <h2 style={{ margin: 0, fontSize: 20 }}>{profile.name}</h2>
                    <button className="btn ghost icon sm" onClick={() => setNameDraft(profile.name)} data-tip="Rename"><Pencil /></button>
                  </>
                )}
                <span className="spacer" />
                <button className="btn" onClick={() => app.sendToHumanizer({ profileId: profile.id, keepText: true })}><Wand2 />Use in humanizer</button>
                <button className="btn danger" onClick={async () => {
                  if (!(await confirm({ title: 'Delete this profile?', message: `“${profile.name}” and its ${profile.samples?.length || 0} samples will be deleted from this computer.`, confirmLabel: 'Delete', danger: true }))) return;
                  await folio.profiles.remove(profile.id);
                  setSel(null);
                  refresh(null);
                }}><Trash2 />Delete</button>
              </div>
              <div className="note" style={{ marginBottom: 18 }}><Lock />Samples are stored only on this computer. Excerpts are sent to the AI provider when you rewrite with this profile or generate a voice summary.</div>

              {a ? (
                <>
                  {a.reliability !== 'good' && (
                    <div className="callout warn" style={{ marginBottom: 16 }}><Info /><div>Based on {num(a.wordCount)} words. {a.reliability === 'limited' ? 'Add more samples' : 'More samples would help'} — around 2,000 words of your own writing gives stable measurements.</div></div>
                  )}
                  <div className="card-title">Measured style</div>
                  <div className="trait-grid" style={{ marginBottom: 22 }}>
                    {profile.traits.map((t) => <div key={t.key} className="trait"><div className="k">{t.label}</div><div className="v">{t.text}</div></div>)}
                  </div>

                  <div className="row" style={{ marginBottom: 8 }}>
                    <div className="card-title" style={{ margin: 0 }}>Voice summary</div>
                    <span className="spacer" />
                    <button className="btn sm" onClick={summarise} disabled={summarising}>{summarising ? <span className="spinner" /> : <Sparkles />}{profile.summary ? 'Regenerate' : 'Generate with AI'}</button>
                  </div>
                  {profile.summary
                    ? <p className="prose" style={{ marginTop: 0 }}>{profile.summary}</p>
                    : <div className="note" style={{ marginBottom: 12 }}>An optional plain-language description of your voice, written by an AI model from your samples. The measured style above works without it.</div>}

                  <div className="card-title" style={{ marginTop: 18 }}>Voice rules</div>
                  <RulesEditor rules={profile.rules} onSave={(rules) => update({ rules })} />

                  <div className="card-title" style={{ marginTop: 22 }}>Notes for the humanizer</div>
                  <textarea className="textarea" placeholder="Anything else the rewrite should respect, e.g. “I write for a UK audience; keep my dry humour.”" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (profile.notes || '')) update({ notes }); }} />

                  <div className="card-title" style={{ marginTop: 22 }}>Representative excerpts</div>
                  <div className="note" style={{ marginBottom: 10 }}>Chosen automatically as the passages closest to your measured style. Pin the ones that sound most like you; they are sent with rewrites as voice examples.</div>
                  <div className="col" style={{ gap: 10 }}>
                    {(profile.exemplars || []).map((e, i) => (
                      <div key={i} className="exemplar">
                        <div className="tools"><button className={`btn ghost icon sm${e.pinned ? ' active' : ''}`} data-tip={e.pinned ? 'Unpin' : 'Pin'} onClick={async () => setProfile(await folio.profiles.pinExemplar(profile.id, e.text, !e.pinned))}>{e.pinned ? <PinOff /> : <Pin />}</button></div>
                        {e.text}
                      </div>
                    ))}
                    {!(profile.exemplars || []).length && <div className="note">Samples need paragraphs of 50–170 words for excerpts to be chosen.</div>}
                  </div>
                </>
              ) : (
                <div className="callout" style={{ marginBottom: 16 }}><Info /><div>Add at least one sample of your own writing to build this profile.</div></div>
              )}

              <div className="row" style={{ marginTop: 26, marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>Samples ({profile.samples?.length || 0})</div>
                <span className="spacer" />
                <button className="btn sm" onClick={() => setPasteOpen(true)}><ClipboardPaste />Paste text</button>
                <button className="btn sm" onClick={fromFiles}><FileUp />From files</button>
                <button className="btn sm" onClick={fromDocuments}><Plus />From documents</button>
              </div>
              <div className="card">
                {!(profile.samples || []).length && <div className="note" style={{ padding: 14 }}>No samples yet. Word, PDF, Markdown and text files are supported.</div>}
                {(profile.samples || []).map((s) => (
                  <div key={s.id} className="sample-row">
                    <div className="grow">
                      <div className="t ellipsis">{s.title}</div>
                      <p>{s.text.slice(0, 260)}</p>
                    </div>
                    <span className="muted nowrap" style={{ fontSize: 12 }}>{num(s.words)} words · {relTime(s.addedAt)}</span>
                    <button className="btn ghost icon sm" data-tip="Remove sample" onClick={async () => { setProfile(await folio.profiles.removeSample(profile.id, s.id)); refresh(profile.id); }}><Trash2 /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && (
        <Modal title="New writing profile" onClose={() => setCreating(false)} footer={<><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" onClick={create}>Create</button></>}>
          <div className="col">
            <input className="input" autoFocus placeholder="e.g. Academic essays, Work emails, Blog" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
            <div className="note">Separate profiles for different kinds of writing give better matches than one mixed profile.</div>
          </div>
        </Modal>
      )}
      {pasteOpen && <PasteSample onClose={() => setPasteOpen(false)} onAdd={(s) => { setPasteOpen(false); addSamples([s]); }} />}
      {docPicker && (
        <Modal title="Add documents as samples" onClose={() => { setDocPicker(null); setPicked([]); }} footer={(
          <>
            <button className="btn" onClick={() => { setDocPicker(null); setPicked([]); }}>Cancel</button>
            <button className="btn primary" disabled={!picked.length} onClick={async () => {
              const samples = [];
              for (const id of picked) { const d = await folio.docs.get(id); if (d) samples.push({ title: d.title, text: d.text || '', source: 'document' }); }
              setDocPicker(null); setPicked([]);
              addSamples(samples);
            }}>Add {picked.length || ''}</button>
          </>
        )}>
          <div className="note" style={{ marginBottom: 8 }}>Choose documents you wrote yourself.</div>
          {docPicker.map((d) => (
            <label key={d.id} className="row" style={{ padding: '7px 4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.includes(d.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)))} />
              <span className="grow ellipsis">{d.title}</span>
              <span className="muted" style={{ fontSize: 12 }}>{num(d.wordCount)} words</span>
            </label>
          ))}
        </Modal>
      )}
    </>
  );
}
