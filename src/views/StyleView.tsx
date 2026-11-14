import { useMemo, useState } from 'react';
import type { Note, Pattern, Project } from '../flp/project.ts';
import { TimelineView } from '../components/TimelineView.tsx';

const LOW_KEY = 21;
const HIGH_KEY = 108;
const KEY_HEAD = 34;
const LANE_DEFAULT = 96;

/** Which note property the bottom strip plots. */
type ControlParam = 'velocity' | 'pan' | 'length' | 'key';

const PARAMS: Array<{ id: ControlParam; label: string }> = [
  { id: 'velocity', label: '力度' },
  { id: 'pan', label: '声像' },
  { id: 'length', label: '时值' },
  { id: 'key', label: '音高' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteName(key: number): string {
  return `${NOTE_NAMES[((key % 12) + 12) % 12]}${Math.floor(key / 12) - 1}`;
}

export function StyleView(props: {
  project: Project;
  pattern: Pattern | null;
  ppq: number;
  /** Channel indices that actually appear in this pattern. */
  onPickPattern: (index: number) => void;
}) {
  const { pattern, project } = props;
  const [rowHeight, setRowHeight] = useState(9);
  const [channelFilter, setChannelFilter] = useState<number | 'all'>('all');
  const [param, setParam] = useState<ControlParam>('velocity');
  const [laneHeight, setLaneHeight] = useState(LANE_DEFAULT);
  const [selectedNote, setSelectedNote] = useState<{ note: Note; index: number } | null>(null);

  const notes = pattern?.notes ?? [];

  const channelsInPattern = useMemo(() => {
    const seen = new Map<number, number>();
    for (const note of notes) seen.set(note.channel, (seen.get(note.channel) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => a[0] - b[0]);
  }, [notes]);

  const visibleNotes = useMemo(
    () => (channelFilter === 'all' ? notes : notes.filter((note) => note.channel === channelFilter)),
    [notes, channelFilter],
  );

  const bounds = useMemo(() => {
    if (visibleNotes.length === 0) return null;
    let maxTick = 0;
    let low = 127;
    let high = 0;
    for (const note of visibleNotes) {
      const end = note.position + note.length;
      if (end > maxTick) maxTick = end;
      if (note.key < low) low = note.key;
      if (note.key > high) high = note.key;
    }
    return { maxTick, low: Math.max(LOW_KEY, low - 2), high: Math.min(HIGH_KEY, high + 2) };
  }, [visibleNotes]);

  const ppq = props.ppq || 96;

  if (!pattern) {
    return <div className="empty">左边选一个样式</div>;
  }

  const totalTicks = Math.max((bounds?.maxTick ?? 0) + ppq, ppq * 8);
  const low = bounds?.low ?? 48;
  const high = bounds?.high ?? 72;
  const keyCount = high - low + 1;
  const span = Math.max(1, high - low);


  return (
    <div className="style-view">
      <div className="style-head">
        <span className="style-title">{pattern.name || `样式 ${pattern.index + 1}`}</span>
        <div className="style-channels">
          <button
            className={'chip' + (channelFilter === 'all' ? ' active' : '')}
            onClick={() => {
              setChannelFilter('all');
              setSelectedNote(null);
            }}
          >
            全部 <em>{notes.length}</em>
          </button>
          {channelsInPattern.map(([index, count]) => {
            const entry = project.channels.find((c) => c.index === index);
            return (
              <button
                key={index}
                className={'chip' + (channelFilter === index ? ' active' : '')}
                style={entry?.color ? { borderColor: channelFilter === index ? undefined : entry.color } : undefined}
                title={`通道 ${index + 1}`}
                onClick={() => {
                  setChannelFilter(index);
                  setSelectedNote(null);
                }}
              >
                {entry?.name || `通道 ${index + 1}`} <em>{count}</em>
              </button>
            );
          })}
        </div>
      </div>

      <TimelineView
        key={`${pattern.index}-${channelFilter}`}
        className="pr-timeline"
        totalTicks={totalTicks}
        leadingInset={KEY_HEAD}
        ppq={ppq}
        initialPxPerBeat={48}
        minPxPerBeat={6}
        maxPxPerBeat={400}
        rowHeight={rowHeight}
        minRowHeight={4}
        maxRowHeight={26}
        onRowHeightChange={setRowHeight}
        smoothZoom={visibleNotes.length <= 800}
        laneHeight={laneHeight}
        onLaneHeightChange={setLaneHeight}
        minLaneHeight={70}
        maxLaneHeight={260}
        laneHeader={
          <>
            <span className="lane-label">当前显示</span>
            <select
              className="lane-select"
              value={param}
              onChange={(event) => setParam(event.target.value as ControlParam)}
            >
              {PARAMS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <span className="lane-hint">
              {param === 'velocity' && `0 – 127 · 当前 ${selectedNote?.note.velocity ?? '—'}`}
              {param === 'pan' && `L 0 / C 64 / R 127 · 当前 ${selectedNote?.note.pan ?? '—'}`}
              {param === 'length' && `最长 4 拍 · 当前 ${selectedNote ? (selectedNote.note.length / ppq).toFixed(2) : '—'} 拍`}
              {param === 'key' && `MIDI ${low} – ${high} · 当前 ${selectedNote?.note.key ?? '—'}`}
            </span>
          </>
        }
        renderControlLane={({ pxPerTick }) => (
          <>
            <div className="lane-axis" />
            {visibleNotes.map((note, index) => {
              const value =
                param === 'velocity'
                  ? note.velocity / 127
                  : param === 'pan'
                    ? note.pan / 128
                    : param === 'length'
                      ? Math.min(1, note.length / (ppq * 4))
                      : (note.key - low) / span;
              // 5px grip + 24px header sit above the bars.
              const bodyHeight = Math.max(18, laneHeight - 29);
              const height = Math.max(3, Math.min(1, Math.max(0, value)) * (bodyHeight - 8));
              return (
                <div
                  key={index}
                  className={
                    'lane-bar' +
                    (note.channel % 2 === 1 ? ' alt' : '') +
                    (selectedNote?.index === index ? ' current' : '')
                  }
                  style={{
                    // The lane track is already inset by the key column, so the
                    // bar uses raw tick space — adding KEY_HEAD again would
                    // offset every bar by 34 px from its note.
                    left: note.position * pxPerTick,
                    height,
                  }}
                  title={`${PARAMS.find((entry) => entry.id === param)?.label} = ${
                    param === 'velocity'
                      ? note.velocity
                      : param === 'pan'
                        ? note.pan
                        : param === 'length'
                          ? `${(note.length / ppq).toFixed(2)} 拍`
                          : note.key
                  }`}
                />
              );
            })}
          </>
        )}
        renderRuler={({ pxPerTick }) => {
          const beatPx = ppq * pxPerTick;
          const beats = Math.ceil(totalTicks / ppq) + 1;
          return Array.from({ length: beats }, (_, beat) => (
            <span
              key={beat}
              className={'tl-tick' + (beat % 4 === 0 ? ' bar' : '')}
              style={{ left: KEY_HEAD + beat * beatPx }}
            >
              {beat % 4 === 0 ? beat / 4 + 1 : ''}
            </span>
          ));
        }}
        renderOverview={() => (
          <>
            {visibleNotes.map((note, index) => (
              <div
                key={index}
                className="ov-note"
                style={{
                  left: `${(note.position / totalTicks) * 100}%`,
                  width: `${Math.max(0.4, (note.length / totalTicks) * 100)}%`,
                  top: `${((high - note.key) / span) * 92}%`,
                }}
              />
            ))}
          </>
        )}
        renderContent={({ pxPerTick, viewport }) => {
          const ROW_SLACK = 4;
          const TIME_SLACK_PX = 600;
          const rowH = Math.max(1, rowHeight);
          const firstIndex = Math.max(0, Math.floor(viewport.top / rowH) - ROW_SLACK);
          const lastIndex = Math.min(
            keyCount - 1,
            Math.ceil((viewport.top + viewport.height) / rowH) + ROW_SLACK,
          );
          const tickStart = (viewport.left - TIME_SLACK_PX - KEY_HEAD) / pxPerTick;
          const tickEnd = (viewport.left + viewport.width + TIME_SLACK_PX - KEY_HEAD) / pxPerTick;

          return (
            <div style={{ position: 'relative', height: `calc(var(--row-h) * ${keyCount})` }}>
              {Array.from({ length: lastIndex - firstIndex + 1 }, (_, offset) => {
                const index = firstIndex + offset;
                const key = high - index;
                const isC = key % 12 === 0;
                return (
                  <div
                    key={key}
                    className={'pr-key-row' + (isC ? ' c' : '')}
                    style={{ top: `calc(var(--row-h) * ${index})`, height: 'var(--row-h)' }}
                  >
                    {isC && (
                      <span className="pr-key-label" style={{ lineHeight: 'var(--row-h)' }}>
                        {noteName(key)}
                      </span>
                    )}
                  </div>
                );
              })}
              {visibleNotes.map((note, index) => {
                // Only notes inside the visible key/time rectangle get a node.
                if (
                  note.position + note.length < tickStart ||
                  note.position > tickEnd ||
                  note.key > high - firstIndex ||
                  note.key < high - lastIndex
                ) {
                  return null;
                }
                const selected = selectedNote?.index === index;
                return (
                  <div
                    key={index}
                    className={
                      'pr-note' +
                      (note.channel % 2 === 1 ? ' alt' : '') +
                      (selected ? ' selected' : '')
                    }
                    style={{
                      left: KEY_HEAD + note.position * pxPerTick,
                      top: `calc(var(--row-h) * ${high - note.key})`,
                      width: Math.max(2, note.length * pxPerTick),
                      height: 'calc(var(--row-h) - 1px)',
                      // Velocity drives lightness, the way FL shades notes.
                      filter: `brightness(${(0.5 + (note.velocity / 127) * 0.75).toFixed(2)})`,
                    }}
                    title={`${noteName(note.key)} · 力度 ${note.velocity} · 声像 ${note.pan}`}
                    onClick={() => setSelectedNote({ note, index })}
                  />
                );
              })}
            </div>
          );
        }}
      />

    </div>
  );
}
