import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Pattern, Project } from '../flp/project.ts';
import { buildMidi, type MidiNote, type MidiTrackSpec } from '../flp/midi.ts';

/** How note sources become MIDI tracks. */
type StemMode = 'channel' | 'single';
/** How much the user can tune. */
type Detail = 'minimal' | 'advanced';

type Options = {
  detail: Detail;
  stem: StemMode;
  trimLeadingSilence: boolean;
  tempo: boolean;
  timeSignature: boolean;
  names: boolean;
  pan: boolean;
  volume: boolean;
};

const MINIMAL: Options = {
  detail: 'minimal',
  stem: 'channel',
  trimLeadingSilence: true,
  tempo: true,
  timeSignature: true,
  names: true,
  pan: false,
  volume: false,
};

const ADVANCED_DEFAULTS: Options = {
  detail: 'advanced',
  stem: 'channel',
  trimLeadingSilence: true,
  tempo: true,
  timeSignature: true,
  names: true,
  pan: true,
  volume: true,
};

type SaveResult = 'saved' | 'downloaded' | 'cancelled' | 'error';

/**
 * Save a byte array. Uses the File System Access API when available so the user
 * picks the exact folder; otherwise falls back to a normal download.
 */
async function saveFile(name: string, bytes: Uint8Array): Promise<SaveResult> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (options: unknown) => Promise<{
      createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: 'MIDI 文件', accept: { 'audio/midi': ['.mid'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return 'saved';
    } catch (cause) {
      const name = (cause as { name?: string })?.name;
      if (name === 'AbortError') return 'cancelled';
      // Anything else (older Chromium without the flag, permission denied) can
      // still fall back to a download rather than failing outright.
    }
  }

  try {
    // Copy into a plain ArrayBuffer: TS 5.8 types Uint8Array as possibly
    // backed by SharedArrayBuffer, which Blob does not accept.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
  } catch {
    return 'error';
  }
}

function safeFileName(text: string): string {
  const cleaned = text.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'pattern';
}

export function ExportMidi(props: {
  project: Project;
  pattern: Pattern;
  ppq: number;
}) {
  const { project, pattern, ppq } = props;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options>(MINIMAL);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });

  /*
   * The panel is portalled to <body>: its parent is the style header, which uses
   * `overflow: auto` so the channel chips can scroll. An absolutely positioned
   * panel opening downwards gets clipped by that container and never appears —
   * the bug that made the whole panel invisible.
   */
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 320;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      setAnchor({ left, top: Math.min(rect.bottom + 6, window.innerHeight - 200) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Channel indices that actually carry notes in this pattern. */
  const channels = useMemo(() => {
    const counts = new Map<number, number>();
    for (const note of pattern.notes) counts.set(note.channel, (counts.get(note.channel) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [pattern.notes]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const activeChannels = selected.size > 0 ? selected : new Set(channels.map(([index]) => index));

  const notesFor = (channelIndex: number): MidiNote[] =>
    pattern.notes
      .filter((note) => note.channel === channelIndex)
      .map((note) => ({
        position: note.position,
        length: note.length,
        key: note.key,
        velocity: note.velocity,
        pan: note.pan,
        channel: note.channel,
      }));

  const buildTracks = (): MidiTrackSpec[] => {
    const channelEntries = channels.filter(([index]) => activeChannels.has(index));

    if (options.stem === 'single') {
      const notes = channelEntries.flatMap(([index]) => notesFor(index));
      const pans = notes.map((note) => note.pan);
      return [
        {
          name: pattern.name || `样式 ${pattern.index + 1}`,
          midiChannel: 0,
          notes,
          pan: pans.length ? Math.round(pans.reduce((a, b) => a + b, 0) / pans.length) : 64,
        },
      ];
    }

    return channelEntries.map(([index], position) => {
      const entry = project.channels.find((channel) => channel.index === index);
      const notes = notesFor(index);
      const pans = notes.map((note) => note.pan);
      return {
        name: entry?.name || `通道 ${index + 1}`,
        midiChannel: position % 16,
        notes,
        pan: pans.length ? Math.round(pans.reduce((a, b) => a + b, 0) / pans.length) : 64,
        volume: entry?.volume != null ? Math.round(entry.volume * 127) : undefined,
      };
    });
  };

  const run = async () => {
    setBusy(true);
    setStatus('');
    try {
      const tracks = buildTracks().filter((track) => track.notes.length > 0);
      if (tracks.length === 0) {
        setStatus('没有可导出的音符');
        return;
      }
      const bytes = buildMidi({
        ppq,
        bpm: project.meta.tempo || 120,
        timeSignature: project.meta.timeSignature,
        tracks,
        includeTempo: options.tempo,
        includeTimeSignature: options.timeSignature,
        includeNames: options.names,
        includePan: options.pan,
        includeVolume: options.volume,
        trimLeadingSilence: options.trimLeadingSilence,
      });
      const fileName = `${safeFileName(pattern.name || `样式${pattern.index + 1}`)}.mid`;
      const result = await saveFile(fileName, bytes);
      if (result === 'saved') setStatus(`已保存 ${fileName}（${bytes.length} 字节）`);
      else if (result === 'downloaded') setStatus(`已下载 ${fileName}（${bytes.length} 字节）`);
      else if (result === 'cancelled') setStatus('已取消');
      else setStatus('保存失败');
    } catch (cause) {
      setStatus(`导出失败：${(cause as Error)?.message ?? '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-midi" ref={triggerRef}>
      <button
        className="export-trigger"
        onClick={() => {
          setOpen((value) => !value);
          setStatus('');
        }}
        title="把这个样式导出为 MIDI"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        MIDI
      </button>

      {open &&
        createPortal(
          <div
            className="export-panel"
            role="dialog"
            aria-label="导出 MIDI"
            ref={panelRef}
            style={{ position: 'fixed', left: anchor.left, top: anchor.top }}
          >
          <div className="export-head">
            <span>导出 MIDI</span>
            <button className="export-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
          </div>

          <div className="export-modes">
            <button
              className={'export-mode' + (options.detail === 'minimal' ? ' active' : '')}
              onClick={() => setOptions(MINIMAL)}
            >
              <b>极简</b>
              <span>一键导出，按通道分轨</span>
            </button>
            <button
              className={'export-mode' + (options.detail === 'advanced' ? ' active' : '')}
              onClick={() => setOptions(ADVANCED_DEFAULTS)}
            >
              <b>详细</b>
              <span>自己调分轨与内容</span>
            </button>
          </div>

          {options.detail === 'advanced' && (
            <div className="export-advanced">
              <label className="export-row">
                <span>分轨方式</span>
                <select
                  value={options.stem}
                  onChange={(event) =>
                    setOptions({ ...options, stem: event.target.value as StemMode })
                  }
                >
                  <option value="channel">按 FL 通道（每通道一轨）</option>
                  <option value="single">全部合并为一轨</option>
                </select>
              </label>

              <div className="export-checks">
                <label>
                  <input
                    type="checkbox"
                    checked={options.trimLeadingSilence}
                    onChange={(e) => setOptions({ ...options, trimLeadingSilence: e.target.checked })}
                  />
                  去掉开头的空白
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.tempo}
                    onChange={(e) => setOptions({ ...options, tempo: e.target.checked })}
                  />
                  写入速度（{Math.round(project.meta.tempo || 120)} BPM）
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.timeSignature}
                    onChange={(e) => setOptions({ ...options, timeSignature: e.target.checked })}
                  />
                  写入拍号
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.names}
                    onChange={(e) => setOptions({ ...options, names: e.target.checked })}
                  />
                  写入轨道名
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.pan}
                    onChange={(e) => setOptions({ ...options, pan: e.target.checked })}
                  />
                  写入声像（CC10）
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.volume}
                    onChange={(e) => setOptions({ ...options, volume: e.target.checked })}
                  />
                  写入通道音量（CC7）
                </label>
              </div>

              <div className="export-stems">
                <div className="export-stems-head">
                  <span>导出的分轨</span>
                  <button
                    onClick={() => setSelected(new Set())}
                    disabled={selected.size === 0}
                  >
                    全选
                  </button>
                </div>
                {channels.map(([index, count]) => {
                  const entry = project.channels.find((channel) => channel.index === index);
                  const checked = activeChannels.has(index);
                  return (
                    <label key={index} className="export-stem">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(activeChannels);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          setSelected(next.size === channels.length ? new Set() : next);
                        }}
                      />
                      <span
                        className="dot"
                        style={{ background: entry?.color ?? 'var(--pattern)' }}
                      />
                      {entry?.name || `通道 ${index + 1}`}
                      <em>{count}</em>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="export-foot">
            <button className="export-go" onClick={run} disabled={busy}>
              {busy ? '导出中…' : options.detail === 'minimal' ? '导出' : '导出（选择位置）'}
            </button>
            {status && <span className="export-status">{status}</span>}
          </div>

          <p className="export-note">
            导出的是这个样式里的音符。不含任何 FL Studio 的内容——没有采样、没有插件预设、没有波形。
          </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
