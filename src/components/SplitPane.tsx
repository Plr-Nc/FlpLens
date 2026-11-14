/**
 * SplitPane — two resizable regions with a draggable divider.
 *
 * Sizing model: the first pane keeps an explicit pixel size, the second takes
 * the rest (`flex: 1`). Pixels (not ratios) match how a DAW behaves: resizing
 * the window does not silently resize the channel rack.
 *
 * To keep that promise without leaving a pane larger than its container, a
 * ResizeObserver re-clamps on every container resize. That is the structural
 * answer to "panel overflows after the window shrinks" — patching individual
 * views would not hold.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRafCallback } from './useRafCallback.ts';

export type SplitPaneProps = {
  direction: 'horizontal' | 'vertical';
  /** Which end holds the fixed-size pane. Defaults to 'start'. */
  anchor?: 'start' | 'end';
  /** First pane size in px. */
  initial: number;
  min: number;
  max: number;
  /** Minimum size the second pane may shrink to. */
  minOther?: number;
  storageKey: string;
  children: [ReactNode, ReactNode];
};

type DragState = { pointer: number; start: number; origin: number };

const STORAGE_PREFIX = 'flplens.split.';

function readStored(key: string): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    // localStorage can throw in private mode / file:// on some browsers.
    return null;
  }
}

function writeStored(key: string, value: number): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(value)));
  } catch {
    /* not fatal: the layout just won't persist */
  }
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

export function SplitPane(props: SplitPaneProps) {
  const { direction, initial, min, max, minOther = 120, storageKey, children } = props;
  const horizontal = direction === 'horizontal';
  // With `anchor="end"` the fixed pane is laid out last (row-reverse), so a
  // drag that grows it moves leftwards.
  const reverse = props.anchor === 'end';
  const sign = reverse ? -1 : 1;

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => readStored(storageKey) ?? initial);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  // `endDrag` runs from a handler created before the last pointermove render,
  // so read the committed size from a ref rather than the captured state.
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // Double-click is detected here instead of via `dblclick`: pointer capture
  // suppresses the browser's own click counting, so a native double-click never
  // fires once a drag has happened. Timing + distance is what every drag library
  // does for the same reason.
  const tapRef = useRef<{ time: number; pos: number } | null>(null);
  /** Set by pointermove; a pointerup without it is a tap, not a drag. */
  const didMoveRef = useRef(false);
  const DOUBLE_TAP_MS = 350;
  const DOUBLE_TAP_PX = 8;

  const containerSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return 0;
    return horizontal ? el.clientWidth : el.clientHeight;
  }, [horizontal]);

  /** Largest the first pane may be without starving the second one. */
  const upperBound = useCallback(() => {
    const total = containerSize();
    if (total === 0) return max;
    return Math.min(max, total - minOther);
  }, [containerSize, max, minOther]);

  // Re-clamp whenever the container itself changes size.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setSize((current) => clamp(current, min, upperBound()));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [min, upperBound]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Deliberately no preventDefault(): it suppresses the synthetic click
    // events, which kills double-click-to-reset. Text selection is stopped by
    // `user-select: none` on the divider instead.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointer: event.pointerId,
      start: horizontal ? event.clientX : event.clientY,
      origin: size,
    };
    didMoveRef.current = false;
    setDragging(true);
  };

  const applySize = useRafCallback<number>((value) => setSize(value));

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const delta = sign * ((horizontal ? event.clientX : event.clientY) - drag.start);
    if (Math.abs(delta) > 1) didMoveRef.current = true;
    applySize(clamp(drag.origin + delta, min, upperBound()));
  };

  const resetSize = useCallback(() => {
    const next = clamp(initial, min, upperBound());
    setSize(next);
    writeStored(storageKey, next);
  }, [initial, min, upperBound, storageKey]);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    writeStored(storageKey, sizeRef.current);

    const moved = didMoveRef.current;
    didMoveRef.current = false;
    if (moved) {
      tapRef.current = null;
      return;
    }
    const now = performance.now();
    const pos = horizontal ? event.clientX : event.clientY;
    const last = tapRef.current;
    if (last && now - last.time < DOUBLE_TAP_MS && Math.abs(pos - last.pos) < DOUBLE_TAP_PX) {
      tapRef.current = null;
      resetSize();
    } else {
      tapRef.current = { time: now, pos };
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const grow = horizontal ? 'ArrowRight' : 'ArrowDown';
    const shrink = horizontal ? 'ArrowLeft' : 'ArrowUp';
    let next: number | null = null;
    if (event.key === grow) next = size + step;
    else if (event.key === shrink) next = size - step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = upperBound();
    if (next === null) return;
    event.preventDefault();
    const clamped = clamp(next, min, upperBound());
    setSize(clamped);
    writeStored(storageKey, clamped);
  };

  const style = horizontal ? { width: size, flex: '0 0 auto' } : { height: size, flex: '0 0 auto' };

  return (
    <div
      ref={containerRef}
      className={
        `split split-${direction}` +
        (reverse ? ' split-reverse' : '') +
        (dragging ? ' split-dragging' : '')
      }
    >
      <div className="split-pane" style={style}>
        {children[0]}
      </div>
      <div
        className={'split-divider' + (dragging ? ' active' : '')}
        role="separator"
        tabIndex={0}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-label={horizontal ? '调整通道栏宽度' : '调整编排与钢琴卷帘的高度'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={min}
        aria-valuemax={Math.round(upperBound())}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span className="split-grip" />
      </div>
      <div className="split-pane split-rest">{children[1]}</div>
    </div>
  );
}
