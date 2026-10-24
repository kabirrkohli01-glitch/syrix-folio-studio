import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, FolderOpen, ArrowUp, ArrowDown, Trash2, Plus, Zap, Lock, Cloud, RefreshCw } from 'lucide-react';
import { useApp, folioLogoUrl } from '../App.jsx';
import { useUi, Seg, Toggle } from '../components/ui.jsx';

const folio = window.folio;
const ROLES = [
  ['rewrite', 'Rewriting', 'Humanizer rewrites, repairs and the lab’s generated samples.'],
  ['audit', 'Meaning check', 'The second model that checks revisions for changed meaning.'],
  ['assistant', 'SYRIX assistant', 'Chat, explanations and suggested edits.'],
  ['profile', 'Profile summaries', 'Optional voice summaries for writing profiles.'],
];
const KEY_INFO = {
  GROQ_API_KEY: ['Groq', 'Free tier: about 1,000 requests a day and 8,000 tokens a minute per model.', 'https://console.groq.com/keys'],
  GROQ_API_KEY_2: ['Groq (backup key)', 'Used automatically when the main Groq allowance runs out.', 'https://console.groq.com/keys'],
  OPENROUTER_API_KEY_2: ['OpenRouter (backup key)', 'Used automatically when the main OpenRouter allowance runs out.', 'https://openrouter.ai/settings/keys'],
  OPENROUTER_API_KEY: ['OpenRouter', 'Only “:free” models are ever used. Free models have a small shared daily limit.', 'https://openrouter.ai/settings/keys'],
  NEWS_API_KEY: ['NewsAPI', 'Optional extra news source (free developer tier).', 'https://newsapi.org/register'],
  OLLAMA_HOST: ['Ollama host', 'Optional. Defaults to http://127.0.0.1:11434.', 'https://ollama.com/download'],
};

function ChainEditor({ role, chain, catalogue, onChange }) {
  const { toast } = useUi();
  const [tests, setTests] = useState({});
  const models = (provider) => (catalogue?.[provider]?.models || []).map((m) => m.id);
  const set = (i, patch) => onChange(chain.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const move = (i, d) => { const c = [...chain]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x); onChange(c); };
  const test = async (i) => {
    setTests((t) => ({ ...t, [i]: { busy: true } }));
    const r = await folio.providers.test(chain[i]);
    setTests((t) => ({ ...t, [i]: r }));
    if (!r.ok) toast(`${chain[i].model}: ${r.message}`, { kind: 'error', detail: r.detail });
  };
  return (
    <div className="chain">
      {chain.map((t, i) => {
        const list = models(t.provider);
        const r = tests[i];
        return (
          <div key={i} className="chain-item">
            <span className="n">{i + 1}</span>
            <select className="select" value={t.provider} onChange={(e) => set(i, { provider: e.target.value, model: models(e.target.value)[0] || '' })}>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter (free)</option>
              <option value="ollama">Ollama (local)</option>
            </select>
            {list.length ? (
              <select className="select" value={t.model} onChange={(e) => set(i, { model: e.target.value })}>
                {!list.includes(t.model) && <option value={t.model}>{t.model} (not available)</option>}
                {list.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : <input className="input" value={t.model} onChange={(e) => set(i, { model: e.target.value })} placeholder={t.provider === 'ollama' ? 'e.g. qwen3:8b' : 'model id'} />}
            <button className="btn sm" onClick={() => test(i)} disabled={r?.busy} data-tip="Send a one-word test request">
              {r?.busy ? <span className="spinner" /> : r ? (r.ok ? <CheckCircle2 className="ok" /> : <XCircle className="bad" />) : <Zap />}
              {r && !r.busy ? (r.ok ? `${r.ms} ms` : 'Failed') : 'Test'}
            </button>
            <div className="row" style={{ gap: 2 }}>
              <button className="btn ghost icon sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp /></button>
              <button className="btn ghost icon sm" onClick={() => move(i, 1)} disabled={i === chain.length - 1} aria-label="Move down"><ArrowDown /></button>
              <button className="btn ghost icon sm" onClick={() => onChange(chain.filter((_, j) => j !== i))} disabled={chain.length === 1} aria-label="Remove"><Trash2 /></button>
            </div>
          </div>
        );
      })}
      <div><button className="btn sm ghost" onClick={() => onChange([...chain, { provider: 'ollama', model: (catalogue?.ollama?.models || [])[0]?.id || 'qwen3:8b' }])}><Plus />Add fallback</button></div>
    </div>
  );
}

export default function Settings() {
  const app = useApp();
  const { toast } = useUi();
  const s = app.settings;
  const [keys, setKeys] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [info, setInfo] = useState(null);
  useEffect(() => {
    folio.providers.keys().then(setKeys).catch(() => {});
    folio.providers.catalogue().then(setCatalogue).catch(() => {});
    folio.app.info().then(setInfo).catch(() => {});
  }, []);
  if (!s) return null;

  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="lede">AI providers, privacy, the editor and storage.</div></div></div>
      <div className="page-scroll">
        <div className="page-pad settings-grid">
          <div className="card card-pad">
            <div className="card-title">AI connection</div>
            <div className="note" style={{ marginBottom: 10 }}>Folio uses free services only and connects through your SYRIX setup, so there is nothing to configure here.</div>
            {keys?.keys.filter((k) => k.name !== 'OLLAMA_HOST').map((k) => (
              <div key={k.name} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <b className="dim grow">{KEY_INFO[k.name][0]}</b>
                {k.set ? <span className="badge pos"><CheckCircle2 />Connected</span> : <span className="badge">Not connected</span>}
              </div>
            ))}
            <div className="row" style={{ padding: '7px 0' }}>
              <b className="dim grow">Ollama (on this computer)</b>
              {catalogue?.ollama.running ? <span className="badge pos"><CheckCircle2 />Running</span> : <span className="badge">Not running</span>}
            </div>
          </div>

          <details className="card card-pad">
            <summary className="row" style={{ cursor: 'pointer' }}><div className="card-title" style={{ margin: 0 }}>Models (advanced)</div><span className="spacer" /><span className="note">Recommended models are already set</span></summary>
            <div className="row" style={{ marginTop: 10 }}><span className="spacer" /><button className="btn sm ghost" onClick={() => folio.providers.catalogue().then(setCatalogue)}><RefreshCw />Refresh model lists</button></div>
            <div className="note" style={{ margin: '6px 0 4px' }}>Each task tries its models in order and moves to the next if one is unavailable or out of free allowance. {catalogue && (catalogue.ollama.running ? `Ollama is running with ${catalogue.ollama.models.length} model${catalogue.ollama.models.length === 1 ? '' : 's'}.` : 'Ollama is not running, so local fallbacks are skipped.')}</div>
            {ROLES.map(([role, label, hint]) => (
              <div key={role} className="set-row">
                <div className="k">{label}<small>{hint}</small></div>
                <ChainEditor role={role} chain={s.roles?.[role] || []} catalogue={catalogue} onChange={(chain) => app.updateSettings({ roles: { [role]: chain } })} />
              </div>
            ))}
            <div className="row"><button className="btn sm ghost" onClick={async () => { await folio.settings.reset('roles'); const next = await folio.settings.get(); await app.updateSettings({ roles: next.roles }); }}>Restore default models</button></div>
          </details>

          <div className="card card-pad">
            <div className="card-title">Privacy</div>
            <div className="set-row" style={{ borderBottom: 0 }}>
              <div className="k">Where text is processed<small>Documents and writing samples are always stored only on this computer.</small></div>
              <div className="col">
                <Seg value={s.privacy?.mode || 'cloud'} onChange={(mode) => app.updateSettings({ privacy: { mode } })} options={[['cloud', 'Free cloud models'], ['local', 'This computer only']]} />
                <div className="note">{s.privacy?.mode === 'local'
                  ? <><Lock />Every AI task uses Ollama on this computer. Nothing you write is sent over the network. Quality and speed depend on the local model.</>
                  : <><Cloud />Text you revise or ask about is sent to the provider listed first under Models. Folio sends only the passage being processed, plus profile excerpts when a profile is used.</>}</div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-title">Editor</div>
            <div className="set-row"><div className="k">Page</div><Seg value={s.editor?.page || 'dark'} onChange={(page) => app.updateSettings({ editor: { page } })} options={[['dark', 'Dark page'], ['paper', 'Paper'], ['flat', 'No page']]} /></div>
            <div className="set-row"><div className="k">Text size</div><Seg value={s.editor?.fontSize || 18} onChange={(fontSize) => app.updateSettings({ editor: { fontSize } })} options={[[16, 'Small'], [18, 'Medium'], [20, 'Large'], [22, 'Extra large']]} /></div>
            <div className="set-row"><div className="k">Page width</div><Seg value={s.editor?.width || 760} onChange={(width) => app.updateSettings({ editor: { width } })} options={[[660, 'Narrow'], [760, 'Standard'], [900, 'Wide']]} /></div>
            <div className="set-row"><div className="k">Spell check<small>Applies after restarting Folio.</small></div><Toggle checked={s.editor?.spellcheck !== false} onChange={(spellcheck) => app.updateSettings({ editor: { spellcheck } })} label="Underline misspelled words" /></div>
          </div>

          <div className="card card-pad">
            <div className="card-title">Storage</div>
            <div className="set-row" style={{ borderBottom: 0 }}>
              <div className="k">Data folder<small>Documents, version history, profiles, revision sessions and settings. Back this folder up to keep your work safe.</small></div>
              <div className="row"><span className="mono dim ellipsis grow">{info?.userData}</span><button className="btn sm" onClick={() => folio.app.openDataFolder()}><FolderOpen />Open</button></div>
            </div>
          </div>

          <div className="card card-pad row" style={{ gap: 16, marginBottom: 30 }}>
            <img src={folioLogoUrl} alt="" style={{ width: 54, height: 54 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>SYRIX Folio {info?.version}</div>
              <div className="note">Powered by SYRIX · Made by Kabirr Kohli</div>
              <div className="note">Electron {info?.electron}. Uses open-source libraries including TipTap, mammoth, docx, pdf.js, Tesseract.js and Transformers.js.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
