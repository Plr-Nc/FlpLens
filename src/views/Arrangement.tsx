import type { Project } from '../flp/project.ts';

const PX_PER_BEAT = 26;
const ROW_HEIGHT = 18;
const RULER_HEIGHT = 18;
const TRACK_HEAD = 76;

export function Arrangement(props: {
  project: Project;
  arrangement: number;
  selectedPattern: number | null;
  onSelectPattern: (index: number) => void;
}) {
  const { project } = props;
  const items = project.playlist.filter((item) => item.arrangement === props.arrangement);

  if (items.length === 0) {
    return <div className="empty">这个编配里没有片段</div>;
  }

  const ppq = project.meta.ppq || 96;
  const { numerator, denominator } = project.meta.timeSignature;
  const beatsPerBar = numerator * (4 / denominator);
  const maxTick = items.reduce((max, item) => Math.max(max, item.position + item.length), 0);
  const totalBeats = Math.ceil(maxTick / ppq) + 1;
  const bars = Math.ceil(totalBeats / beatsPerBar);
  const width = TRACK_HEAD + totalBeats * PX_PER_BEAT;

  const tracks = [...new Set(items.map((item) => item.track))].sort((a, b) => a - b);
  const rowIndex = new Map(tracks.map((track, index) => [track, index]));
  const height = tracks.length * ROW_HEIGHT;

  const channelKind = new Map(project.channels.map((channel) => [channel.index, channel.kind]));

  return (
    <div className="arrangement">
      <div className="arr-inner" style={{ width, height: height + RULER_HEIGHT }}>
        <div className="ruler" style={{ width }}>
          {Array.from({ length: bars }, (_, bar) => (
            <span key={bar} style={{ left: TRACK_HEAD + bar * beatsPerBar * PX_PER_BEAT }}>
              {bar + 1}
            </span>
          ))}
        </div>
        {tracks.map((track) => (
          <div
            key={track}
            className="arr-row"
            style={{ top: RULER_HEIGHT + rowIndex.get(track)! * ROW_HEIGHT, height: ROW_HEIGHT }}
          />
        ))}
        {tracks.map((track) => (
          <div
            key={`label-${track}`}
            className="track-label"
            style={{ top: RULER_HEIGHT + rowIndex.get(track)! * ROW_HEIGHT, width: TRACK_HEAD - 6 }}
            title={`轨道 ${track}`}
          >
            {project.trackNames.get(track) || `${track}`}
          </div>
        ))}
        {items.map((item, index) => {
          const kind =
            item.pattern !== null
              ? 'pattern'
              : channelKind.get(item.channel ?? -1) === 5
                ? 'automation'
                : 'audio';
          const label =
            item.pattern !== null
              ? project.patterns.find((p) => p.index === item.pattern)?.name ||
                `Pattern ${item.pattern + 1}`
              : project.channels.find((c) => c.index === item.channel)?.name ?? '';
          const selected = item.pattern !== null && item.pattern === props.selectedPattern;
          return (
            <div
              key={index}
              className={`arr-clip ${kind}` + (selected ? ' selected' : '')}
              style={{
                left: TRACK_HEAD + (item.position / ppq) * PX_PER_BEAT,
                width: Math.max(3, (item.length / ppq) * PX_PER_BEAT),
                top: RULER_HEIGHT + rowIndex.get(item.track)! * ROW_HEIGHT + 2,
              }}
              title={`${label} · 轨道 ${item.track}${
                project.trackNames.get(item.track) ? ` (${project.trackNames.get(item.track)})` : ''
              } · ${(item.position / ppq).toFixed(2)} 拍`}
              onClick={() => item.pattern !== null && props.onSelectPattern(item.pattern)}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
