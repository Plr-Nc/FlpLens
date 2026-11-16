import { useCallback, useMemo, useRef, useState } from 'react';
import { parseFlp } from '../flp/project.ts';
import type { Project } from '../flp/project.ts';
import {
  buildInventory,
  buildSnapshot,
  diffSnapshots,
  parseSnapshot,
  snapshotToMarkdown,
  type DiffEntry,
  type Snapshot,
} from '../flp/insight.ts';
import { safeFileName, saveGeneratedFile } from '../components/saveFile.ts';
import { Disclosure } from './Disclosure.tsx';

/**
 * Read-only inspection: what this project depends on, what it wastes, and how
 * its channel state compares to another snapshot.
 *
 * None of this is possible in FL Studio without opening every channel by hand,
 * and all of it works purely on data the parser already produced.
 */
export function Insight(props: { project: Project; fileName: string | null }) {
  const { project, fileName } = props;
  const inventory = useMemo(() => buildInventory(project), [project]);
  const [status, setStatus] = useState('');
  const [before, setBefore] = useState<Snapshot | null>(null);
  const [after, setAfter] = useState<Snapshot | null>(null);
  const [preview, setPreview] = useState<'plugins' | 'samples' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const slot = useRef<'before' | 'after'>('before');

  const baseName = safeFileName((fileName ?? 'project').replace(/\.flp$/i, ''), 'project');

  const exportSnapshot = useCallback(
    async (format: 'json' | 'md') => {
      const snapshot = buildSnapshot(project, fileName);
      const text = format === 'json' ? JSON.stringify(snapshot, null, 2) : snapshotToMarkdown(snapshot);
      const outcome = await saveGeneratedFile(text, {
        name: `${baseName}.snapshot.${format}`,
        mime: format === 'json' ? 'application/json' : 'text/markdown',
        extension: `.${format}`,
        description: format === 'json' ? 'FlpLens 轨道状态快照' : '轨道状态清单',
      });
      setStatus(
        outcome === 'cancelled'
          ? '已取消'
          : outcome === 'saved'
            ? `已保存 ${format.toUpperCase()}`
            : `已下载 ${format.toUpperCase()}`,
      );
    },
    [project, fileName, baseName],
  );


  const loadSlot = (which: 'before' | 'after') => {
    slot.current = which;
    fileInput.current?.click();
  };

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    let snapshot: Snapshot | null = null;

    if (/\.flp$/i.test(file.name)) {
      // Comparing two projects directly is the common case; requiring a manual
      // snapshot export first was a pointless extra step.
      try {
        const other = parseFlp(new Uint8Array(await file.arrayBuffer()));
        snapshot = buildSnapshot(other, file.name);
      } catch (error) {
        setStatus(`无法解析 ${file.name}：${error instanceof Error ? error.message : '未知错误'}`);
        return;
      }
    } else {
      snapshot = parseSnapshot(await file.text());
    }

    if (!snapshot) {
      setStatus('这个文件既不是 .flp，也不是 FlpLens 快照');
      return;
    }
    if (slot.current === 'before') setBefore(snapshot);
    else setAfter(snapshot);
    setStatus(`已载入 ${file.name}`);
  };

  const diff: DiffEntry[] = useMemo(
    () => (before && after ? diffSnapshots(before, after) : []),
    [before, after],
  );

  const useCurrentAsSnapshot = (which: 'before' | 'after') => {
    const snap = buildSnapshot(project, fileName);
    if (which === 'before') setBefore(snap);
    else setAfter(snap);
    setStatus(`已把当前工程设为${
      which === 'before' ? '「之前」' : '「之后」'
    }`);
  };

  return (
    <div className="panel insight">
      <input
        ref={fileInput}
        type="file"
        accept=".flp,.json,application/json"
        style={{ display: 'none' }}
        onChange={onPick}
      />

      <Disclosure title="这个页面回答什么" defaultOpen={false} meta="点开看说明">
      <div className="insight-intro">
        <b>这个页面回答三个问题</b>
        <ol>
          <li>
            <b>两个工程差在哪？</b>
            选两个 <code>.flp</code>，直接列出变化的通道、音量、BPM、音符数。
            FL 没有这个功能——改完一周后你通常记不清自己动过什么。
          </li>
          <li>
            <b>这个工程依赖什么？</b>
            用了哪些插件、哪些采样文件。换电脑、重装系统、拔移动硬盘之前先看一眼，
            比在 FL 里一个个点弹窗强。
          </li>
          <li>
            <b>哪里浪费了？</b>
            空样式、没发声的通道、同一采样被加载多次——删掉能减小体积、少占内存。
          </li>
        </ol>
      </div>
      </Disclosure>

      {/* ---- snapshot export ------------------------------------------- */}
      <Disclosure title="轨道状态快照" defaultOpen meta="JSON / Markdown">
      <div className="insight-row">
        <button onClick={() => exportSnapshot('json')}>导出 JSON</button>
        <button onClick={() => exportSnapshot('md')}>导出清单 (Markdown)</button>
        <button onClick={() => setPreview(preview === 'plugins' ? null : 'plugins')}>
          {preview === 'plugins' ? '收起设备' : '查看设备'}
        </button>

        <button onClick={() => setPreview(preview === 'samples' ? null : 'samples')}>
          {preview === 'samples' ? '收起采样' : '查看采样'}
        </button>

      </div>
      <div className="insight-hint insight-hint-block">
        快照记录每个通道的音量、声像、插件和采样，纯文本、可进 git、可跨工程比对。
        明细可以直接在下面查看，不需要导出文件。
      </div>
      </Disclosure>

      {/* ---- diff ------------------------------------------------------ */}
      <Disclosure title="工程对比" defaultOpen meta={before && after ? `${diff.length} 处差异` : '选两个 .flp'}>
      <div className="insight-row">
        <span className="insight-slot">
          <b>之前</b>
          <span className="insight-slot-name">{before ? before.file.name || before.createdAt.slice(0, 10) : '未选择'}</span>
        </span>
        <button onClick={() => loadSlot('before')}>选 .flp…</button>
        <button onClick={() => useCurrentAsSnapshot('before')}>用当前</button>
        <span className="insight-arrow">→</span>
        <span className="insight-slot">
          <b>之后</b>
          <span className="insight-slot-name">{after ? after.file.name || after.createdAt.slice(0, 10) : '未选择'}</span>
        </span>
        <button onClick={() => loadSlot('after')}>选 .flp…</button>
        <button onClick={() => useCurrentAsSnapshot('after')}>用当前</button>
      </div>

      {before && after && (
        diff.length === 0 ? (
          <div className="empty">两个快照完全相同</div>
        ) : (
          <div className="insight-diff">
            {diff.map((entry) => (
              <div className={`diff-row diff-${entry.kind}`} key={entry.key}>
                <span className="diff-kind">
                  {entry.kind === 'added' ? '新增' : entry.kind === 'removed' ? '删除' : '变动'}
                </span>
                <span className="diff-label">{entry.label}</span>
                <span className="diff-before">{entry.before ?? '—'}</span>
                <span className="diff-arrow">→</span>
                <span className="diff-after">{entry.after ?? '—'}</span>
              </div>
            ))}
          </div>
        )
      )}
      </Disclosure>

      {/* ---- inline preview ---------------------------------------------
          The same rows the table below summarises, rendered directly so the
          data can be checked without any file round-trip. */}
      {preview && (
        <Disclosure
          title="明细清单"
          defaultOpen
          meta={preview === 'plugins' ? '插件与设备' : '采样文件'}
        >
          <div className="section-title">
            {preview === 'plugins'
              ? `插件与设备（${
                  inventory.plugins.length +
                  inventory.unidentifiedPlugins.length +
                  inventory.nativeDevices.length
                } 类 / ${
                  inventory.stats.pluginChannels +
                  inventory.stats.unidentifiedChannels +
                  inventory.stats.nativeChannels
                } 个通道）`
              : `采样清单（${inventory.samples.length}）`}
            <span className="insight-count">
              {preview === 'plugins'
                ? `VST ${inventory.plugins.length} 种 · 名称未读到 ${inventory.stats.unidentifiedChannels} 个 · FL 原生 ${inventory.nativeDevices.length} 种`
                : `${inventory.stats.sampleChannels} 个通道引用`}
            </span>
          </div>
          <div className="insight-preview">
            {preview === 'plugins' ? (
              <table>
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>来源</th>
                    <th>通道数</th>
                    <th>通道</th>
                    <th>路径</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.plugins.map((plugin) => (
                    <tr key={`vst|${plugin.name}|${plugin.vendor}`}>
                      <td>{plugin.name}</td>
                      <td className="dim">{plugin.vendor || 'VST'}</td>
                      <td>{plugin.channels.length}</td>
                      <td className="dim">
                        {plugin.channels
                          .map((index) => project.channels.find((c) => c.index === index)?.name ?? `#${index}`)
                          .join(' / ')}
                      </td>
                      <td className="dim path" title={plugin.path}>
                        {plugin.path || '—'}
                      </td>
                    </tr>
                  ))}
                  {inventory.unidentifiedPlugins.map((plugin) => (
                    <tr key={`unknown|${plugin.wrapper}`} className="row-unidentified">
                      <td>{plugin.wrapper}</td>
                      <td className="dim" title="FL 的插件记录里没有可读名称，这里用的是通道名">
                        VST · 名称未读到
                      </td>
                      <td>{plugin.channels.length}</td>
                      <td className="dim">
                        {plugin.channels
                          .slice(0, 6)
                          .map((index) => project.channels.find((c) => c.index === index)?.name ?? `#${index}`)
                          .join(' / ')}
                        {plugin.channels.length > 6 ? ` … 另 ${plugin.channels.length - 6} 个` : ''}
                      </td>
                      <td className="dim">—</td>
                    </tr>
                  ))}
                  {inventory.nativeDevices.map((device) => (
                    <tr key={`native|${device.name}`}>
                      <td>{device.name}</td>
                      <td className="dim">FL 原生</td>
                      <td>{device.channels.length}</td>
                      <td className="dim">
                        {device.channels
                          .slice(0, 6)
                          .map((index) => project.channels.find((c) => c.index === index)?.name ?? `#${index}`)
                          .join(' / ')}
                        {device.channels.length > 6 ? ` … 另 ${device.channels.length - 6} 个` : ''}
                      </td>
                      <td className="dim">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>文件名</th>
                    <th>通道数</th>
                    <th>通道</th>
                    <th>路径</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.samples.map((sample) => (
                    <tr key={sample.path}>
                      <td>{sample.path.split(/[\\/]/).pop()}</td>
                      <td>{sample.channels.length}</td>
                      <td className="dim">
                        {sample.channels
                          .map((index) => project.channels.find((c) => c.index === index)?.name ?? `#${index}`)
                          .join(' / ')}
                      </td>
                      <td className="dim path">{sample.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Disclosure>
      )}

      {/* ---- inventory ------------------------------------------------- */}
      <Disclosure
        title="依赖体检"
        defaultOpen
        meta={`${inventory.stats.channels} 通道 / ${inventory.stats.patterns} 样式 / ${inventory.stats.notes} 音符`}
      >
      <div className="insight-grid">
        <Stat
          label="插件与设备"
          value={
            inventory.plugins.length +
            inventory.unidentifiedPlugins.length +
            inventory.nativeDevices.length
          }
          note={`VST ${inventory.plugins.length} 种 · 名称未读到 ${inventory.stats.unidentifiedChannels} 个`}
        />
        <Stat label="采样文件" value={inventory.samples.length} note={`独立路径 · ${inventory.stats.sampleChannels} 个通道引用`} />
        <Stat
          label="空样式"
          value={inventory.unusedPatterns.length}
          note="没音符也没被用，可删"
          warn={inventory.unusedPatterns.length > 0}
        />
        <Stat
          label="闲置通道"
          value={inventory.orphanChannels.length}
          note="不发声，占着机架位置"
          warn={inventory.orphanChannels.length > 0}
        />
        <Stat
          label="重复采样"
          value={inventory.duplicatedSamples.length}
          note="同一文件被加载多次"
          warn={inventory.duplicatedSamples.length > 0}
        />
        <Stat
          label="无声样式"
          value={inventory.silentPatterns.length}
          note="编排里有片段但没内容"
          warn={inventory.silentPatterns.length > 0}
        />
      </div>
      </Disclosure>

      {inventory.duplicatedSamples.length > 0 && (
        <Disclosure
          title="重复加载的采样"
          defaultOpen={false}
          meta={`${inventory.duplicatedSamples.length} 组`}
        >
          <div className="insight-table">
            {inventory.duplicatedSamples.map((sample) => (
              <div className="insight-trow" key={sample.path}>
                <span title={sample.path}>{sample.path.split(/[\\/]/).pop()}</span>
                <span className="dim">{sample.channels.length} 个通道</span>
                <span className="dim" title={sample.path}>
                  {sample.path}
                </span>
              </div>
            ))}
          </div>
        </Disclosure>
      )}

      {inventory.orphanChannels.length > 0 && (
        <Disclosure
          title="闲置通道"
          defaultOpen={false}
          meta={`${inventory.orphanChannels.length} 个`}
        >
          <div className="insight-chips">
            {inventory.orphanChannels.map((channel) => (
              <span className="insight-chip" key={channel.index}>
                {channel.name} <em>{channel.kind}</em>
              </span>
            ))}
          </div>
        </Disclosure>
      )}

      {inventory.unusedPatterns.length > 0 && (
        <Disclosure title="空样式" defaultOpen={false} meta={`${inventory.unusedPatterns.length} 个`}>
          <div className="insight-chips">
            {inventory.unusedPatterns.map((pattern) => (
              <span className="insight-chip" key={pattern.index}>
                {pattern.name || `样式 ${pattern.index + 1}`}
              </span>
            ))}
          </div>
        </Disclosure>
      )}

      {status && <div className="insight-status">{status}</div>}
    </div>
  );
}

function Stat(props: { label: string; value: number; note: string; warn?: boolean }) {
  return (
    <div className={'insight-stat' + (props.warn ? ' warn' : '')}>
      <div className="label">{props.label}</div>
      <div className="value">{props.value}</div>
      <div className="note">{props.note}</div>
    </div>
  );
}
