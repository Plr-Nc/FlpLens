import type { Project } from './project.ts';
import { channelKindName } from './events.ts';

/**
 * Read-only analysis over an already-parsed project.
 *
 * Everything here works on data the parser already produced — no new event
 * decoding, no format writing. That keeps the whole module free of any
 * question about what it is allowed to touch: it only reorganises what the
 * user's own file already says.
 */

export type PluginUsage = {
  name: string;
  vendor: string;
  path: string;
  /** Channel indices that load this plugin. */
  channels: number[];
};

export type SampleUsage = {
  path: string;
  channels: number[];
};

export type PatternUsage = {
  index: number;
  name: string;
  noteCount: number;
  /** How many playlist clips reference this pattern. */
  clips: number;
};

export type Inventory = {
  plugins: PluginUsage[];
  samples: SampleUsage[];
  /** Patterns with no notes that no clip references. */
  unusedPatterns: PatternUsage[];
  /** Channels that appear in no pattern, no clip and no automation clip. */
  orphanChannels: { index: number; name: string; kind: string }[];
  /** The same sample path loaded into more than one channel. */
  duplicatedSamples: SampleUsage[];
  /** Patterns referenced by clips but carrying no notes. */
  silentPatterns: PatternUsage[];
  stats: {
    channels: number;
    patterns: number;
    notes: number;
    clips: number;
    pluginChannels: number;
    sampleChannels: number;
  };
};

/** Group values by a key, preserving first-seen order. */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function buildInventory(project: Project): Inventory {
  const clipsPerPattern = new Map<number, number>();
  for (const item of project.playlist) {
    if (item.pattern === null) continue;
    clipsPerPattern.set(item.pattern, (clipsPerPattern.get(item.pattern) ?? 0) + 1);
  }

  // A channel is "used" if it owns notes, owns a playlist clip, or is the target
  // of an automation clip. Anything else occupies a slot in the rack for nothing.
  const usedChannels = new Set<number>();
  for (const pattern of project.patterns) {
    for (const note of pattern.notes) usedChannels.add(note.channel);
  }
  for (const item of project.playlist) {
    if (item.channel !== null) usedChannels.add(item.channel);
  }

  const pluginGroups = groupBy(
    project.channels.filter((channel) => channel.vst),
    (channel) => `${channel.vst!.name}\u0000${channel.vst!.vendor}`,
  );
  const plugins: PluginUsage[] = [...pluginGroups.values()].map((channels) => ({
    name: channels[0].vst!.name,
    vendor: channels[0].vst!.vendor,
    path: channels[0].vst!.path,
    channels: channels.map((channel) => channel.index),
  }));
  plugins.sort((a, b) => a.name.localeCompare(b.name));

  const sampleGroups = groupBy(
    project.channels.filter((channel) => channel.samplePath),
    (channel) => channel.samplePath,
  );
  const samples: SampleUsage[] = [...sampleGroups.entries()].map(([path, channels]) => ({
    path,
    channels: channels.map((channel) => channel.index),
  }));
  samples.sort((a, b) => a.path.localeCompare(b.path));

  const patterns: PatternUsage[] = project.patterns.map((pattern) => ({
    index: pattern.index,
    name: pattern.name,
    noteCount: pattern.notes.length,
    clips: clipsPerPattern.get(pattern.index) ?? 0,
  }));

  const unusedPatterns = patterns.filter((p) => p.noteCount === 0 && p.clips === 0);
  const silentPatterns = patterns.filter((p) => p.noteCount === 0 && p.clips > 0);

  const orphanChannels = project.channels
    .filter((channel) => !usedChannels.has(channel.index))
    .map((channel) => ({
      index: channel.index,
      name: channel.name,
      kind: channelKindName(channel.kind),
    }));

  const duplicatedSamples = samples.filter((sample) => sample.channels.length > 1);

  return {
    plugins,
    samples,
    unusedPatterns,
    orphanChannels,
    duplicatedSamples,
    silentPatterns,
    stats: {
      channels: project.channels.length,
      patterns: project.patterns.length,
      notes: project.patterns.reduce((sum, p) => sum + p.notes.length, 0),
      clips: project.playlist.length,
      pluginChannels: project.channels.filter((channel) => channel.vst).length,
      sampleChannels: project.channels.filter((channel) => channel.samplePath).length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* snapshots                                                                   */
/* -------------------------------------------------------------------------- */

export type ChannelState = {
  index: number;
  name: string;
  kind: string;
  /** 0..1, or null when the file does not carry it. */
  volume: number | null;
  /** -1..1 with 0 at centre, or null. */
  pan: number | null;
  plugin: string | null;
  sample: string | null;
};

export type Snapshot = {
  format: 'flplens-snapshot';
  version: 1;
  createdAt: string;
  file: {
    name: string;
    size: number;
    flVersion: string;
    tempo: number | null;
    ppq: number;
    channels: number;
    patterns: number;
    notes: number;
    clips: number;
  };
  channels: ChannelState[];
};

export function buildSnapshot(project: Project, fileName: string | null, now = new Date()): Snapshot {
  return {
    format: 'flplens-snapshot',
    version: 1,
    createdAt: now.toISOString(),
    file: {
      name: fileName ?? '',
      size: project.byteLength,
      flVersion: project.meta.version ?? '',
      tempo: project.meta.tempo,
      ppq: project.meta.ppq,
      channels: project.channels.length,
      patterns: project.patterns.length,
      notes: project.patterns.reduce((sum, p) => sum + p.notes.length, 0),
      clips: project.playlist.length,
    },
    channels: project.channels.map((channel) => ({
      index: channel.index,
      name: channel.name,
      kind: channelKindName(channel.kind),
      volume: channel.volume,
      pan: channel.pan,
      plugin: channel.vst?.name ?? null,
      sample: channel.samplePath || null,
    })),
  };
}

/** dB-style label for a 0..1 fader value, matching how FL shows it. */
export function formatVolume(volume: number | null): string {
  if (volume === null) return '—';
  if (volume <= 0) return '-∞ dB';
  // FL's default fader maps ~0.78 to unity; keep the display relative to that.
  const db = 20 * Math.log10(volume / 0.78);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function formatPan(pan: number | null): string {
  if (pan === null) return '—';
  if (Math.abs(pan) < 0.005) return '中心';
  const amount = Math.round(Math.abs(pan) * 100);
  return `${pan < 0 ? '左' : '右'} ${amount}`;
}

export function snapshotToMarkdown(snapshot: Snapshot): string {
  const lines: string[] = [];
  const { file } = snapshot;
  lines.push(`# 轨道状态 · ${file.name || '未命名工程'}`);
  lines.push('');
  lines.push(`导出时间：${snapshot.createdAt}`);
  lines.push(
    `工程：${file.channels} 通道 / ${file.patterns} 样式 / ${file.notes} 音符 / ${file.clips} 片段` +
      (file.flVersion ? ` · FL ${file.flVersion}` : ''),
  );
  lines.push('');
  lines.push('| # | 通道 | 类型 | 音量 | 声像 | 插件 | 采样 |');
  lines.push('|---|------|------|------|------|------|------|');
  for (const channel of snapshot.channels) {
    const cells = [
      String(channel.index),
      channel.name || '（未命名）',
      channel.kind,
      formatVolume(channel.volume),
      formatPan(channel.pan),
      channel.plugin ?? '—',
      channel.sample ?? '—',
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* diff                                                                        */
/* -------------------------------------------------------------------------- */

export type DiffKind = 'added' | 'removed' | 'changed';

export type DiffEntry = {
  kind: DiffKind;
  scope: 'file' | 'channel';
  /** Stable identifier: `channel:3` or `file:tempo`. */
  key: string;
  label: string;
  before: string | number | null;
  after: string | number | null;
};

const FILE_FIELDS: Array<[keyof Snapshot['file'], string]> = [
  ['channels', '通道数'],
  ['patterns', '样式数'],
  ['notes', '音符数'],
  ['clips', '片段数'],
  ['tempo', 'BPM'],
];

const CHANNEL_FIELDS: Array<[keyof ChannelState, string]> = [
  ['name', '名称'],
  ['kind', '类型'],
  ['volume', '音量'],
  ['pan', '声像'],
  ['plugin', '插件'],
  ['sample', '采样'],
];

function formatChannelField(field: keyof ChannelState, value: unknown): string {
  if (field === 'volume') return formatVolume(value as number | null);
  if (field === 'pan') return formatPan(value as number | null);
  if (value === null || value === '') return '—';
  return String(value);
}

/**
 * Compare two snapshots of the same (or different) project.
 *
 * Returns only what actually differs, so a 300-channel project that changed one
 * fader produces one line instead of a wall of unchanged rows.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): DiffEntry[] {
  const out: DiffEntry[] = [];

  for (const [field, label] of FILE_FIELDS) {
    const a = before.file[field];
    const b = after.file[field];
    if (a !== b) {
      out.push({
        kind: 'changed',
        scope: 'file',
        key: `file:${String(field)}`,
        label,
        before: a as string | number | null,
        after: b as string | number | null,
      });
    }
  }

  const byIndex = (snapshot: Snapshot) =>
    new Map(snapshot.channels.map((channel) => [channel.index, channel]));
  const aMap = byIndex(before);
  const bMap = byIndex(after);

  for (const [index, channel] of bMap) {
    const old = aMap.get(index);
    if (!old) {
      out.push({
        kind: 'added',
        scope: 'channel',
        key: `channel:${index}`,
        label: channel.name || `通道 ${index}`,
        before: null,
        after: channel.plugin ?? channel.name,
      });
      continue;
    }
    for (const [field, label] of CHANNEL_FIELDS) {
      const a = old[field];
      const b = channel[field];
      if (a === b) continue;
      out.push({
        kind: 'changed',
        scope: 'channel',
        key: `channel:${index}:${String(field)}`,
        label: `${channel.name || `通道 ${index}`} · ${label}`,
        before: formatChannelField(field, a),
        after: formatChannelField(field, b),
      });
    }
  }

  for (const [index, channel] of aMap) {
    if (bMap.has(index)) continue;
    out.push({
      kind: 'removed',
      scope: 'channel',
      key: `channel:${index}`,
      label: channel.name || `通道 ${index}`,
      before: channel.plugin ?? channel.name,
      after: null,
    });
  }

  return out;
}

/** Parse a snapshot file, returning null rather than throwing on anything odd. */
export function parseSnapshot(text: string): Snapshot | null {
  try {
    const value = JSON.parse(text) as Partial<Snapshot>;
    if (value.format !== 'flplens-snapshot') return null;
    if (!Array.isArray(value.channels) || !value.file) return null;
    return value as Snapshot;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* csv exports                                                                 */
/* -------------------------------------------------------------------------- */

/** Quote a CSV cell, doubling embedded quotes. */
function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function pluginsToCsv(inventory: Inventory, project: Project): string {
  const names = new Map(project.channels.map((channel) => [channel.index, channel.name]));
  const rows = [['插件', '厂商', '路径', '通道数', '通道'].join(',')];
  for (const plugin of inventory.plugins) {
    rows.push(
      [
        cell(plugin.name),
        cell(plugin.vendor),
        cell(plugin.path),
        cell(plugin.channels.length),
        cell(plugin.channels.map((index) => names.get(index) ?? `#${index}`).join(' / ')),
      ].join(','),
    );
  }
  return rows.join('\r\n');
}

export function samplesToCsv(inventory: Inventory, project: Project): string {
  const names = new Map(project.channels.map((channel) => [channel.index, channel.name]));
  const rows = [['路径', '文件名', '通道数', '通道'].join(',')];
  for (const sample of inventory.samples) {
    const fileName = sample.path.split(/[\\/]/).pop() ?? sample.path;
    rows.push(
      [
        cell(sample.path),
        cell(fileName),
        cell(sample.channels.length),
        cell(sample.channels.map((index) => names.get(index) ?? `#${index}`).join(' / ')),
      ].join(','),
    );
  }
  return rows.join('\r\n');
}