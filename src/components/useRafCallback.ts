import { useCallback, useEffect, useRef } from 'react';

/**
 * Coalesce a high-frequency stream of values into at most one callback per
 * frame.
 *
 * Pointer moves fire far faster than the screen refreshes (a 1000 Hz mouse can
 * emit four events per frame), and every one of them used to trigger a React
 * render. For a 3000-clip arrangement that is what makes a drag feel sticky.
 * Batching to rAF keeps the handle glued to the pointer while rendering once
 * per frame.
 */
export function useRafCallback<T>(callback: (value: T) => void): (value: T) => void {
  const frameRef = useRef(0);
  const latestRef = useRef<T | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return useCallback((value: T) => {
    latestRef.current = value;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const next = latestRef.current;
      latestRef.current = null;
      if (next !== null) callbackRef.current(next);
    });
  }, []);
}
