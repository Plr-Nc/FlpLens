import { useMemo, useState } from 'react';
import type { Project } from '../flp/project.ts';
import { TimelineView } from '../components/TimelineView.tsx';

const TRACK_HEAD = 96;
const MIN_ROW = 10;
const MAX_ROW = 56;

export function Arrangement(props: {
  project: Project;
  arrangement: number;
  selectedPattern: number | null;
  onSelectPattern: (index: number) => void;
}) {
  const { project } = props;
  const [rowHeight, setRowHeight] = useState(18);

  const items = useMemo(
    () => project.playlist.filter((item) => item.arrangement === props.arrangement),
    [project.playlist, props.arrangement],
  );

  const ppq = project.meta.ppq || 96;
  const { numerator, denominator } = project.meta.timeSignature;
  const beatsPerBar = numerator * (4 / denominator);

  const totalTicks = useMemo(() => {
    let max = 0;
    for (const item of items) {
      const end = item.position + item.length;
      if (end > max) max = end;
    }
    return Math.max(max, ppq * 4 * 4); // at least four bars of runway
  }, [items, ppq]);

  const tracks = useMemo(
    () => [...new Set(items.map((item) => item.track))].sort((a, b) => a - b),
    [items],
  );

  const channelKind = useMemo(
    () => new Map(project.channels.map((channel) => [channel.index, channel.kind])),
    [project.channels],
  );

  const patternName = useMemo(
    () => new Map(project.patterns.map((pattern) => [pattern.index, pattern.name])),
    [project.patterns],
  );
  const channelName = useMemo(
    () => new Map(project.channels.map((channel) => [channel.index, channel.name])),
    [project.channels],
  );

  /**
   * Clips grouped by track. Filtering the flat list once per visible row would
   * be O(rows × clips) on every scroll frame — at 68 rows and 3564 clips that is
   * 240k comparisons per frame, far more than the rendering we are trying to
   * save.
   */
  const clipsByTrack = useMemo(() => {
    const grouped = new Map<number, typeof items>();
    for (const item of items) {
      const bucket = grouped.get(item.track);
      if (bucket) bucket.push(item);
      else grouped.set(item.track, [item]);
    }
    return grouped;
  }, [items]);

  if (items.length === 0) {
    return <div className="empty">这个编配里没有片段</div>;
  }

  return (
    <TimelineView
      key={props.arrangement}
      className="arr-timeline"
      totalTicks={totalTicks}
      leadingInset={TRACK_HEAD}
      ppq={ppq}
      initialPxPerBeat={26}
      minPxPerBeat={4}
      maxPxPerBeat={220}
      rowHeight={rowHeight}
      minRowHeight={MIN_ROW}
      maxRowHeight={MAX_ROW}
      onRowHeightChange={setRowHeight}
      smoothZoom={items.length <= 600}
      renderRuler={({ pxPerTick }) => {
        const barPx = beatsPerBar * ppq * pxPerTick;
        const count = Math.max(1, Math.ceil(totalTicks / (beatsPerBar * ppq)) + 1);
        return Array.from({ length: count }, (_, bar) => (
          <span key={bar} className="tl-tick" style={{ left: TRACK_HEAD + bar * barPx }}>
            {bar + 1}
          </span>
        ));
      }}
      renderOverview={() => {
        // The minimap is a miniature of the arrangement: every clip sits on its
        // own track lane, so the strip reads as a picture of the song rather
        // than one flat line.
        const lane = 100 / Math.max(1, tracks.length);
        const laneIndex = new Map(tracks.map((track, index) => [track, index]));
        return (
          <>
            {items.map((item, index) => {
              const kind =
                item.pattern !== null
                  ? 'pattern'
                  : channelKind.get(item.channel ?? -1) === 5
                    ? 'automation'
                    : 'audio';
              const row = laneIndex.get(item.track) ?? 0;
              return (
                <div
                  key={index}
                  className={`ov-clip ${kind}`}
                  style={{
                    left: `${(item.position / totalTicks) * 100}%`,
                    width: `${Math.max(0.4, (item.length / totalTicks) * 100)}%`,
                    top: `${row * lane}%`,
                    height: `${Math.max(0.6, lane)}%`,
                  }}
                />
              );
            })}
          </>
        );
      }}
      renderContent={({ pxPerTick, viewport }) => {
        /*
         * Virtualisation. Only rows intersecting the viewport (plus a few rows
         * of slack so fast scrolling does not show gaps) are rendered, and
         * inside a row only clips overlapping the visible time span. The
         * container keeps its full height so scrollbars stay truthful.
         */
        const ROW_SLACK = 3;
        const TIME_SLACK_PX = 600;
        const rowH = Math.max(1, rowHeight);
        const firstRow = Math.max(0, Math.floor(viewport.top / rowH) - ROW_SLACK);
        const lastRow = Math.min(
          tracks.length - 1,
          Math.ceil((viewport.top + viewport.height) / rowH) + ROW_SLACK,
        );
        const tickStart = (viewport.left - TIME_SLACK_PX - TRACK_HEAD) / pxPerTick;
        const tickEnd = (viewport.left + viewport.width + TIME_SLACK_PX - TRACK_HEAD) / pxPerTick;
        const visibleTracks = tracks.slice(firstRow, lastRow + 1);

        return (
          <div
            style={{
              position: 'relative',
              height: `calc(var(--row-h) * ${tracks.length})`,
            }}
          >
            {visibleTracks.map((track, offset) => {
              const rowIndex = firstRow + offset;
              const clips = clipsByTrack.get(track) ?? [];
              return (
                <div
                  key={track}
                  className="arr-row"
                  style={{
                    height: 'var(--row-h)',
                    top: `calc(var(--row-h) * ${rowIndex})`,
                  }}
                >
                  <div
                    className="arr-track-name"
                    style={{
                      height: 'var(--row-h)',
                      lineHeight: 'var(--row-h)',
                      fontSize: 'clamp(7px, calc(var(--row-h) - 6px), 12px)',
                    }}
                  >
                    {project.trackNames.get(track) || `${track}`}
                  </div>
                  {clips.map((item, index) => {
                    if (item.position + item.length < tickStart || item.position > tickEnd) {
                      return null;
                    }
                    const kind =
                      item.pattern !== null
                        ? 'pattern'
                        : channelKind.get(item.channel ?? -1) === 5
                          ? 'automation'
                          : 'audio';
                    const label =
                      item.pattern !== null
                        ? patternName.get(item.pattern) || `Pattern ${(item.pattern ?? 0) + 1}`
                        : channelName.get(item.channel ?? -1) || '';
                    const selected =
                      item.pattern !== null && item.pattern === props.selectedPattern;
                    const clipWidth = Math.max(3, item.length * pxPerTick);
                    const showLabel = clipWidth >= 26 && rowHeight >= 11;
                    return (
                      <div
                        key={index}
                        className={`arr-clip ${kind}` + (selected ? ' selected' : '')}
                        style={{
                          left: TRACK_HEAD + item.position * pxPerTick,
                          width: clipWidth,
                          height: 'calc(var(--row-h) - 4px)',
                          fontSize: 'clamp(7px, calc(var(--row-h) - 7px), 11px)',
                          lineHeight: 'calc(var(--row-h) - 4px)',
                        }}
                        title={`${label} · 轨道 ${track} · ${(item.position / ppq).toFixed(2)} 拍`}
                        onClick={() => item.pattern !== null && props.onSelectPattern(item.pattern)}
                      >
                        {showLabel ? label : ''}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      }}
    />
  );
}
