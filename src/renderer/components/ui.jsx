import React, { useEffect, useLayoutEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {(label || hint) && <span className="t-text">{label}{hint && <small>{hint}</small>}</span>}
    </label>
  );
}

export function Seg({ value, options, onChange, title }) {
  return (
    <div className="seg" role="radiogroup" aria-label={title}>
      {options.map(([v, label, tip]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} data-tip={tip || undefined}>{label}</button>
      ))}
    </div>
  );
}

/** Stepped slider with labelled ends and a live value label. */
export function Stepper({ label, value, min = -2, max = 2, labels, onChange, scale }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      <div className="label-row"><span className="label">{label}</span><span className="value">{labels ? labels[value - min] : value}</span></div>
      <input className="slider" type="range" min={min} max={max} step={1} value={value} style={{ '--fill': `${fill}%` }} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      {scale && <div className="slider-scale"><span>{scale[0]}</span><span>{scale[1]}</span></div>}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="note">{hint}</div>}
    </div>
  );
}

export function Modal({ title, icon, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          {icon}
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Dropdown menu anchored to an element. items: [{ label, icon, onClick, danger, disabled, hint } | 'sep'] */
export function Menu({ anchor, items, onClose, align = 'left' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    let left = align === 'right' ? r.right - m.width : r.left;
    let top = r.bottom + 4;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, r.top - m.height - 4);
    left = Math.min(Math.max(8, left), window.innerWidth - m.width - 8);
    setPos({ left, top });
  }, [anchor, align]);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [anchor, onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={pos} role="menu">
      {items.filter(Boolean).map((it, i) => (it === 'sep'
        ? <div key={i} className="sep" />
        : (
          <button key={i} role="menuitem" className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { onClose(); it.onClick?.(); }}>
            {it.icon}{it.label}{it.hint && <span className="hint">{it.hint}</span>}
          </button>
        )))}
    </div>,
    document.body,
  );
}

export function useMenu() {
  const [state, setState] = useState(null);
  const open = (e, items, align) => setState({ anchor: e.currentTarget, items, align });
  const node = state ? <Menu anchor={state.anchor} items={state.items} align={state.align} onClose={() => setState(null)} /> : null;
  return [open, node, Boolean(state)];
}

// ---------------------------------------------------------------------------
// Toasts and confirmation dialogs, available app-wide through context.

const UiContext = createContext(null);
export const useUi = () => useContext(UiContext);

const TOAST_ICON = { ok: <CheckCircle2 />, error: <AlertCircle />, warn: <AlertTriangle />, info: <Info /> };

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const idRef = useRef(0);

  const toast = useCallback((message, { kind = 'info', detail, duration, action } = {}) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, message, kind, detail, action }]);
    const ms = duration ?? (kind === 'error' ? 8000 : 4200);
    if (ms) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
    return id;
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...opts, resolve });
  }), []);

  const close = (v) => { dialog?.resolve(v); setDialog(null); };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {TOAST_ICON[t.kind]}
            <div className="t-body"><span>{t.message}</span>{t.detail && <small>{t.detail}</small>}</div>
            {t.action && <button className="btn sm" onClick={() => { t.action.onClick(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
            <button className="btn ghost icon sm" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X /></button>
          </div>
        ))}
      </div>
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)} footer={(
          <>
            <button className="btn" onClick={() => close(false)}>{dialog.cancelLabel || 'Cancel'}</button>
            <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>{dialog.confirmLabel || 'Continue'}</button>
          </>
        )}>
          <div className="dim" style={{ whiteSpace: 'pre-line' }}>{dialog.message}</div>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

/** Global tooltip for any element with data-tip. */
export function TooltipLayer() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer = null;
    let current = null;
    const show = (el) => {
      const r = el.getBoundingClientRect();
      setTip({ text: el.getAttribute('data-tip'), x: r.left + r.width / 2, y: r.bottom + 6 });
    };
    const over = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el === current) return;
      clearTimeout(timer);
      current = el;
      setTip(null);
      if (el && el.getAttribute('data-tip')) timer = setTimeout(() => show(el), 450);
    };
    const hide = () => { clearTimeout(timer); current = null; setTip(null); };
    window.addEventListener('mouseover', over);
    window.addEventListener('mousedown', hide);
    window.addEventListener('keydown', hide);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('mouseover', over);
      window.removeEventListener('mousedown', hide);
      window.removeEventListener('keydown', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);
  const ref = useRef(null);
  const [adj, setAdj] = useState(0);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let dx = 0;
    if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right;
    if (r.left < 8) dx = 8 - r.left;
    setAdj(dx);
  }, [tip]);
  if (!tip) return null;
  return createPortal(<div ref={ref} className="tooltip" style={{ left: tip.x + adj, top: tip.y, transform: 'translateX(-50%)' }}>{tip.text}</div>, document.body);
}

export function Progress({ value, indeterminate }) {
  return <div className={`progress${indeterminate ? ' indeterminate' : ''}`}><div style={{ width: `${Math.round((value || 0) * 100)}%` }} /></div>;
}

export function Empty({ icon, title, children, action }) {
  return (
    <div className="empty">
      {icon}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
