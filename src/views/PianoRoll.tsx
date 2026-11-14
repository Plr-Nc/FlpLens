import type { Pattern } from '../flp/project.ts';

const PX_PER_BEAT = 22;
const KEY_HEIGHT = 6;
const LOW_KEY = 21;
const HIGH_KEY = 108;

export function PianoRoll(props: { pattern: Pattern | null; ppq: number }) {
  const { pattern } = props;
  if (!pattern || pattern.notes.length === 0) {
    return <div className="empty">选一个 pattern 看音符</div>;
  }

  const ppq = props.ppq || 96;

  // A loop, not Math.min(...keys): spread blows the call stack past ~100k notes.
  let maxTick = 0;
  let lowest = 127;
  let highest = 0;
  for (const note of pattern.notes) {
    const end = note.position + note.length;
    if (end > maxTick) maxTick = end;
    if (note.key < lowest) lowest = note.key;
    if (note.key > highest) highest = note.key;
  }

  // Clamp against corrupt values: an absurd length must not ask the browser to
  // lay out a billion-pixel SVG.
  const beats = Math.min(Math.ceil(maxTick / ppq) + 1, 8192);
  const width = beats * PX_PER_BEAT;

  const minKey = Math.max(LOW_KEY, lowest - 2);
  const maxKey = Math.min(HIGH_KEY, highest + 2);
  const rows = maxKey - minKey + 1;
  const height = rows * KEY_HEIGHT;

  const y = (key: number) => (maxKey - key) * KEY_HEIGHT;
  const x = (tick: number) => (tick / ppq) * PX_PER_BEAT;

  return (
    <div className="pianoroll">
      <svg width={width + 30} height={height + 4} style={{ display: 'block' }}>
        {/* bar lines */}
        {Array.from({ length: Math.ceil(beats / 4) + 1 }, (_, bar) => (
          <line
            key={`bar-${bar}`}
            x1={bar * 4 * PX_PER_BEAT}
            x2={bar * 4 * PX_PER_BEAT}
            y1={0}
            y2={height}
            stroke="#2c3341"
            strokeWidth={1}
          />
        ))}
        {/* beat lines */}
        {Array.from({ length: beats + 1 }, (_, beat) => (
          <line
            key={`beat-${beat}`}
            x1={beat * PX_PER_BEAT}
            x2={beat * PX_PER_BEAT}
            y1={0}
            y2={height}
            stroke="#222836"
            strokeWidth={1}
          />
        ))}
        {pattern.notes.map((note, index) => (
          <rect
            key={index}
            className={'note' + (note.channel % 2 === 1 ? ' alt' : '')}
            x={x(note.position)}
            y={y(note.key)}
            width={Math.max(2, x(note.length))}
            height={KEY_HEIGHT - 1}
            rx={1}
          >
            <title>
              {`key ${note.key} · 通道 ${note.channel + 1} · 力度 ${note.velocity} · ${(
                note.position / ppq
              ).toFixed(2)} 拍`}
            </title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
