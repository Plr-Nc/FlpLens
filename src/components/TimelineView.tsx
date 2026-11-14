/**
 * TimelineView — the viewport chrome shared by the arrangement and the piano roll.
 *
 * FL's model:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ overview (narrow)      wheel = pan           │
 *   │   [ viewport box: drag middle = pan,          │
 *   │     drag either edge = zoom ]                 │
 *   ├──────────────────────────────────────────────┤
 *   │ ruler                  wheel = zoom     [⬍]  │  ← row-height box sits at the
 *   ├──────────────────────────────────────────────┤     ruler's right end
 *   │ content (native scroll)                      │
 *   └──────────────────────────────────────────────┘
 *
 * Cursors: the overview and ruler are plain/default; only the box edges show
 * `ew-resize`, and only the row-height box shows `ns-resize`.
 *
 * Zoom and row height are state (they change layout). Panning is native scroll,
 * so it never re-renders React.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useRafCallback } from './useRafCallback.ts';

export type Viewport = {
  /** Scroll offset and size, in content pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TimelineContent = {
  pxPerTick: number;
  contentWidth: number;
  rowHeight: number;
  /**
   * Visible rectangle. Consumers should render only what intersects it (plus a
   * little slack); everything else still occupies space through the container's
   * full height, so scrollbars stay correct without the DOM nodes existing.
   */
  viewport: Viewport;
};

export type TimelineViewProps = {
  totalTicks: number;
  /** Width in px reserved at the left for labels that stay put. */
  leadingInset?: number;
  ppq: number;
  initialPxPerBeat: number;
  minPxPerBeat: number;
  maxPxPerBeat: number;
  rowHeight: number;
  minRowHeight: number;
  maxRowHeight: number;
  onRowHeightChange: (height: number) => void;
  renderContent: (ctx: TimelineContent) => ReactNode;
  renderOverview: (ctx: { width: number; pxPerTick: number }) => ReactNode;
  renderRuler: (ctx: { pxPerTick: number; ppq: number; contentWidth: number }) => ReactNode;
  /**
   * Control-event lane pinned to the bottom of the viewport (FL's velocity /
   * pan strip). Its content must use the same pxPerTick as the main content so
   * every bar lines up with the note that produced it.
   */
  renderControlLane?: (ctx: { pxPerTick: number; contentWidth: number }) => ReactNode;
  /** Fixed strip at the top of the lane (parameter picker). Does not scroll. */
  laneHeader?: ReactNode;
  laneHeight?: number;
  /** When provided, the lane's top edge becomes a drag handle. */
  onLaneHeightChange?: (height: number) => void;
  minLaneHeight?: number;
  maxLaneHeight?: number;
  /** Ease wheel zoom over a few frames. Disable for very large projects. */
  smoothZoom?: boolean;
  className?: string;
};

type OverviewDrag = {
  mode: 'pan' | 'left' | 'right';
  pointer: number;
  startX: number;
  startLeftTick: number;
  startVisibleTicks: number;
};

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

const MIN_VISIBLE_TICKS = 8;

export function TimelineView(props: TimelineViewProps) {
  const { ppq, rowHeight, minRowHeight, maxRowHeight, onRowHeightChange } = props;

  const [pxPerBeat, setPxPerBeat] = useState(props.initialPxPerBeat);
  const [overviewWidth, setOverviewWidth] = useState(0);
  const [draggingHeight, setDraggingHeight] = useState(false);
  const [draggingView, setDraggingView] = useState(false);
  /** Which viewport-box gesture is running — the cursor must match it. */
  const [overviewMode, setOverviewMode] = useState<'pan' | 'left' | 'right' | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ left: 0, top: 0, width: 0, height: 0 });
  const [panning, setPanning] = useState(false);

  const overviewRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const heightDragRef = useRef<{ y: number; height: number; pointer: number } | null>(null);
  const laneDragRef = useRef<{ y: number; height: number; pointer: number } | null>(null);
  const [draggingLane, setDraggingLane] = useState(false);
  const overviewDragRef = useRef<OverviewDrag | null>(null);
  /** Middle-button grab-scroll, like FL's hand tool. */
  const panRef = useRef<{ x: number; y: number; left: number; top: number; pointer: number } | null>(
    null,
  );
  const pendingScrollRef = useRef<number | null>(null);
  /**
   * Sub-pixel scroll position. `scrollLeft` reads back as an integer, so using
   * it as the anchor for the next zoom folds a rounding error into every step.
   */
  const theoScrollRef = useRef(0);
  /**
   * Where we last put `scrollLeft` ourselves. Used to tell our own writes apart
   * from real scrolling: after a zoom we want to keep the sub-pixel value, after
   * a pan we must adopt the DOM value.
   */
  const lastWriteRef = useRef<number | null>(null);
  /**
   * The authoritative zoom value.
   *
   * `zoomAt` used to close over the `pxPerBeat` state. React updates state
   * asynchronously, so during a wheel burst the second tick still saw the first
   * tick's scale and the anchor moved. Keeping the value in a ref that is
   * written synchronously fixes it — and makes `zoomAt` stable, so the wheel
   * listener is bound once instead of on every render.
   */
  const pxPerBeatRef = useRef(props.initialPxPerBeat);
  /** In-flight smooth-scroll animation for the overview wheel. */
  const smoothRef = useRef<{ raf: number } | null>(null);

  const pxPerTick = pxPerBeat / ppq;
  const leading = props.leadingInset ?? 0;
  const contentWidth = Math.max(1, leading + props.totalTicks * pxPerTick);

  /**
   * Tick <-> pixel conversions must go through `leading`.
   *
   * The label column is a fixed number of pixels, so it does not scale with the
   * timeline. Treating `scrollLeft` as pure tick space silently folds it into
   * the zoom maths, which drifts the anchor by `leading * (factor - 1)` on
   * every wheel tick.
   */


  const syncViewportBox = useCallback(() => {
    const scroll = scrollRef.current;
    const box = viewportRef.current;
    if (!scroll || !box) return;
    const max = scroll.scrollWidth;
    if (max <= 0) return;
    const left = (scroll.scrollLeft / max) * 100;
    const width = Math.min(100, (scroll.clientWidth / max) * 100);
    box.style.left = `${Math.max(0, left)}%`;
    box.style.width = `${Math.max(2, width)}%`;
  }, []);

  /**
   * The control lane sits outside the scroller (it must not scroll vertically)
   * but shares its horizontal offset. One transform per scroll event keeps it
   * frame-locked with the notes; storing scrollLeft in state would re-render
   * the whole note list on every wheel tick.
   */
  const syncLane = useCallback(() => {
    const scroll = scrollRef.current;
    const lane = laneRef.current;
    if (scroll && lane) lane.style.transform = `translateX(${-scroll.scrollLeft}px)`;
  }, []);

  const onScrollSync = useCallback(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      // Adopt the DOM value unless this scroll is the echo of a write we just
      // made. Keeping our own value preserves sub-pixel precision across a zoom
      // burst; adopting on a real pan keeps the two in step.
      const ours = lastWriteRef.current;
      if (ours === null || Math.abs(scroll.scrollLeft - ours) > 2) {
        theoScrollRef.current = scroll.scrollLeft;
        lastWriteRef.current = null;
      }
      // Publish the visible rectangle for virtualised content. Compared before
      // setting so a scroll that does not actually change the window does not
      // trigger a render.
      const next = {
        left: scroll.scrollLeft,
        top: scroll.scrollTop,
        width: scroll.clientWidth,
        height: scroll.clientHeight,
      };
      setViewport((prev) =>
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    }
    syncViewportBox();
    syncLane();
  }, [syncViewportBox, syncLane]);

  /**
   * The ONLY place `scrollLeft` is written.
   *
   * It used to be assigned from six different sites (zoom, viewport-drag, pan
   * animation, middle-drag, layout effect, …), each with its own idea of whether
   * to update the theoretical position. Any two of them disagreeing produced a
   * visible jump — the class of bug this file kept re-growing. One entry point
   * makes the invariant enforceable: DOM position and `theoScrollRef` are always
   * written together.
   *
   * `subpixel = true` keeps the exact requested offset (zoom needs it, because
   * `scrollLeft` reads back rounded); `false` adopts whatever the DOM reports,
   * which is correct for gestures the user drives directly.
   */
  const applyScroll = useCallback(
    (target: number, subpixel = true) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const clamped = Math.min(Math.max(target, 0), max);
      if (Math.abs(scroll.scrollLeft - clamped) > 0.5) {
        scroll.scrollLeft = clamped;
      }
      const authoritative = subpixel ? clamped : scroll.scrollLeft;
      theoScrollRef.current = authoritative;
      lastWriteRef.current = authoritative;
      syncViewportBox();
      syncLane();
    },
    [syncViewportBox, syncLane],
  );

  /**
   * Any in-flight overview pan must die the moment another gesture starts.
   * Its last animation frame writes `scrollLeft` — and because rAF can be
   * throttled it may land *after* a zoom has positioned the view, silently
   * overwriting it. That is why the bug only appeared when you panned first.
   */
  const cancelSmoothPan = useCallback(() => {
    if (smoothRef.current) {
      cancelAnimationFrame(smoothRef.current.raf);
      smoothRef.current = null;
    }
  }, []);

  /**
   * Smallest zoom that still fills the viewport.
   *
   * Letting the content become narrower than the scroller is what produced the
   * final snap: `scrollLeft` is forced to 0, the whole song jumps left, and the
   * bar under the cursor changes completely. Keeping content >= viewport means
   * the anchor can always be honoured; zoom-out simply stops where the song
   * exactly fills the view.
   */
  const fillPxPerBeat = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll || props.totalTicks <= 0) return props.minPxPerBeat;
    const usable = Math.max(1, scroll.clientWidth - leading);
    return (usable / props.totalTicks) * ppq;
  }, [leading, ppq, props.totalTicks, props.minPxPerBeat]);

  /** Run one zoom step, optionally eased over a few frames. */
  /**
   * Apply a zoom step, synchronously.
   *
   * There is deliberately no eased interpolation. An earlier version animated
   * pxPerBeat over ~110 ms and that caused the reported flicker: each new
   * wheel notch started a second rAF loop while the previous was still
   * committing frames, so scrollLeft was pulled backwards for one frame before
   * moving forwards. Instrumentation showed the anchor tick was always correct
   * while the offset oscillated — the jitter lived entirely in the animation
   * layer, not in the maths.
   *
   * One synchronous commit is exact and stable, and ~9 % per notch already
   * reads as smooth.
   */
  const stepZoom = useCallback(
    (next: number, anchorTick: number, offset: number) => {
      const target = leading + anchorTick * (next / ppq) - offset;
      const clamped = Math.max(0, target);
      pxPerBeatRef.current = next;
      theoScrollRef.current = clamped;
      lastWriteRef.current = clamped;
      // Commit scale and offset together so no frame is painted between them.
      flushSync(() => setPxPerBeat(next));
      applyScroll(clamped, true);
    },
    [ppq, leading, syncViewportBox, syncLane],
  );

  /** Set zoom + left edge directly (used by edge-dragging the viewport box). */
  const applyView = useCallback(
    (leftTick: number, visibleTicks: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      cancelSmoothPan();
      const viewPx = scroll.clientWidth || 1;
      /*
       * Dragging the box edges must stay continuous right up to the ends of the
       * song. `zoomAt` keeps a "content fills the viewport" floor so a wheel
       * cannot snap the view, but applying that same floor here deadlocks the
       * drag the moment the box touches an edge. Edge dragging is a direct
       * manipulation — the user sees exactly what they are doing — so it is
       * allowed to go all the way down to `minPxPerBeat`.
       */
      const nextPxPerBeat = clamp(
        (viewPx / Math.max(MIN_VISIBLE_TICKS, visibleTicks)) * ppq,
        props.minPxPerBeat,
        props.maxPxPerBeat,
      );
      const nextPxPerTick = nextPxPerBeat / ppq;
      const targetScroll = Math.max(0, leading + leftTick * nextPxPerTick);
      if (Math.abs(nextPxPerBeat - pxPerBeatRef.current) < 0.001) {
        applyScroll(targetScroll, true);
        return;
      }
      pxPerBeatRef.current = nextPxPerBeat;
      theoScrollRef.current = targetScroll;
      lastWriteRef.current = targetScroll;
      setPxPerBeat(nextPxPerBeat);
      pendingScrollRef.current = targetScroll;
    },
    [ppq, leading, cancelSmoothPan, fillPxPerBeat, props.minPxPerBeat, props.maxPxPerBeat, onScrollSync],
  );

  const zoomAt = useCallback(
    (clientX: number, factor: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      cancelSmoothPan();
      // Always read the ref: state may not have committed yet.
      const current = pxPerBeatRef.current;
      const floor = Math.max(props.minPxPerBeat, fillPxPerBeat());
      const next = clamp(current * factor, floor, props.maxPxPerBeat);
      if (Math.abs(next - current) < 0.0001) return;
      const rect = scroll.getBoundingClientRect();
      const offset = clientX - rect.left;
      const pxPerTickNow = current / ppq;
      const tickUnderCursor = (theoScrollRef.current + offset - leading) / pxPerTickNow;
      const target = leading + tickUnderCursor * (next / ppq) - offset;

      /*
       * Near the ends of the song the anchor may be unreachable: keeping the
       * cursor's tick in place would need a scrollLeft outside [0, max]. Baking
       * that in is exactly the "the view suddenly jumps" report, so refuse the
       * step instead. A few pixels of clamping is imperceptible and still
       * allowed.
       */
      const nextContentWidth = leading + props.totalTicks * (next / ppq);
      const nextMaxScroll = Math.max(0, nextContentWidth - scroll.clientWidth);
      const reachable = Math.min(Math.max(target, 0), nextMaxScroll);
      if (Math.abs(reachable - target) > 4) return;

      stepZoom(next, tickUnderCursor, offset);
    },
    [ppq, leading, cancelSmoothPan, fillPxPerBeat, stepZoom, props.minPxPerBeat, props.maxPxPerBeat],
  );

  /**
   * Zoom immediately, once per wheel event.
   *
   * This used to coalesce bursts into one rAF callback. That was a correctness
   * hazard, not an optimisation: if the user scrolled the content between the
   * wheel event and the frame callback, the deferred zoom ran against a stale
   * cursor position and jumped. `zoomAt` reads all its state from refs, so
   * back-to-back calls are already exact — React batches the renders anyway.
   */
  const zoomByWheel = useCallback(
    (clientX: number, deltaY: number) => {
      // Clamp a single notch: trackpads can emit very large deltas, and one
      // huge factor is exactly what a "sudden jump" feels like.
      const step = Math.max(-120, Math.min(120, deltaY));
      zoomAt(clientX, Math.exp(-step * 0.0009));
    },
    [zoomAt],
  );

  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null) {
      const target = pendingScrollRef.current;
      pendingScrollRef.current = null;
      applyScroll(target, true);

      onScrollSync();
    }
  }, [pxPerBeat, onScrollSync]);

  useEffect(() => {
    const el = overviewRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setOverviewWidth(el.clientWidth));
    observer.observe(el);
    setOverviewWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    onScrollSync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => onScrollSync());
    observer.observe(el);
    return () => observer.disconnect();
  }, [onScrollSync, contentWidth]);

  /**
   * Wheel panning is animated with rAF instead of jumping by `delta` per event:
   * a single wheel notch on a high-resolution mouse is tiny, and stepping
   * straight to the target looks like a stutter.
   */
  const smoothPan = useCallback(
    (delta: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const from = smoothRef.current ? scroll.scrollLeft : scroll.scrollLeft;
      const target = clamp(from + delta, 0, Math.max(0, scroll.scrollWidth - scroll.clientWidth));
      if (smoothRef.current) cancelAnimationFrame(smoothRef.current.raf);
      const step = () => {
        const diff = target - scroll.scrollLeft;
        if (Math.abs(diff) < 0.6) {
          applyScroll(target, false);
          smoothRef.current = null;
          return;
        }
        applyScroll(scroll.scrollLeft + diff * 0.32, false);
        smoothRef.current = { raf: requestAnimationFrame(step) };
      };
      smoothRef.current = { raf: requestAnimationFrame(step) };
    },
    [syncViewportBox],
  );

  // Wheel over the overview strip pans horizontally.
  useEffect(() => {
    const el = overviewRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      smoothPan(delta * 1.4);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [smoothPan]);

  // Stop the animation when the component goes away.
  useEffect(
    () => () => {
      if (smoothRef.current) cancelAnimationFrame(smoothRef.current.raf);
    },
    [],
  );

  // Wheel over the ruler zooms around the cursor.
  useEffect(() => {
    const el = rulerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomByWheel(event.clientX, event.deltaY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomByWheel]);

  // ---- viewport box dragging -------------------------------------------------

  /**
   * Decide pan-vs-resize from where the pointer landed on the box.
   *
   * This used to be three absolutely-positioned child handles (left edge, grab,
   * right edge). When the box gets narrow — which is exactly when you zoom in —
   * the two 9 px edges cover it entirely and the middle grab collapses to zero
   * width, so the box "sometimes won't drag". Measuring the hit position against
   * the box itself works at any width, and a box too narrow for edges is simply
   * pan-only.
   */
  const beginOverviewDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const scroll = scrollRef.current;
    const box = viewportRef.current;
    if (!scroll || !box) return;
    const rect = box.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const EDGE = 10;
    let mode: OverviewDrag['mode'] = 'pan';
    if (rect.width > EDGE * 3) {
      if (localX < EDGE) mode = 'left';
      else if (localX > rect.width - EDGE) mode = 'right';
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const currentPxPerTick = pxPerBeatRef.current / ppq;
    overviewDragRef.current = {
      mode,
      pointer: event.pointerId,
      startX: event.clientX,
      startLeftTick: (scroll.scrollLeft - leading) / currentPxPerTick,
      startVisibleTicks: scroll.clientWidth / currentPxPerTick,
    };
    setDraggingView(true);
    setOverviewMode(mode);
  };

  const onOverviewDragMove = (event: React.PointerEvent) => {
    const drag = overviewDragRef.current;
    const scroll = scrollRef.current;
    const overview = overviewRef.current;
    if (!drag || !scroll || !overview || drag.pointer !== event.pointerId) return;
    const width = overview.clientWidth;
    if (width <= 0) return;
    const ratio = (event.clientX - drag.startX) / width;
    const totalTicks = Math.max(1, props.totalTicks);

    if (drag.mode === 'pan') {
      const currentPxPerTick = pxPerBeatRef.current / ppq;
      const targetLeft = drag.startLeftTick + ratio * totalTicks;
      applyScroll(leading + targetLeft * currentPxPerTick, false);
      return;
    }

    if (drag.mode === 'right') {
      applyView(drag.startLeftTick, drag.startVisibleTicks + ratio * totalTicks);
    } else {
      const newLeft = drag.startLeftTick + ratio * totalTicks;
      const rightTick = drag.startLeftTick + drag.startVisibleTicks;
      applyView(newLeft, Math.max(MIN_VISIBLE_TICKS, rightTick - newLeft));
    }
  };

  const endOverviewDrag = (event: React.PointerEvent) => {
    const drag = overviewDragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    overviewDragRef.current = null;
    setDraggingView(false);
    setOverviewMode(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onScrollSync();
  };

  // ---- middle-button panning -------------------------------------------------

  /**
   * Returns true when the event was consumed, so callers can stop propagation.
   * `button === 1` is the middle button; the mousedown preventDefault stops
   * Chromium's auto-scroll widget from hijacking the gesture.
   */
  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    const el = event.currentTarget;
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      pointer: event.pointerId,
    };
    setPanning(true);
  };

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const el = event.currentTarget;
    // Grab-style: the content follows the pointer.
    applyScroll(drag.left - (event.clientX - drag.x), false);
    el.scrollTop = drag.top - (event.clientY - drag.y);
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // ---- lane height ----------------------------------------------------------

  const laneMin = props.minLaneHeight ?? 56;
  const laneMax = props.maxLaneHeight ?? 260;

  const onLaneGripDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !props.onLaneHeightChange) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    laneDragRef.current = {
      y: event.clientY,
      height: props.laneHeight ?? 0,
      pointer: event.pointerId,
    };
    setDraggingLane(true);
  };

  const applyLaneHeight = useRafCallback<number>((value) => props.onLaneHeightChange?.(value));

  const onLaneGripMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = laneDragRef.current;
    if (!drag || drag.pointer !== event.pointerId || !props.onLaneHeightChange) return;
    // Dragging up makes the lane taller.
    const delta = drag.y - event.clientY;
    applyLaneHeight(clamp(drag.height + delta, laneMin, laneMax));
  };

  const onLaneGripUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = laneDragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    laneDragRef.current = null;
    setDraggingLane(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // ---- row-height box -------------------------------------------------------

  const onHeightHandleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    heightDragRef.current = { y: event.clientY, height: rowHeight, pointer: event.pointerId };
    setDraggingHeight(true);
  };

  /**
   * Row-height dragging re-lays out for real on every frame.
   *
   * An earlier version previewed the drag with `transform: scaleY` on the whole
   * content layer. That avoided layout, but it scaled the sticky ruler along
   * with the rows and left text stretched until release — visibly wrong. Real
   * layout is the only way the ruler keeps its size and labels re-fit live, so
   * the cost is paid per frame and throttled to one update per rAF.
   */
  const applyRowHeight = useRafCallback<number>((value) => onRowHeightChange(value));

  const onHeightHandleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = heightDragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const delta = drag.y - event.clientY; // dragging up makes rows taller
    applyRowHeight(clamp(drag.height + delta, minRowHeight, maxRowHeight));
  };

  const onHeightHandleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = heightDragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    heightDragRef.current = null;
    setDraggingHeight(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={
        'tl' +
        (props.className ? ' ' + props.className : '') +
        (draggingHeight ? ' height-dragging' : '')
      }
    >
      <div className="tl-overview" ref={overviewRef}>
        <div className="tl-overview-content">
          {overviewWidth > 0 && props.renderOverview({ width: overviewWidth, pxPerTick })}
        </div>
        <div
          className={
            'tl-overview-view' +
            (draggingView
              ? overviewMode === 'pan'
                ? ' drag-pan'
                : ' drag-resize'
              : '')
          }
          ref={viewportRef}
          onPointerDown={beginOverviewDrag}
          onPointerMove={onOverviewDragMove}
          onPointerUp={endOverviewDrag}
          onPointerCancel={endOverviewDrag}
        >
          {/* Cursor affordances only; the parent does the hit-testing. */}
          <span className="ov-edge ov-edge-left" />
          <span className="ov-grab" />
          <span className="ov-edge ov-edge-right" />
        </div>
      </div>

      <div className={'tl-body' + (draggingView ? ' dragging' : '') + (panning ? ' panning' : '')}>
        <div
          className="tl-scroll"
          ref={scrollRef}
          onScroll={onScrollSync}
          onMouseDown={(event) => {
            // Chromium starts its auto-scroll widget on middle mousedown.
            if (event.button === 1) event.preventDefault();
          }}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onAuxClick={(event) => event.button === 1 && event.preventDefault()}
        >
          <div
            className="tl-content"
            style={
              {
                width: contentWidth,
                paddingBottom: props.laneHeight ?? 0,
                '--row-h': `${rowHeight}px`,
              } as React.CSSProperties
            }
          >
            <div className="tl-ruler" ref={rulerRef}>
              {props.renderRuler({ pxPerTick, ppq, contentWidth })}
            </div>
            {props.renderContent({ pxPerTick, contentWidth, rowHeight, viewport })}
          </div>
        </div>

        {props.renderControlLane && (props.laneHeight ?? 0) > 0 && (
          <div
            className={'tl-lane' + (draggingLane ? ' resizing' : '')}
            style={{ height: props.laneHeight }}
          >
            {props.onLaneHeightChange && (
              <div
                className="tl-lane-grip"
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整当前显示条高度"
                title="上下拖动改变高度"
                onPointerDown={onLaneGripDown}
                onPointerMove={onLaneGripMove}
                onPointerUp={onLaneGripUp}
                onPointerCancel={onLaneGripUp}
              />
            )}
            {props.laneHeader && <div className="tl-lane-head">{props.laneHeader}</div>}
            <div className="tl-lane-track" style={{ marginLeft: leading }}>
              <div className="tl-lane-inner" ref={laneRef} style={{ width: contentWidth }}>
                {props.renderControlLane({ pxPerTick, contentWidth })}
              </div>
            </div>
          </div>
        )}

        <div
          className={'tl-vresize' + (draggingHeight ? ' active' : '')}
          role="slider"
          tabIndex={0}
          aria-label="调整行高"
          aria-valuenow={Math.round(rowHeight)}
          aria-valuemin={minRowHeight}
          aria-valuemax={maxRowHeight}
          title="上下拖动改变行高"
          onPointerDown={onHeightHandleDown}
          onPointerMove={onHeightHandleMove}
          onPointerUp={onHeightHandleUp}
          onPointerCancel={onHeightHandleUp}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 4 : 1;
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onRowHeightChange(clamp(rowHeight + step, minRowHeight, maxRowHeight));
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              onRowHeightChange(clamp(rowHeight - step, minRowHeight, maxRowHeight));
            }
          }}
        >
          <span />
        </div>
      </div>
    </div>
  );
}
