import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * One pointer-drag primitive for the whole timeline.
 *
 * The component used to carry four near-identical implementations (viewport box,
 * middle-button pan, lane height, row height), each with its own ref, its own
 * pointer-id bookkeeping and its own pointer-capture handling. Every bug fixed in
 * one of them had to be re-fixed in the other three, and the fourth was usually
 * forgotten. This collapses them into a single place where the invariants live:
 *
 *  - only the pointer that started the drag is tracked
 *  - capture is taken on the element, so the gesture survives leaving the element
 *  - capture is released exactly once, on up *or* cancel
 *  - a drag that returns `null` from `onStart` is ignored instead of half-started
 *
 * Callers describe *what* the drag means; this hook owns *how* a drag is run.
 */
export type DragHandlers = {
  onPointerDown: (event: ReactPointerEvent<Element>) => void;
  onPointerMove: (event: ReactPointerEvent<Element>) => void;
  onPointerUp: (event: ReactPointerEvent<Element>) => void;
  onPointerCancel: (event: ReactPointerEvent<Element>) => void;
};

type Active<T> = {
  context: T;
  pointerId: number;
};

export function useDrag<T>(
  onStart: (event: ReactPointerEvent<Element>) => T | null,
  onMove: (context: T, event: ReactPointerEvent<Element>) => void,
  onEnd?: (context: T) => void,
  /** Pointer buttons that may begin a drag. Defaults to the left button. */
  buttons: number[] = [0],
): DragHandlers {
  const active = useRef<Active<T> | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<Element>) => {
      if (!buttons.includes(event.button)) return;
      if (active.current) return; // one gesture at a time
      const context = onStart(event);
      if (context === null || context === undefined) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      active.current = { context, pointerId: event.pointerId };
    },
    [onStart, buttons],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const current = active.current;
      if (!current || current.pointerId !== event.pointerId) return;
      onMove(current.context, event);
    },
    [onMove],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<Element>) => {
      const current = active.current;
      if (!current || current.pointerId !== event.pointerId) return;
      active.current = null;
      const element = event.currentTarget;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      onEnd?.(current.context);
    },
    [onEnd],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}
