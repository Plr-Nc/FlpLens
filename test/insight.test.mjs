import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventory,
  buildSnapshot,
  diffSnapshots,
  formatPan,
  formatVolume,
  parseSnapshot,
  pluginsToCsv,
  samplesToCsv,
  snapshotToMarkdown,
} from '../src/flp/insight.ts';

/** Minimal project shaped like the parser's output, for isolating the analysis. */
function project(overrides = {}) {
  return {
    meta: { version: '25.1.4.4951', tempo: 140, ppq: 96 },
    byteLength: 4096,
    channels: [],
    patterns: [],
    playlist: [],
    mixer: [],
    ...overrides,
  };
}

const channel = (index, extra = {}) => ({
  index,
  kind: 2,
  name: `ch${index}`,
  internalName: '',
  vst: null,
  samplePath: '',
  color: null,
  volume: null,
  pan: null,
  ...extra,
});

const pattern = (index, noteCount, name = '') => ({
  index,
  name,
  color: null,
  notes: Array.from({ length: noteCount }, (_, i) => ({
    position: i * 96,
    length: 96,
    key: 60,
    channel: 0,
    velocity: 100,
    pan: 0,
    pattern: index,
  })),
});

test('groups plugin channels and records their indices', () => {
  const p = project({
    channels: [
      channel(0, { vst: { name: 'Serum', vendor: 'Xfer', path: 'C:/Serum.dll' } }),
      channel(1, { vst: { name: 'Serum', vendor: 'Xfer', path: 'C:/Serum.dll' } }),
      channel(2, { vst: { name: 'Kontakt', vendor: 'NI', path: 'C:/Kontakt.dll' } }),
    ],
  });
  const inv = buildInventory(p);
  assert.equal(inv.plugins.length, 2);
  const serum = inv.plugins.find((x) => x.name === 'Serum');
  assert.deepEqual(serum.channels, [0, 1]);
  assert.equal(inv.stats.pluginChannels, 3);
});

test('flags patterns that carry no notes and no clips', () => {
  const p = project({
    patterns: [pattern(0, 4), pattern(1, 0), pattern(2, 0)],
    playlist: [{ arrangement: 0, position: 0, length: 96, track: 0, pattern: 2, channel: null, group: 0 }],
  });
  const inv = buildInventory(p);
  assert.deepEqual(
    inv.unusedPatterns.map((x) => x.index),
    [1],
  );
  // pattern 2 is empty but referenced → a different problem
  assert.deepEqual(
    inv.silentPatterns.map((x) => x.index),
    [2],
  );
});

test('finds channels that nothing references', () => {
  const p = project({
    channels: [channel(0), channel(1), channel(2)],
    patterns: [pattern(0, 3)],
  });
  const inv = buildInventory(p);
  // every note in pattern 0 belongs to channel 0
  assert.deepEqual(
    inv.orphanChannels.map((x) => x.index),
    [1, 2],
  );
});

test('counts a sample loaded into several channels as duplicated', () => {
  const p = project({
    channels: [
      channel(0, { samplePath: 'C:/kick.wav' }),
      channel(1, { samplePath: 'C:/kick.wav' }),
      channel(2, { samplePath: 'C:/snare.wav' }),
    ],
  });
  const inv = buildInventory(p);
  assert.equal(inv.samples.length, 2);
  assert.deepEqual(inv.duplicatedSamples.map((s) => s.path), ['C:/kick.wav']);
});

test('snapshot captures channel state and survives a JSON round trip', () => {
  const p = project({
    channels: [channel(0, { name: 'Bass', volume: 0.78, pan: -0.12, samplePath: 'C:/bass.wav' })],
  });
  const snap = buildSnapshot(p, 'demo.flp', new Date('2026-11-16T00:00:00Z'));
  assert.equal(snap.format, 'flplens-snapshot');
  assert.equal(snap.channels[0].volume, 0.78);
  assert.equal(snap.file.name, 'demo.flp');

  const back = parseSnapshot(JSON.stringify(snap));
  assert.deepEqual(back, snap);
});

test('rejects files that are not snapshots', () => {
  assert.equal(parseSnapshot('{"format":"something-else"}'), null);
  assert.equal(parseSnapshot('not json'), null);
  assert.equal(parseSnapshot('{"format":"flplens-snapshot"}'), null);
});

test('diff reports only what changed', () => {
  const base = buildSnapshot(project({ channels: [channel(0, { volume: 0.5 })] }), 'a.flp');
  const after = buildSnapshot(project({ channels: [channel(0, { volume: 0.9 })] }), 'a.flp');
  const diff = diffSnapshots(base, after);
  assert.equal(diff.length, 1);
  assert.equal(diff[0].label, 'ch0 · 音量');
  assert.equal(diff[0].before, '-3.9 dB');
  assert.equal(diff[0].after, '+1.2 dB');
});

test('diff detects added and removed channels', () => {
  const before = buildSnapshot(project({ channels: [channel(0), channel(1)] }), 'a.flp');
  const after = buildSnapshot(project({ channels: [channel(0), channel(2)] }), 'a.flp');
  const diff = diffSnapshots(before, after);
  const added = diff.filter((d) => d.kind === 'added');
  const removed = diff.filter((d) => d.kind === 'removed');
  assert.equal(added.length, 1);
  assert.equal(added[0].label, 'ch2');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].label, 'ch1');
});

test('diff of identical snapshots is empty', () => {
  const snap = buildSnapshot(project({ channels: [channel(0, { volume: 0.7 })] }), 'a.flp');
  assert.deepEqual(diffSnapshots(snap, snap), []);
});

test('volume and pan get FL-style labels', () => {
  assert.equal(formatVolume(null), '—');
  assert.equal(formatVolume(0.78), '+0.0 dB');
  assert.equal(formatVolume(0), '-∞ dB');
  assert.equal(formatPan(null), '—');
  assert.equal(formatPan(0), '中心');
  assert.equal(formatPan(-0.5), '左 50');
  assert.equal(formatPan(0.25), '右 25');
});

test('markdown lists every channel with its state', () => {
  const snap = buildSnapshot(
    project({
      channels: [channel(0, { name: 'Kick', volume: 0.78, samplePath: 'C:/kick.wav' })],
    }),
    'demo.flp',
  );
  const md = snapshotToMarkdown(snap);
  assert.match(md, /# 轨道状态 · demo\.flp/);
  assert.match(md, /\| 0 \| Kick \|/);
  assert.match(md, /C:\/kick\.wav/);
});

test('plugin CSV quotes fields containing commas and quotes', () => {
  const p = project({
    channels: [
      channel(0, { name: 'A, B', vst: { name: 'Synth "Pro"', vendor: 'ACME, Inc', path: 'C:/x.dll' } }),
    ],
  });
  const lines = pluginsToCsv(buildInventory(p), p).split('\r\n');
  assert.equal(lines[0], '插件,厂商,路径,通道数,通道');
  // 内嵌逗号和引号都必须转义，否则 Excel 会拆错列
  assert.ok(lines[1].startsWith('"Synth ""Pro""","ACME, Inc",C:/x.dll,1,'));
  assert.ok(lines[1].endsWith('"A, B"'));
});

test('sample CSV exposes the file name next to the full path', () => {
  const p = project({
    channels: [channel(0, { name: 'Kick', samplePath: 'D:/Samples/kicks/kick_01.wav' })],
  });
  const csv = samplesToCsv(buildInventory(p), p);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '路径,文件名,通道数,通道');
  assert.match(lines[1], /D:\/Samples\/kicks\/kick_01\.wav,kick_01\.wav,1,Kick/);
});