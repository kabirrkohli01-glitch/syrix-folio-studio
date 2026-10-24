import React, { useState } from 'react';
import { X, Plus, RotateCcw, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { Toggle, Seg, Stepper, Field } from '../../components/ui.jsx';
import { PRESETS, TONES, AUDIENCES, applyPreset } from '../../../shared/humanizer/controls.js';

const FIVE = (a, b, c, d, e) => [a, b, c, d, e];
const AMOUNT = [[1, 'Light'], [2, 'Balanced'], [3, 'Strong']];

export default function Controls({ controls, onChange, presetId, onPreset, profiles, onManageProfiles, pipeline, onPipeline }) {
  const set = (patch) => onChange({ ...controls, ...patch });
  const [advanced, setAdvanced] = useState(false);
  const [term, setTerm] = useState('');
  const addTerm = () => {
    const t = term.trim();
    if (!t || (controls.glossary || []).includes(t)) return;
    set({ glossary: [...(controls.glossary || []), t] });
    setTerm('');
  };
  const usable = profiles.filter((p) => p.sampleCount > 0);

  return (
    <aside className="hz-controls" aria-label="Humanizer settings">
      <h4>Style</h4>
      <div className="style-list" role="radiogroup">
        {PRESETS.filter((p) => p.id !== 'voice').map((p) => (
          <button key={p.id} role="radio" aria-checked={presetId === p.id} className={`style-row${presetId === p.id ? ' on' : ''}`} onClick={() => onPreset(p.id)}>
            <span className="tick">{presetId === p.id && <Check size={12} />}</span>
            <span><b>{p.name}</b><small>{p.description}</small></span>
          </button>
        ))}
      </div>

      <h4>Your voice</h4>
      {usable.length ? (
        <>
          <select className="select" value={controls.profileId || ''} onChange={(e) => set({ profileId: e.target.value || null })} aria-label="Writing profile">
            <option value="">Don’t match a profile</option>
            {usable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {controls.profileId && <Seg value={controls.profileStrength} onChange={(v) => set({ profileStrength: v })} options={[['subtle', 'A little'], ['balanced', 'Balanced'], ['strong', 'Closely']]} />}
        </>
      ) : (
        <div className="note">Add a few samples of your own writing in <a href="#" onClick={(e) => { e.preventDefault(); onManageProfiles(); }}>Writing profiles</a> and rewrites will match how you write.</div>
      )}

      <h4>How much to change</h4>
      <Seg value={Math.min(controls.strength, 3)} onChange={(v) => set({ strength: v })} options={AMOUNT} />

      <button className="adv-toggle" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
        {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Advanced settings
      </button>

      {advanced && (
        <div className="col" style={{ gap: 16 }}>
          <Field label="Tone">
            <select className="select" value={controls.tone} onChange={(e) => set({ tone: e.target.value })}>
              {TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Stepper label="Formality" value={controls.formality} onChange={(v) => set({ formality: v })} labels={FIVE('Much less formal', 'Less formal', 'Keep', 'More formal', 'Much more formal')} />
          <Stepper label="Vocabulary" value={controls.vocabulary} onChange={(v) => set({ vocabulary: v })} labels={FIVE('Much simpler', 'Simpler', 'Keep level', 'Richer', 'Expert')} />
          <Field label="Audience">
            <select className="select" value={controls.audience} onChange={(e) => set({ audience: e.target.value })}>
              {AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Stepper label="Sentence length" value={controls.sentenceLength} onChange={(v) => set({ sentenceLength: v })} labels={FIVE('Much shorter', 'Shorter', 'Keep', 'Longer', 'Much longer')} />
          <Field label="Sentence variety"><Seg value={controls.variation} onChange={(v) => set({ variation: v })} options={[['keep', 'Keep'], ['natural', 'Natural'], ['high', 'High']]} /></Field>
          <Stepper label="Length" value={controls.concision} onChange={(v) => set({ concision: v })} labels={FIVE('Fuller', 'Slightly fuller', 'Similar', 'More concise', 'Much more concise')} />
          <Field label="Readability"><Seg value={controls.readability} onChange={(v) => set({ readability: v })} options={[['keep', 'Keep'], ['plain', 'Plain'], ['standard', 'Standard'], ['advanced', 'Expert']]} /></Field>
          <Field label="Spelling"><Seg value={controls.spelling} onChange={(v) => set({ spelling: v })} options={[['keep', 'Detect'], ['british', 'British'], ['american', 'American']]} /></Field>
          <Field label="Contractions"><Seg value={controls.contractions} onChange={(v) => set({ contractions: v })} options={[['keep', 'Auto'], ['allow', 'Allow'], ['avoid', 'Avoid']]} /></Field>
          <Field label="Rewrite depth"><Seg value={controls.strength} onChange={(v) => set({ strength: v })} options={[[1, 'Light'], [2, 'Balanced'], [3, 'Strong'], [4, 'Full rewrite']]} /></Field>
          <Toggle checked={controls.preserveStructure} onChange={(v) => set({ preserveStructure: v })} label="Keep the order of points" />
          <Toggle checked={controls.fixErrors !== false} onChange={(v) => set({ fixErrors: v })} label="Correct spelling and grammar" />
          <Toggle checked={controls.removeFillers !== false} onChange={(v) => set({ removeFillers: v })} label="Cut filler words" />
          <Toggle checked={controls.fixRepetition} onChange={(v) => set({ fixRepetition: v })} label="Fix repetition and awkward wording" />
          <Toggle checked={controls.keepTerminology} onChange={(v) => set({ keepTerminology: v })} label="Keep technical terms exactly" />
          {controls.keepTerminology && (
            <Field label="Words that must not change">
              <div className="row">
                <input className="input grow" value={term} placeholder="Add a term" onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTerm(); }} />
                <button className="btn icon" onClick={addTerm} aria-label="Add term"><Plus /></button>
              </div>
              {(controls.glossary || []).length > 0 && (
                <div className="glossary">
                  {controls.glossary.map((g) => <span key={g} className="badge">{g}<button aria-label={`Remove ${g}`} onClick={() => set({ glossary: controls.glossary.filter((x) => x !== g) })}><X size={11} /></button></span>)}
                </div>
              )}
            </Field>
          )}
          <Toggle checked={pipeline.audit} onChange={(v) => onPipeline({ ...pipeline, audit: v })} label="Double-check meaning with a second model" />
          <Toggle checked={pipeline.autoRepair} onChange={(v) => onPipeline({ ...pipeline, autoRepair: v })} label="Fix problems automatically" />
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(applyPreset(controls, presetId || 'natural'))}><RotateCcw size={13} />Reset to recommended</button>
        </div>
      )}
    </aside>
  );
}
