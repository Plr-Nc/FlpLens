import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseFlp } from './flp/project.ts';
import type { Project } from './flp/project.ts';
import { buildReport, hasFatal } from './flp/diagnostics.ts';
import { ChannelList, Overview } from './views/Panels.tsx';
import { Arrangement } from './views/Arrangement.tsx';
import { StyleView } from './views/StyleView.tsx';
import { Mixer } from './views/Mixer.tsx';
import { Insight } from './views/Insight.tsx';
import { Browser } from './views/Browser.tsx';
import { SplitPane } from './components/SplitPane.tsx';
import { Settings } from './components/Settings.tsx';

type Tab = 'arrangement' | 'style' | 'mixer' | 'insight' | 'overview' | 'diagnostics';

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [fileName, setFileName] = useState('');
  const [tab, setTab] = useState<Tab>('arrangement');
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<number | null>(null);
  const [arrangement, setArrangement] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Reading a 46 MB file is async; if two drops land close together the slower
  // one must not overwrite the newer one.
  const loadSeq = useRef(0);
  /**
   * Original bytes of the open file, kept so the unverified-version switch can
   * re-parse without asking the user to pick the file again.
   */
  const rawBytes = useRef<Uint8Array | null>(null);
  const [forceUnverified, setForceUnverified] = useState(false);

  /** Re-run the parser on the open file with the opposite unverified setting. */
  const toggleForceUnverified = useCallback(() => {
    const bytes = rawBytes.current;
    if (!bytes) return;
    const next = !forceUnverified;
    setForceUnverified(next);
    setProject(parseFlp(bytes, undefined, { forceUnverified: next }));
  }, [forceUnverified]);

  const load = useCallback(async (file: File) => {
    setError('');
    if (file.size === 0) {
      setError('这是一个空文件或文件夹。');
      return;
    }
    if (!/\.(flp|fst|fsc)$/i.test(file.name)) {
      setError(`不认识的扩展名：${file.name}（需要 .flp）`);
      return;
    }
    const seq = ++loadSeq.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (seq !== loadSeq.current) return; // a newer file already won
      rawBytes.current = bytes;
      const parsed = parseFlp(bytes, undefined, { forceUnverified });
      // A file we cannot parse must never replace a project that is already
      // open — otherwise a mis-drop throws away what the user was looking at.
      if (hasFatal(parsed.diagnostics)) {
        const first = parsed.diagnostics.issues.find((issue) => issue.severity === 'fatal');
        setError(`${file.name} 打不开：${first?.message ?? '不是有效的 FL Studio 工程'}`);
        return;
      }
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
      setTab(hasFatal(parsed.diagnostics) ? 'diagnostics' : 'arrangement');
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

  useEffect(() => {
    // Dropping a file anywhere must open it, never let the browser navigate to
    // it or download it. This has to live on window: once a project is open the
    // empty-state drop zone no longer exists.
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };

    const onDragLeave = (event: DragEvent) => {
      // relatedTarget is null only when the pointer leaves the window itself.
      if (event.relatedTarget === null) setDragging(false);
    };

    // Belt and braces: if the drag is cancelled outside the window no
    // dragleave fires and the overlay would stay up.
    const onDragEnd = () => setDragging(false);

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const file = Array.from(event.dataTransfer?.files ?? [])[0];
      if (file) void load(file);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
    };
  }, [load]);

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
        '1': 'arrangement',
        '2': 'style',
        '3': 'mixer',
        '4': 'overview',
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
        {project && !project.profile.verified && (
          <button
            className="badge warn badge-button"
            onClick={toggleForceUnverified}
            title={
              forceUnverified
                ? '当前显示的是未验证版本的解析结果，可能不准。点击改回只读元数据'
                : '这个 FL 版本没有验证过的解析规则。点击强制尝试解析结构'
            }
          >
            {forceUnverified ? '未验证版本 · 已强制解析' : '未验证版本 · 仅元数据'}
          </button>
        )}
        {project && fatal > 0 && <span className="badge warn">{fatal} 个致命问题</span>}
        <div className="spacer" />
        <span className="badge">{fileName || '未打开文件'}</span>
        <Settings />
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
        <div className={'drop' + (dragging ? ' over' : '')}>
          <div>
            <strong>把 .flp 拖进来</strong>
            文件只在本地解析，不会上传。支持 FL Studio 2025（其他版本降级为只读元数据）。
            {error && <div style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
          </div>
        </div>
      ) : (
        <main>
          {/* FL layout: browser on the left, channel rack on the right,
              working area in the middle. */}
          <SplitPane
            direction="horizontal"
            anchor="start"
            initial={240}
            min={170}
            max={420}
            minOther={520}
            storageKey="browser"
          >
            <Browser
              project={project}
              selectedPattern={selectedPattern}
              onSelectPattern={(index) => {
                setSelectedPattern(index);
                setTab('style');
              }}
              onSelectChannel={setSelectedChannel}
            />
            <SplitPane
              direction="horizontal"
              anchor="end"
              initial={260}
              min={180}
              max={460}
              minOther={420}
              storageKey="rack"
            >
              <ChannelList
                channels={project.channels}
                selected={selectedChannel}
                onSelect={setSelectedChannel}
              />
              <section className="content">
            <div className="tabs">
              <button className={tab === 'arrangement' ? 'active' : ''} onClick={() => setTab('arrangement')}>
                编排
              </button>
              <button className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}>
                样式
              </button>
              <button className={tab === 'mixer' ? 'active' : ''} onClick={() => setTab('mixer')}>
                混音台
              </button>
              <button className={tab === 'insight' ? 'active' : ''} onClick={() => setTab('insight')}>
                体检
              </button>
              <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
                信息
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

            {project && !project.profile.verified && !forceUnverified && (
              <div className="unverified-notice">
                <b>这个 FL 版本没有验证过的解析规则。</b>
                默认只读取了文件头（版本、BPM、拍号、通道数），编排、样式、混音台都没有解析。
                解析未知布局可能悄悄丢数据或错位，所以没有默认打开。
                <button onClick={toggleForceUnverified}>仍然尝试解析</button>
              </div>
            )}

            {tab === 'insight' && <Insight project={project} fileName={fileName} />}

            {tab === 'overview' && <Overview project={project} fileName={fileName} />}

            {tab === 'arrangement' && (
              <div className="panel panel-flush">
                <Arrangement
                  project={project}
                  arrangement={arrangement}
                  selectedPattern={selectedPattern}
                  onSelectPattern={(index) => {
                    setSelectedPattern(index);
                    setTab('style');
                  }}
                />
              </div>
            )}

            {tab === 'style' && (
              <StyleView
                project={project}
                pattern={pattern}
                ppq={project.meta.ppq}
                onPickPattern={setSelectedPattern}
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
            </SplitPane>
          </SplitPane>
        </main>
      )}

      {error && project && (
        <div className="error-bar" onClick={() => setError('')}>
          {error}（点击关闭）
        </div>
      )}

      {dragging && <div className="drop-overlay">松开以打开工程</div>}

      <footer>
        只读 · 完全离线 · 不上传 · 非官方工具，与 Image-Line 无关联
        {project && ` · 解析 ${project.channels.length} 通道 / ${project.patterns.length} 个样式`}
        {' · '}
        <span style={{ opacity: 0.7 }}>1-5 切换标签 · Ctrl+O 打开</span>
      </footer>
    </div>
  );
}
