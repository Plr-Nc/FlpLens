import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'flplens.fontScale';
const MIN = 0.7;
const MAX = 2;

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value >= MIN && value <= MAX ? value : 1;
  } catch {
    return 1;
  }
}

/**
 * Settings popover. Only one setting for now: the global type scale, which is
 * one CSS variable — every font-size in the stylesheet is expressed as
 * `calc(Npx * var(--font-scale))`, so this moves the whole UI at once instead of
 * patching individual rules.
 */
export function Settings() {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(readStored);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(scale));
    try {
      localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
      /* not fatal */
    }
  }, [scale]);

  // Click outside or Esc closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="settings" ref={rootRef}>
      <button
        className={'icon-btn' + (open ? ' active' : '')}
        title="设置"
        aria-label="设置"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M13.1 9.4a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1.01v.11a1.33 1.33 0 1 1-2.66 0v-.06a1.1 1.1 0 0 0-.72-1.01 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1.01-.67h-.11a1.33 1.33 0 1 1 0-2.66h.06a1.1 1.1 0 0 0 1.01-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.88-1.88l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1.01v-.11a1.33 1.33 0 1 1 2.66 0v.06a1.1 1.1 0 0 0 .67 1.01 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1.01.67h.11a1.33 1.33 0 1 1 0 2.66h-.06a1.1 1.1 0 0 0-1.01.67Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="settings-panel" role="dialog" aria-label="设置">
          <div className="settings-title">显示</div>
          <label className="settings-field">
            <span>字体大小</span>
            <b>{Math.round(scale * 100)}%</b>
          </label>
          <input
            className="settings-range"
            type="range"
            min={MIN}
            max={MAX}
            step={0.05}
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
          />
          <div className="settings-actions">
            <button onClick={() => setScale(1)}>重置</button>
            <button onClick={() => setScale(1.3)}>放大</button>
            <button onClick={() => setScale(0.8)}>缩小</button>
          </div>
        </div>
      )}
    </div>
  );
}
