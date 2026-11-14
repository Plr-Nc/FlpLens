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
import { useScrollColumn } from './useScrollColumn.ts';
import { useDrag } from './useDrag.ts';

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
  const column = useScrollColumn();
  const scrollRef = column.elementRef;
  const viewportRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const heightHandleRef = useRef<HTMLDivElement>(null);
  const [draggingLane, setDraggingLane] = useState(false);
  /** Middle-button grab-scroll, like FL's hand tool. */
  const pendingScrollRef = useRef<number | null>(null);


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
  /**
   * Blank run-out after the last bar.
   *
   * Without it the final clip sits flush against the right edge and there is no
   * way to scroll past the end of the song, so the tail of the last clip can
   * never be viewed comfortably. It is part of the content width, which means
   * the scrollbar, the overview proportions and the zoom clamps all account for
   * it automatically.
   */
  const TAIL_SPACE = 160;
  const contentWidth = Math.max(1, leading + props.totalTicks * pxPerTick + TAIL_SPACE);

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
      column.adopt();
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
  }, [syncViewportBox, syncLane, column]);

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
      column.write(target, subpixel);
      syncViewportBox();
      syncLane();
    },
    [column, syncViewportBox, syncLane],
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
  /**
   * Apply a zoom step to an already-clamped target scroll position.
   *
   * This used to take the anchor tick instead, and `zoomAt` refused the whole
   * step whenever honouring that anchor needed an out-of-range `scrollLeft`.
   * That guard cured a jump but introduced a worse defect: with the cursor near
   * either end of the song, zooming stopped working at all. The caller now
   * clamps the target, so the step always happens — the anchor drifts slightly
   * at the edges, which is unavoidable and far less surprising than a dead
   * wheel.
   */
  const stepZoom = useCallback(
    (next: number, targetScroll: number) => {
      pxPerBeatRef.current = next;
      // Commit scale and offset together so no frame is painted between them.
      flushSync(() => setPxPerBeat(next));
      applyScroll(targetScroll, true);
    },
    [applyScroll],
  );

  /**
   * Critically-damped follow, not a fixed-duration tween.
   *
   * A tween restarts from the current value on every wheel notch, so a burst of
   * notches spends the whole gesture "catching up" and reads as sluggish. Here
   * each notch only advances the *target*; the animation loop always moves the
   * live value a fraction of the remaining distance toward it. Back-to-back
   * notches therefore compound smoothly, and the last frame that matters is
   * three or four frames after the wheel stops — roughly 50 ms, which is under
   * the threshold where a delay feels like lag.
   *
   * The earlier flicker came from two rAF loops committing against each other;
   * there is only ever one loop here, and `stepZoom` writes scale and offset in
   * a single synchronous commit.
   */
  const zoomTarget = useRef(props.initialPxPerBeat);
  const zoomRaf = useRef(0);
  const zoomAnchor = useRef({ tick: 0, offset: 0 });

  const cancelZoomAnim = useCallback(() => {
    if (zoomRaf.current) {
      cancelAnimationFrame(zoomRaf.current);
      zoomRaf.current = 0;
    }
    zoomTarget.current = pxPerBeatRef.current;
  }, []);

  useEffect(() => () => cancelZoomAnim(), [cancelZoomAnim]);

  /*
   * Fraction of the remaining distance covered per frame, and the point at which
   * the remainder is invisible enough to snap. 0.62 / 0.4 % puts 90 % of the
   * travel into three frames (~50 ms) and finishes inside five — under the
   * threshold where a wheel starts to feel laggy, while still removing the
   * hard jump.
   */
  const FOLLOW = 0.62;
  const FOLLOW_EPSILON = 0.004;

  const easedZoom = useCallback(
    (next: number, anchorTick: number, offset: number) => {
      if (!props.smoothZoom) {
        zoomTarget.current = next;
        stepZoom(next, leading + anchorTick * (next / ppq) - offset);
        return;
      }

      // The anchor follows the newest notch; the value keeps chasing the target.
      zoomTarget.current = next;
      zoomAnchor.current = { tick: anchorTick, offset };

      if (zoomRaf.current) return; // loop already running

      const frame = () => {
        const current = pxPerBeatRef.current;
        const target = zoomTarget.current;
        const diff = target - current;

        if (Math.abs(diff) <= Math.abs(target) * FOLLOW_EPSILON) {
          zoomRaf.current = 0;
          stepZoom(target, leading + zoomAnchor.current.tick * (target / ppq) - zoomAnchor.current.offset);
          return;
        }

        const value = current + diff * FOLLOW;
        stepZoom(value, leading + zoomAnchor.current.tick * (value / ppq) - zoomAnchor.current.offset);
        zoomRaf.current = requestAnimationFrame(frame);
      };

      zoomRaf.current = requestAnimationFrame(frame);
    },
    [props.smoothZoom, stepZoom, leading, ppq],
  );

  /** Set zoom + left edge directly (used by edge-dragging the viewport box). */
  const applyView = useCallback(
    (leftTick: number, visibleTicks: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      cancelSmoothPan();
      cancelZoomAnim();
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
      const tickUnderCursor = (column.read() + offset - leading) / pxPerTickNow;

      /*
       * The anchor is passed down rather than a scroll target: `easedZoom`
       * re-derives the offset from it on every frame, and `applyScroll` clamps.
       * Refusing the step when the anchor was unreachable is what used to make
       * the wheel dead at both ends of the song.
       */
      easedZoom(next, tickUnderCursor, offset);
    },
    [ppq, leading, cancelSmoothPan, fillPxPerBeat, easedZoom, props.minPxPerBeat, props.maxPxPerBeat],
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
      // huge factor is exactly what a "sudden jump" feels like. 0.0013 gives
      // ~13 % per notch, close to FL's own step; the damped follow above is what
      // makes it feel smooth, not a small step.
      const step = Math.max(-160, Math.min(160, deltaY));
      zoomAt(clientX, Math.exp(-step * 0.0013));
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

  /**
   * The row-height handle sits on top of the ruler's right end. Without this,
   * a wheel over the last ~28px of the ruler hit the handle instead and did
   * nothing — which reads as "zooming is broken at the right edge".
   */
  useEffect(() => {
    const el = heightHandleRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomByWheel(event.clientX, event.deltaY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomByWheel]);

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
   * The viewport box: drag the middle to pan, either edge to resize.
   *
   * Edge zones scale with the box width (a fixed 10px made the box impossible to
   * resize once zoomed narrow), and the hit test is done here against the box
   * rect rather than relying on child elements — children cannot be hit at all
   * when the box is a few pixels wide.
   */
  const overviewDrag = useDrag<{
    mode: OverviewDrag['mode'];
    startX: number;
    startLeftTick: number;
    startVisibleTicks: number;
  }>(
    (event) => {
      const scroll = scrollRef.current;
      const box = viewportRef.current;
      if (!scroll || !box) return null;
      const rect = box.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const edge = Math.max(2, Math.min(10, rect.width / 3));
      const mode: OverviewDrag['mode'] =
        localX < edge ? 'left' : localX > rect.width - edge ? 'right' : 'pan';
      event.preventDefault();
      const pxPerTickNow = pxPerBeatRef.current / ppq;
      setDraggingView(true);
      setOverviewMode(mode);
      return {
        mode,
        startX: event.clientX,
        startLeftTick: (column.read() - leading) / pxPerTickNow,
        startVisibleTicks: scroll.clientWidth / pxPerTickNow,
      };
    },
    (context, event) => {
      const scroll = scrollRef.current;
      const overview = overviewRef.current;
      if (!scroll || !overview) return;
      const width = overview.clientWidth;
      if (width <= 0) return;
      const ratio = (event.clientX - context.startX) / width;
      const totalTicks = Math.max(1, props.totalTicks);

      if (context.mode === 'pan') {
        const pxPerTickNow = pxPerBeatRef.current / ppq;
        const targetLeft = context.startLeftTick + ratio * totalTicks;
        applyScroll(leading + targetLeft * pxPerTickNow, false);
        return;
      }

      if (context.mode === 'right') {
        applyView(context.startLeftTick, context.startVisibleTicks + ratio * totalTicks);
      } else {
        const newLeft = context.startLeftTick + ratio * totalTicks;
        const rightTick = context.startLeftTick + context.startVisibleTicks;
        applyView(newLeft, Math.max(MIN_VISIBLE_TICKS, rightTick - newLeft));
      }
    },
    () => {
      setDraggingView(false);
      setOverviewMode(null);
      onScrollSync();
    },
  );
  // ---- middle-button panning -------------------------------------------------

  /**
   * Grab-style pan with the middle button. The mousedown handler that stops
   * Chromium's auto-scroll widget lives on the element, not here.
   */
  const panDrag = useDrag<{ x: number; y: number; left: number; top: number }>(
    (event) => {
      const el = scrollRef.current;
      if (!el) return null;
      event.preventDefault();
      setPanning(true);
      return { x: event.clientX, y: event.clientY, left: column.read(), top: el.scrollTop };
    },
    (context, event) => {
      const el = scrollRef.current;
      if (!el) return;
      // The content follows the pointer.
      applyScroll(context.left - (event.clientX - context.x), false);
      el.scrollTop = context.top - (event.clientY - context.y);
    },
    () => setPanning(false),
    [1],
  );

  // ---- lane height ----------------------------------------------------------

  const laneMin = props.minLaneHeight ?? 56;
  const laneMax = props.maxLaneHeight ?? 260;

  const applyLaneHeight = useRafCallback<number>((value) => props.onLaneHeightChange?.(value));

  const laneDrag = useDrag<{ y: number; height: number }>(
    (event) => {
      if (!props.onLaneHeightChange) return null;
      setDraggingLane(true);
      return { y: event.clientY, height: props.laneHeight ?? 0 };
    },
    (context, event) => {
      // Dragging up makes the lane taller.
      applyLaneHeight(clamp(context.height + (context.y - event.clientY), laneMin, laneMax));
    },
    () => setDraggingLane(false),
  );

  // ---- row-height box -------------------------------------------------------

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

  const heightDrag = useDrag<{ y: number; height: number }>(
    (event) => {
      setDraggingHeight(true);
      return { y: event.clientY, height: rowHeight };
    },
    (context, event) => {
      // Dragging up makes rows taller.
      applyRowHeight(clamp(context.height + (context.y - event.clientY), minRowHeight, maxRowHeight));
    },
    () => setDraggingHeight(false),
  );

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
          onPointerDown={overviewDrag.onPointerDown}
          onPointerMove={overviewDrag.onPointerMove}
          onPointerUp={overviewDrag.onPointerUp}
          onPointerCancel={overviewDrag.onPointerCancel}
        >
          {/* Cursor affordances only; the parent does the hit-testing. */}
          <span className="ov-edge ov-edge-left" />
          <span className="ov-grab" />
          <span className="ov-edge ov-edge-right" />
        </div>
      </div>

      {/*
        `--lane-h` lets the scrollport stop above the control lane. The lane is
        absolutely positioned over the bottom of the body, so without it the
        last rows of the piano roll sat permanently behind the lane and could
        not be scrolled into view.
      */}
      <div
        className={'tl-body' + (draggingView ? ' dragging' : '') + (panning ? ' panning' : '')}
        style={
          {
            '--lane-h': `${props.renderControlLane ? (props.laneHeight ?? 0) : 0}px`,
          } as React.CSSProperties
        }
      >
        <div
          className="tl-scroll"
          ref={scrollRef}
          onScroll={onScrollSync}
          onMouseDown={(event) => {
            // Chromium starts its auto-scroll widget on middle mousedown.
            if (event.button === 1) event.preventDefault();
          }}
          onPointerDown={panDrag.onPointerDown}
          onPointerMove={panDrag.onPointerMove}
          onPointerUp={panDrag.onPointerUp}
          onPointerCancel={panDrag.onPointerCancel}
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
                onPointerDown={laneDrag.onPointerDown}
                onPointerMove={laneDrag.onPointerMove}
                onPointerUp={laneDrag.onPointerUp}
                onPointerCancel={laneDrag.onPointerCancel}
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
          ref={heightHandleRef}
          className={'tl-vresize' + (draggingHeight ? ' active' : '')}
          role="slider"
          tabIndex={0}
          aria-label="调整行高"
          aria-valuenow={Math.round(rowHeight)}
          aria-valuemin={minRowHeight}
          aria-valuemax={maxRowHeight}
          title="上下拖动改变行高"
          onPointerDown={heightDrag.onPointerDown}
          onPointerMove={heightDrag.onPointerMove}
          onPointerUp={heightDrag.onPointerUp}
          onPointerCancel={heightDrag.onPointerCancel}
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
