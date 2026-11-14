import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectPlaylistStride, parseFlp, parseNotes, pluginLabel } from '../src/flp/project.ts';
import { buildReport, hasFatal } from '../src/flp/diagnostics.ts';
import { colorToHex } from '../src/flp/events.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'minimal', 'sample.flp'));

test('reads the container header', () => {
  const project = parseFlp(new Uint8Array(fixture));
  assert.equal(project.meta.format, 0);
  assert.equal(project.meta.numChannels, 1);
  assert.equal(project.meta.ppq, 96);
  assert.equal(project.meta.version, '25.1.4.4951');
});

test('project time signature defaults to what the file declares', () => {
  const project = parseFlp(new Uint8Array(fixture));
  assert.deepEqual(project.meta.timeSignature, { numerator: 4, denominator: 4 });
  assert.equal(project.meta.useTimeSignatures, true);
});

test('channels keep kind, colour and plugin identity', () => {
  const project = parseFlp(new Uint8Array(fixture));
  assert.equal(project.channels.length, 1);
  const [channel] = project.channels;
  assert.equal(channel.name, 'Test Synth');
  assert.equal(channel.kind, 2);
  assert.equal(channel.color, '#d496c3');
});

test('notes decode as 24-byte records with the documented field order', () => {
  const project = parseFlp(new Uint8Array(fixture));
  const [pattern] = project.patterns;
  assert.equal(pattern.name, 'Verse');
  assert.equal(pattern.notes.length, 3);
  assert.deepEqual(
    pattern.notes.map((note) => [note.position, note.key, note.length]),
    [
      [0, 60, 96],
      [96, 64, 96],
      [192, 67, 48],
    ],
  );
  assert.equal(pattern.notes[0].velocity, 100);
  assert.equal(pattern.notes[0].pan, 64);
});

test('playlist items separate pattern clips from channel clips', () => {
  const project = parseFlp(new Uint8Array(fixture));
  assert.equal(project.playlist.length, 1);
  assert.deepEqual(project.playlist[0], {
    arrangement: 0,
    position: 0,
    length: 384,
    track: 1,
    pattern: 0,
    channel: null,
    group: 0,
  });
});

test('mixer inserts and slots are attributed per insert', () => {
  const project = parseFlp(new Uint8Array(fixture));
  assert.equal(project.mixer.length, 1);
  const [master] = project.mixer;
  assert.equal(master.name, 'Master');
  assert.equal(master.slots.length, 1);
  assert.equal(pluginLabel(master.slots[0]), 'Fruity Limiter');
});

test('arrangement names are captured', () => {
  const project = parseFlp(new Uint8Array(fixture));
  assert.deepEqual(project.arrangements, [0]);
  assert.equal(project.arrangementNames.get(0), 'Arrangement');
});

test('a valid fixture produces no fatal issue', () => {
  const project = parseFlp(new Uint8Array(fixture));
  assert.equal(hasFatal(project.diagnostics), false);
});

test('rejects files without the FLhd magic', () => {
  const project = parseFlp(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(hasFatal(project.diagnostics), true);
  assert.equal(project.channels.length, 0);
});

test('rejects an empty buffer', () => {
  const project = parseFlp(new Uint8Array(0));
  assert.equal(hasFatal(project.diagnostics), true);
});

test('truncated payload becomes a fatal issue, not an exception', () => {
  const cut = fixture.subarray(0, fixture.length - 8);
  const project = parseFlp(new Uint8Array(cut));
  assert.ok(
    project.diagnostics.issues.some(
      (issue) => issue.code === 'TRUNCATED' || issue.code === 'CHANNEL_COUNT_MISMATCH',
    ),
  );
});

test('playlist stride detection finds 32-byte records', () => {
  const blob = new Uint8Array(64);
  for (const at of [0, 32]) {
    blob[at + 4] = 0x00;
    blob[at + 5] = 0x50; // 20480 little-endian
    blob[at + 12] = 0xf3;
    blob[at + 13] = 0x01; // track_rvidx 499 -> track 1
  }
  assert.equal(detectPlaylistStride(blob), 32);
});

test('notes parser ignores a trailing partial record', () => {
  const blob = new Uint8Array(30);
  assert.equal(parseNotes(blob, 0).length, 1);
});

test('colours decode as 0x00BBGGRR', () => {
  // 0x004a9eff is FL's orange pattern colour, stored blue-green-red.
  assert.equal(colorToHex(0x004a9eff), '#ff9e4a');
  assert.equal(colorToHex(0), null);
});

test('diagnostics report carries no project content', () => {
  const project = parseFlp(new Uint8Array(fixture));
  const report = buildReport({
    fileSize: fixture.length,
    version: project.meta.version,
    profileId: project.profile.id,
    header: {
      format: project.meta.format,
      channels: project.meta.numChannels,
      ppq: project.meta.ppq,
      dataSize: fixture.length,
    },
    diag: project.diagnostics,
  });
  for (const secret of [project.meta.title, project.meta.comment, project.channels[0].name]) {
    if (secret && secret.length > 3) assert.equal(report.includes(secret), false, `leaked ${secret}`);
  }
});
