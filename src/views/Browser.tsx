import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Project } from '../flp/project.ts';

type BrowserTab = 'patterns' | 'samples' | 'envelopes';

const PatternIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" />
    <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" opacity="0.55" />
    <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.55" />
    <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" />
  </svg>
);

const SampleIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M1 8h1.6l1.2-4 1.6 8 1.6-6 1.4 4.6 1.3-3 1.4 5 1.4-3.4 1.1 2H15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

const EnvelopeIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M1.5 13V4l3.5 6 3-7 3 8 3.5-5v7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

const TABS: Array<{ id: BrowserTab; label: string; icon: () => ReactElement }> = [
  { id: 'patterns', label: '样式', icon: PatternIcon },
  { id: 'samples', label: '采样', icon: SampleIcon },
  { id: 'envelopes', label: '包络', icon: EnvelopeIcon },
];

export function Browser(props: {
  project: Project;
  selectedPattern: number | null;
  onSelectPattern: (index: number) => void;
  onSelectChannel: (index: number) => void;
}) {
  const [tab, setTab] = useState<BrowserTab>('patterns');
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();

  const patterns = useMemo(() => {
    // How often each pattern is placed in any arrangement — FL shows this too.
    const uses = new Map<number, number>();
    for (const item of props.project.playlist) {
      if (item.pattern !== null) uses.set(item.pattern, (uses.get(item.pattern) ?? 0) + 1);
    }
    return props.project.patterns
      .map((pattern) => ({ pattern, uses: uses.get(pattern.index) ?? 0 }))
      .filter((entry) => entry.pattern.notes.length > 0 || entry.uses > 0)
      .filter(
        (entry) =>
          !needle ||
          (entry.pattern.name || `Pattern ${entry.pattern.index + 1}`)
            .toLowerCase()
            .includes(needle),
      );
  }, [props.project.patterns, props.project.playlist, needle]);

  const samples = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ path: string; name: string; channel: number }> = [];
    for (const channel of props.project.channels) {
      const path = channel.samplePath;
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const name = path.split(/[\\/]/).pop() ?? path;
      if (needle && !name.toLowerCase().includes(needle)) continue;
      list.push({ path, name, channel: channel.index });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [props.project.channels, needle]);

  const envelopes = useMemo(
    () =>
      props.project.channels
        .filter((channel) => channel.kind === 5)
        .filter((channel) => !needle || channel.name.toLowerCase().includes(needle)),
    [props.project.channels, needle],
  );

  const count =
    tab === 'patterns' ? patterns.length : tab === 'samples' ? samples.length : envelopes.length;

  return (
    <aside className="browser">
      <div className="browser-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            title={label}
            className={'browser-tab' + (tab === id ? ' active' : '')}
            onClick={() => {
              setTab(id);
              setQuery('');
            }}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <input
        className="filter"
        placeholder={`搜索${TABS.find((entry) => entry.id === tab)?.label ?? ''}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        spellCheck={false}
      />

      <div className="browser-list">
        {count === 0 && (
          <div className="empty" style={{ padding: 16 }}>
            {tab === 'patterns' && '没有样式'}
            {tab === 'samples' && '这个工程没有引用采样文件'}
            {tab === 'envelopes' && '这个工程没有自动化/包络通道'}
          </div>
        )}

        {tab === 'patterns' &&
          patterns.map(({ pattern, uses }) => (
            <div
              key={pattern.index}
              className={'browser-item' + (props.selectedPattern === pattern.index ? ' selected' : '')}
              onClick={() => props.onSelectPattern(pattern.index)}
              title={`${pattern.notes.length} 个音符 · 编排中出现 ${uses} 次`}
            >
              <span className="dot" style={{ background: pattern.color ?? 'var(--pattern)' }} />
              <span className="name">{pattern.name || `Pattern ${pattern.index + 1}`}</span>
              <span className="meta">{pattern.notes.length}</span>
            </div>
          ))}

        {tab === 'samples' &&
          samples.map((sample) => (
            <div
              key={sample.path}
              className="browser-item"
              onClick={() => props.onSelectChannel(sample.channel)}
              title={sample.path}
            >
              <span className="dot" style={{ background: 'var(--audio)' }} />
              <span className="name">{sample.name}</span>
            </div>
          ))}

        {tab === 'envelopes' &&
          envelopes.map((channel) => (
            <div
              key={channel.index}
              className="browser-item"
              onClick={() => props.onSelectChannel(channel.index)}
              title={`通道 ${channel.index + 1}`}
            >
              <span className="dot" style={{ background: channel.color ?? 'var(--automation)' }} />
              <span className="name">{channel.name}</span>
            </div>
          ))}
      </div>

      <div className="browser-foot">{count} 项</div>
    </aside>
  );
}
