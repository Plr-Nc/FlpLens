import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMidi } from '../src/flp/midi.ts';

const ascii = (bytes, start, length) =>
  String.fromCharCode(...bytes.slice(start, start + length));
const u16 = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];
const u32 = (bytes, at) =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

/**
 * Minimal SMF reader used only by these tests. Parsing the real structure is far
 * more reliable than scanning for byte patterns — a delta value can equal 0x90.
 */
function parseSmf(bytes) {
  assert.equal(ascii(bytes, 0, 4), 'MThd');
  const headerLength = u32(bytes, 4);
  const format = u16(bytes, 8);
  const trackCount = u16(bytes, 10);
  const division = u16(bytes, 12);

  let pos = 8 + headerLength;
  const tracks = [];

  for (let t = 0; t < trackCount; t++) {
    assert.equal(ascii(bytes, pos, 4), 'MTrk', `track ${t} chunk`);
    const length = u32(bytes, pos + 4);
    let p = pos + 8;
    const end = p + length;
    let tick = 0;
    const events = [];
    let runningStatus = 0;

    while (p < end) {
      // delta
      let delta = 0;
      for (;;) {
        const byte = bytes[p++];
        delta = (delta << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) break;
      }
      tick += delta;

      let status = bytes[p];
      if (status < 0x80) {
        status = runningStatus; // running status: reuse previous
      } else {
        p++;
        if (status < 0xf0) runningStatus = status;
      }

      if (status === 0xff) {
        const type = bytes[p++];
        let metaLength = 0;
        for (;;) {
          const byte = bytes[p++];
          metaLength = (metaLength << 7) | (byte & 0x7f);
          if ((byte & 0x80) === 0) break;
        }
        const data = bytes.slice(p, p + metaLength);
        p += metaLength;
        events.push({ tick, kind: 'meta', type, data });
        continue;
      }

      const kind = status & 0xf0;
      if (kind === 0xc0 || kind === 0xd0) {
        events.push({ tick, kind, status, a: bytes[p], b: null });
        p += 1;
      } else {
        events.push({ tick, kind, status, a: bytes[p], b: bytes[p + 1] });
        p += 2;
      }
    }

    tracks.push({ length, events });
    pos = end;
  }

  return { format, trackCount, division, tracks };
}

const baseOptions = {
  ppq: 96,
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  includeTempo: true,
  includeTimeSignature: true,
  includeNames: true,
  includePan: false,
  includeVolume: false,
  trimLeadingSilence: false,
};

test('SMF header is well formed', () => {
  const bytes = buildMidi({
    ...baseOptions,
    tracks: [
      {
        name: 'Lead',
        midiChannel: 0,
        notes: [{ position: 0, length: 96, key: 60, velocity: 100, pan: 64, channel: 0 }],
      },
    ],
  });
  const smf = parseSmf(bytes);
  assert.equal(smf.format, 1);
  assert.equal(smf.trackCount, 2, 'conductor + 1 note track');
  assert.equal(smf.division, 96);
  assert.equal(smf.tracks.length, 2);
});

test('conductor track carries tempo 120 BPM and 4/4', () => {
  const bytes = buildMidi({ ...baseOptions, tracks: [] });
  const smf = parseSmf(bytes);
  const conductor = smf.tracks[0].events;

  const tempo = conductor.find((e) => e.kind === 'meta' && e.type === 0x51);
  assert.ok(tempo, 'tempo meta present');
  assert.deepEqual([...tempo.data], [0x07, 0xa1, 0x20], '500000 µs per quarter');

  const ts = conductor.find((e) => e.kind === 'meta' && e.type === 0x58);
  assert.ok(ts, 'time signature meta present');
  assert.equal(ts.data[0], 4, 'numerator');
  assert.equal(ts.data[1], 2, 'denominator = 2^2');

  const eot = conductor[conductor.length - 1];
  assert.equal(eot.type, 0x2f, 'conductor ends with End Of Track');
});

test('note off precedes note on at the same tick', () => {
  const bytes = buildMidi({
    ...baseOptions,
    tracks: [
      {
        name: 'X',
        midiChannel: 0,
        notes: [
          { position: 0, length: 96, key: 60, velocity: 100, pan: 64, channel: 0 },
          { position: 96, length: 96, key: 60, velocity: 100, pan: 64, channel: 0 },
        ],
      },
    ],
  });
  const notes = parseSmf(bytes).tracks[1].events.filter((e) => e.kind === 0x80 || e.kind === 0x90);

  // At tick 96 the previous note must be closed before the new one starts,
  // otherwise a strict parser treats it as a retrigger that never ends.
  const at96 = notes.filter((e) => e.tick === 96);
  assert.equal(at96.length, 2, 'one off and one on at tick 96');
  assert.equal(at96[0].kind, 0x80, 'note-off comes first');
  assert.equal(at96[1].kind, 0x90, 'note-on comes second');
});

test('every track ends with End Of Track', () => {
  const bytes = buildMidi({
    ...baseOptions,
    tracks: [
      { name: 'A', midiChannel: 0, notes: [{ position: 0, length: 10, key: 60, velocity: 90, pan: 64, channel: 0 }] },
      { name: 'B', midiChannel: 1, notes: [{ position: 5, length: 10, key: 64, velocity: 90, pan: 64, channel: 1 }] },
    ],
  });
  const smf = parseSmf(bytes);
  assert.equal(smf.tracks.length, 3);
  for (const [index, track] of smf.tracks.entries()) {
    const last = track.events[track.events.length - 1];
    assert.equal(last.kind, 'meta', `track ${index} ends with meta`);
    assert.equal(last.type, 0x2f, `track ${index} ends with End Of Track`);
  }
});

test('trimLeadingSilence shifts the earliest onset to zero', () => {
  const make = (trim) =>
    buildMidi({
      ...baseOptions,
      trimLeadingSilence: trim,
      tracks: [
        {
          name: 'A',
          midiChannel: 0,
          notes: [{ position: 480, length: 96, key: 60, velocity: 100, pan: 64, channel: 0 }],
        },
      ],
    });

  const firstOn = (bytes) =>
    parseSmf(bytes).tracks[1].events.find((e) => e.kind === 0x90);

  assert.equal(firstOn(make(false)).tick, 480, 'untrimmed keeps the gap');
  assert.equal(firstOn(make(true)).tick, 0, 'trimmed starts at zero');
});

test('pan and volume controllers are emitted only when asked', () => {
  const notes = [{ position: 0, length: 10, key: 60, velocity: 100, pan: 20, channel: 0 }];
  const plain = parseSmf(
    buildMidi({ ...baseOptions, tracks: [{ name: 'A', midiChannel: 0, notes }] }),
  );
  const rich = parseSmf(
    buildMidi({
      ...baseOptions,
      includePan: true,
      includeVolume: true,
      tracks: [{ name: 'A', midiChannel: 0, notes, pan: 20, volume: 88 }],
    }),
  );

  const controls = (smf) =>
    smf.tracks[1].events.filter((e) => e.kind === 0xb0).map((e) => [e.a, e.b]);

  assert.deepEqual(controls(plain), [], 'no CC by default');
  assert.deepEqual(
    controls(rich).sort((x, y) => x[0] - y[0]),
    [[7, 88], [10, 20]].sort((x, y) => x[0] - y[0]),
    'CC7 volume and CC10 pan present',
  );
});

test('channels map to distinct MIDI channels so stems stay separate', () => {
  const bytes = buildMidi({
    ...baseOptions,
    tracks: [
      { name: 'A', midiChannel: 0, notes: [{ position: 0, length: 10, key: 60, velocity: 90, pan: 64, channel: 0 }] },
      { name: 'B', midiChannel: 1, notes: [{ position: 0, length: 10, key: 62, velocity: 90, pan: 64, channel: 1 }] },
    ],
  });
  const smf = parseSmf(bytes);
  const channelOf = (track) =>
    track.events.find((e) => e.kind === 0x90).status & 0x0f;

  assert.equal(channelOf(smf.tracks[1]), 0);
  assert.equal(channelOf(smf.tracks[2]), 1);
});
