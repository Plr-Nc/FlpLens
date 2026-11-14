import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseFlp } from './flp/project.ts';
import type { Project } from './flp/project.ts';
import { buildReport } from './flp/diagnostics.ts';
import { ChannelList, Overview, PatternPicker } from './views/Panels.tsx';
import { Arrangement } from './views/Arrangement.tsx';
import { PianoRoll } from './views/PianoRoll.tsx';
import { Mixer } from './views/Mixer.tsx';

type Tab = 'overview' | 'arrangement' | 'patterns' | 'mixer' | 'diagnostics';

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [fileName, setFileName] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<number | null>(null);
  const [arrangement, setArrangement] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (file: File) => {
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseFlp(bytes);
      setProject(parsed);
      setFileName(file.name);
      setArrangement(parsed.arrangements[0] ?? 0);
      setSelectedChannel(parsed.channels[0]?.index ?? null);
      // Pick the richest pattern so the piano roll shows something on open.
      const richest = parsed.patterns.reduce<typeof parsed.patterns[number] | null>(
        (best, item) => (best === null || item.notes.length > best.notes.length ? item : best),
        null,
      );
      setSelectedPattern(richest?.index ?? null);
      setTab(parsed.diagnostics.issues.some((issue) => issue.severity === 'fatal') ? 'diagnostics' : 'overview');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProject(null);
    }
  }, []);

  const report = useMemo(() => {
    if (!project) return '';
    return buildReport({
      fileSize: project.byteLength,
      version: project.meta.version,
      profileId: project.profile.id,
      header: {
        format: project.meta.format,
        channels: project.meta.numChannels,
        ppq: project.meta.ppq,
        dataSize: project.byteLength,
      },
      diag: project.diagnostics,
    });
  }, [project]);

  const pattern = useMemo(
    () => project?.patterns.find((item) => item.index === selectedPattern) ?? null,
    [project, selectedPattern],
  );

  const issues = project?.diagnostics.issues ?? [];
  const fatal = issues.filter((issue) => issue.severity === 'fatal').length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        inputRef.current?.click();
        return;
      }
      if (!project) return;
      const tabs: Record<string, Tab> = {
        '1': 'overview',
        '2': 'arrangement',
        '3': 'patterns',
        '4': 'mixer',
        '5': 'diagnostics',
      };
      const next = tabs[event.key];
      if (next) setTab(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [project]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          FlpLens<span>FL Studio 工程查看器</span>
        </div>
        {project && <span className="badge ok">{project.meta.version || 'unknown'}</span>}
        {project && !project.profile.verified && <span className="badge warn">未验证版本</span>}
        {project && fatal > 0 && <span className="badge warn">{fatal} 个致命问题</span>}
        <div className="spacer" />
        <span className="badge">{fileName || '未打开文件'}</span>
        <button onClick={() => inputRef.current?.click()}>打开 .flp</button>
        <input
          ref={inputRef}
          type="file"
          accept=".flp,.fst,.fsc"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void load(file);
            event.target.value = '';
          }}
        />
      </header>

      {!project ? (
        <div
          className={'drop' + (dragging ? ' over' : '')}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void load(file);
          }}
        >
          <div>
            <strong>把 .flp 拖进来</strong>
            文件只在本地解析，不会上传。支持 FL Studio 2025（其他版本降级为只读元数据）。
            {error && <div style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
          </div>
        </div>
      ) : (
        <main>
          <ChannelList channels={project.channels} selected={selectedChannel} onSelect={setSelectedChannel} />
          <section className="content">
            <div className="tabs">
              <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
                信息
              </button>
              <button
                className={tab === 'arrangement' ? 'active' : ''}
                onClick={() => setTab('arrangement')}
              >
                编排
              </button>
              <button className={tab === 'patterns' ? 'active' : ''} onClick={() => setTab('patterns')}>
                Pattern
              </button>
              <button className={tab === 'mixer' ? 'active' : ''} onClick={() => setTab('mixer')}>
                混音台
              </button>
              <button
                className={tab === 'diagnostics' ? 'active' : ''}
                onClick={() => setTab('diagnostics')}
              >
                诊断 · {issues.length}
              </button>
              <div className="spacer" />
              {tab === 'arrangement' && project.arrangements.length > 1 && (
                <select
                  value={arrangement}
                  onChange={(event) => setArrangement(Number(event.target.value))}
                  style={{
                    background: 'var(--panel-2)',
                    color: 'var(--text)',
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    padding: '5px 8px',
                  }}
                >
                  {project.arrangements.map((index) => (
                    <option key={index} value={index}>
                      编配 {index + 1}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {tab === 'overview' && <Overview project={project} fileName={fileName} />}

            {tab === 'arrangement' && (
              <div className="panel">
                <Arrangement
                  project={project}
                  arrangement={arrangement}
                  selectedPattern={selectedPattern}
                  onSelectPattern={setSelectedPattern}
                />
                <div className="section-title">
                  钢琴卷帘 ·{' '}
                  {pattern ? pattern.name || `Pattern ${pattern.index + 1}` : '未选择 pattern'}
                </div>
                <PianoRoll pattern={pattern} ppq={project.meta.ppq} />
              </div>
            )}

            {tab === 'patterns' && (
              <PatternPicker
                patterns={project.patterns}
                selected={selectedPattern}
                onSelect={(index) => {
                  setSelectedPattern(index);
                  setTab('arrangement');
                }}
              />
            )}

            {tab === 'mixer' && <Mixer project={project} />}

            {tab === 'diagnostics' && (
              <div className="panel">
                <div className="section-title">问题（{issues.length}）</div>
                {issues.length === 0 && <div className="empty">没有发现问题</div>}
                {issues.map((issue, index) => (
                  <div className={'issue ' + issue.severity} key={index}>
                    <code>{issue.code}</code>
                    <span>{issue.message}</span>
                  </div>
                ))}
                <div className="section-title">
                  诊断报告（可复制，不含工程名 / 通道名 / 路径）
                </div>
                <pre className="report">{report}</pre>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(report);
                  }}
                >
                  复制诊断报告
                </button>
              </div>
            )}
          </section>
        </main>
      )}

      <footer>
        只读 · 完全离线 · 不上传 · 非官方工具，与 Image-Line 无关联
        {project && ` · 解析 ${project.channels.length} 通道 / ${project.patterns.length} pattern`}
        {' · '}
        <span style={{ opacity: 0.7 }}>1-5 切换标签 · Ctrl+O 打开</span>
      </footer>
    </div>
  );
}
