import { useEffect, useState } from 'react';
import type { Channel, Project } from '../flp/project.ts';
import { channelKindName } from '../flp/events.ts';

const KIND_COLOR: Record<number, string> = {
  0: '#7f8fa6',
  1: '#9b7fd6',
  2: '#4a9eff',
  3: '#c0a04a',
  4: '#45c08a',
  5: '#e8a33d',
};

export function channelColor(channel: Channel): string {
  if (channel.color) return channel.color;
  return KIND_COLOR[channel.kind ?? -1] ?? '#7f8fa6';
}

export function ChannelList(props: {
  channels: Channel[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const [query, setQuery] = useState('');
  // A stale filter from the previous project looks like "no channels"; reset it
  // whenever a different project is loaded.
  useEffect(() => {
    setQuery('');
  }, [props.channels]);

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? props.channels.filter(
        (channel) =>
          channel.name.toLowerCase().includes(needle) ||
          (channel.vst?.name ?? '').toLowerCase().includes(needle) ||
          channelKindName(channel.kind).toLowerCase().includes(needle),
      )
    : props.channels;

  return (
    <aside>
      <div className="aside-head">
        通道机架 · {props.channels.length}
        {needle && ` · ${filtered.length} 匹配`}
      </div>
      <input
        className="filter"
        placeholder="搜索通道 / 插件"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        spellCheck={false}
      />
      <div className="channel-list">
        {filtered.length === 0 && <div className="empty" style={{ padding: 16 }}>没有匹配的通道</div>}
        {filtered.map((channel) => (
          <div
            key={channel.index}
            className={'channel' + (props.selected === channel.index ? ' selected' : '')}
            onClick={() => props.onSelect(channel.index)}
            title={channel.vst?.path || channel.samplePath || channel.internalName || ''}
          >
            <span className="dot" style={{ background: channelColor(channel) }} />
            <span className="name">{channel.name}</span>
            <span className="kind">{channelKindName(channel.kind)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function Overview(props: { project: Project; fileName: string }) {
  const { project } = props;
  const notes = project.patterns.reduce((sum, pattern) => sum + pattern.notes.length, 0);
  const vstCount = project.channels.filter((channel) => channel.vst).length;
  const cards: Array<[string, string]> = [
    ['工程名', project.meta.title || '（未命名）'],
    ['文件', props.fileName],
    ['FL 版本', project.meta.version || '未知'],
    ['BPM', project.meta.tempo !== null ? project.meta.tempo.toFixed(2) : '默认 140'],
    ['拍号', `${project.meta.timeSignature.numerator}/${project.meta.timeSignature.denominator}`],
    ['PPQ', String(project.meta.ppq)],
    ['通道', String(project.channels.length)],
    ['样式', String(project.patterns.length)],
    ['音符', String(notes)],
    ['编排片段', String(project.playlist.length)],
    ['编配', project.arrangements
      .map((index) => project.arrangementNames.get(index) || `#${index + 1}`)
      .join(' / ')],
    ['第三方插件', `${vstCount} 个`],
    ['混音台', `${project.mixer.length} insert`],
    ['文件大小', `${(project.byteLength / 1024).toFixed(0)} KB`],
  ];
  if (project.meta.author) cards.push(['作者', project.meta.author]);
  if (project.meta.genre) cards.push(['风格', project.meta.genre]);
  if (project.meta.url) cards.push(['链接', project.meta.url]);

  return (
    <div className="panel">
      <div className="grid">
        {cards.map(([label, value]) => (
          <div className="card" key={label}>
            <div className="label">{label}</div>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>

      {project.meta.comment && (
        <>
          <div className="section-title">工程注释</div>
          <div className="card" style={{ whiteSpace: 'pre-wrap' }}>
            {project.meta.comment}
          </div>
        </>
      )}

      {project.timeMarkers.length > 0 && (
        <>
          <div className="section-title">时间标记（{project.timeMarkers.length}）</div>
          <div className="grid">
            {project.timeMarkers.map((marker, index) => (
              <div className="card" key={index}>
                <div className="label">标记 {index + 1}</div>
                <div className="value" style={{ fontSize: 13 }}>
                  {marker.name || '（未命名）'}
                </div>
                <div className="label" style={{ marginTop: 4 }}>
                  {marker.numerator}/{marker.denominator} 拍
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">插件（{vstCount}）</div>
      {vstCount === 0 ? (
        <div className="empty">这个工程没有第三方 VST</div>
      ) : (
        <div className="grid">
          {project.channels
            .filter((channel) => channel.vst)
            .map((channel) => (
              <div className="card" key={channel.index}>
                <div className="label">{channel.name}</div>
                <div className="value" style={{ fontSize: 13 }}>
                  {channel.vst!.name}
                </div>
                <div className="label" style={{ marginTop: 4 }}>
                  {channel.vst!.vendor || '未知厂商'}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
