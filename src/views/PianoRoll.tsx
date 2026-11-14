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
  const maxTick = pattern.notes.reduce((max, note) => Math.max(max, note.position + note.length), 0);
  const beats = Math.ceil(maxTick / ppq) + 1;
  const width = beats * PX_PER_BEAT;

  const keys = pattern.notes.map((note) => note.key);
  const minKey = Math.max(LOW_KEY, Math.min(...keys) - 2);
  const maxKey = Math.min(HIGH_KEY, Math.max(...keys) + 2);
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
