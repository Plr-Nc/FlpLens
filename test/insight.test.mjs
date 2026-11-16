import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventory,
  buildSnapshot,
  diffSnapshots,
  formatPan,
  formatVolume,
  parseSnapshot,
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

test('third-party plugins whose name is missing are still reported', () => {
  const p = project({
    channels: [
      channel(0, { name: 'Serum', internalName: 'Fruity Wrapper' }),
      channel(1, { name: 'Serum #2', internalName: 'Fruity Wrapper' }),
      channel(2, { name: 'Phase Plant', internalName: 'Fruity Wrapper' }),
      channel(3, { name: 'Keyscape', internalName: 'Fruity Wrapper', vst: { name: 'Keyscape', vendor: 'Spectrasonics', path: '' } }),
    ],
  });
  const inv = buildInventory(p);
  // The one with a readable name is its own entry.
  assert.equal(inv.plugins.length, 1);
  // The rest are grouped by channel name, with the clone suffix stripped.
  assert.equal(inv.stats.unidentifiedChannels, 3);
  const serum = inv.unidentifiedPlugins.find((u) => u.wrapper === 'Serum');
  assert.deepEqual(serum.channels, [0, 1]);
  const phase = inv.unidentifiedPlugins.find((u) => u.wrapper === 'Phase Plant');
  assert.deepEqual(phase.channels, [2]);
});

test("FL's own devices are counted separately from third-party plugins", () => {
  const p = project({
    channels: [
      channel(0, { name: '3x Osc', internalName: '3x Osc' }),
      channel(1, { name: '3x Osc #2', internalName: '3x Osc' }),
      channel(2, { name: 'Slicex', internalName: 'Slicex' }),
    ],
  });
  const inv = buildInventory(p);
  assert.equal(inv.plugins.length, 0);
  assert.equal(inv.unidentifiedPlugins.length, 0);
  assert.deepEqual(
    inv.nativeDevices.map((d) => [d.name, d.channels.length]),
    [
      ['3x Osc', 2],
      ['Slicex', 1],
    ],
  );
  assert.equal(inv.stats.nativeChannels, 3);
});