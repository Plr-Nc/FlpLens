import { useCallback, useRef } from 'react';

/**
 * The horizontal scroll position of one column, with sub-pixel memory.
 *
 * Three refs used to model this in the component — a "pending" target, a
 * "theoretical" position and a "last write" marker — and every scroll-related
 * bug traced back to two of them disagreeing. They describe one fact, so they
 * live together here and the component can only ask for it or set it.
 *
 * Why two representations at all: `scrollLeft` is stored by the browser as an
 * integer, but zoom maths needs the exact fractional offset. Reading the DOM
 * value back after writing it silently rounds, and those roundings compound
 * across a wheel burst. `write()` therefore keeps the exact number and only
 * falls back to the DOM value for gestures the user drives directly.
 */
export type ScrollColumn = {
  elementRef: React.RefObject<HTMLDivElement | null>;
  /** Authoritative position — fractional, not rounded. */
  read: () => number;
  /**
   * Move to `target`, clamped to the scrollable range.
   * `subpixel = false` adopts whatever the DOM reports instead (panning).
   * Returns the value that was actually applied.
   */
  write: (target: number, subpixel?: boolean) => number;
  /** Call from the scroll handler: adopt the DOM value unless we just wrote it. */
  adopt: () => void;
  /** Forget the sub-pixel position and trust the DOM again (e.g. on resize). */
  reset: () => void;
};

export function useScrollColumn(): ScrollColumn {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const exact = useRef(0);
  const lastWrite = useRef<number | null>(null);

  const read = useCallback(() => exact.current, []);

  const write = useCallback((target: number, subpixel = true) => {
    const element = elementRef.current;
    if (!element) return 0;
    const max = Math.max(0, element.scrollWidth - element.clientWidth);
    const clamped = Math.min(Math.max(target, 0), max);
    if (Math.abs(element.scrollLeft - clamped) > 0.5) {
      element.scrollLeft = clamped;
    }
    // The DOM rounds; keep our own value unless the caller wants the real one.
    const authoritative = subpixel ? clamped : element.scrollLeft;
    exact.current = authoritative;
    lastWrite.current = authoritative;
    return authoritative;
  }, []);

  const adopt = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    const ours = lastWrite.current;
    // A tolerance of 2px separates "the echo of our own write" from "the user
    // scrolled": the former is at most one rounding away.
    if (ours === null || Math.abs(element.scrollLeft - ours) > 2) {
      exact.current = element.scrollLeft;
      lastWrite.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    const element = elementRef.current;
    exact.current = element ? element.scrollLeft : 0;
    lastWrite.current = null;
  }, []);

  return { elementRef, read, write, adopt, reset };
}
