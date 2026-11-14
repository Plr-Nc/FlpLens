/**
 * Standard MIDI File writer.
 *
 * Exports notes that already belong to the user — nothing here reproduces any
 * content from FL Studio itself. The only format knowledge needed is SMF, which
 * is a public specification.
 */

export type MidiNote = {
  /** Start position in ticks. */
  position: number;
  /** Length in ticks. */
  length: number;
  /** MIDI note number 0-127. */
  key: number;
  /** 0-127. */
  velocity: number;
  /** 0-127, 64 = centre. */
  pan: number;
  /** Source channel index, used for grouping and MIDI channel assignment. */
  channel: number;
};

export type MidiTrackSpec = {
  name: string;
  notes: MidiNote[];
  /** MIDI program (0-127). Omit to leave whatever is loaded. */
  program?: number;
  /** MIDI channel 0-15. */
  midiChannel: number;
  /** Pan controller value 0-127, emitted at tick 0 when defined. */
  pan?: number;
  /** Volume controller value 0-127, emitted at tick 0 when defined. */
  volume?: number;
};

export type MidiOptions = {
  ppq: number;
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  tracks: MidiTrackSpec[];
  includeTempo: boolean;
  includeTimeSignature: boolean;
  includeNames: boolean;
  /** Emit CC10 (pan) from note data's median pan. */
  includePan: boolean;
  /** Emit CC7 (volume) from the channel level. */
  includeVolume: boolean;
  /** Shift all notes so the earliest onset is at tick 0. */
  trimLeadingSilence: boolean;
};

class Writer {
  private bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u16(value: number): void {
    this.bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  u32(value: number): void {
    this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  /** MIDI variable-length quantity (7 bits per byte, high bit = continuation). */
  varint(value: number): void {
    let v = Math.max(0, Math.round(value));
    const stack: number[] = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      stack.push((v & 0x7f) | 0x80);
      v >>= 7;
    }
    for (let i = stack.length - 1; i >= 0; i--) this.bytes.push(stack[i]);
  }

  ascii(text: string): void {
    for (const ch of text) this.bytes.push(ch.charCodeAt(0) & 0x7f);
  }

  /** MIDI text is technically Latin-1; UTF-8 keeps CJK names readable in most DAWs. */
  text(text: string): void {
    const encoded = new TextEncoder().encode(text);
    for (const byte of encoded) this.bytes.push(byte);
  }

  raw(data: number[] | Uint8Array): void {
    for (const byte of data) this.bytes.push(byte & 0xff);
  }

  take(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

type TimedEvent = {
  tick: number;
  /** Lower runs first at the same tick: note-offs must precede note-ons. */
  priority: number;
  bytes: number[];
};

function microsPerQuarter(bpm: number): number {
  const safe = bpm > 0 ? bpm : 120;
  return Math.round(60_000_000 / safe);
}

/** Denominator must be a power of two; SMF stores it as log2. */
function denominatorPower(denominator: number): number {
  return Math.max(0, Math.round(Math.log2(Math.max(1, denominator))));
}

export function buildMidi(options: MidiOptions): Uint8Array {
  const ppq = Math.max(1, Math.round(options.ppq || 96));
  // Must match the number of MTrk chunks actually written. Clamping this to 1
  // produced a header claiming more tracks than the file contains, which strict
  // parsers reject outright.
  const trackCount = options.tracks.length;

  // Keep onsets above zero so the file does not start with a negative delta.
  let shift = 0;
  if (options.trimLeadingSilence) {
    let earliest = Infinity;
    for (const track of options.tracks) {
      for (const note of track.notes) {
        if (note.position < earliest) earliest = note.position;
      }
    }
    if (Number.isFinite(earliest) && earliest > 0) shift = earliest;
  }

  const out = new Writer();

  // ---- header chunk ----
  out.ascii('MThd');
  out.u32(6);
  out.u16(1); // format 1: multiple synchronous tracks
  out.u16(trackCount + 1); // +1 for the conductor track (tempo / time signature)
  out.u16(ppq);

  // ---- conductor track ----
  const conductor: TimedEvent[] = [];
  if (options.includeNames) {
    conductor.push({ tick: 0, priority: -10, bytes: metaText(0x03, 'FlpLens') });
  }
  if (options.includeTempo) {
    const micros = microsPerQuarter(options.bpm);
    conductor.push({
      tick: 0,
      priority: -9,
      bytes: [0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff],
    });
  }
  if (options.includeTimeSignature) {
    const { numerator, denominator } = options.timeSignature;
    const power = denominatorPower(denominator);
    // cc / bb: MIDI clocks per metronome click and per quarter note (24 / 8).
    conductor.push({ tick: 0, priority: -8, bytes: [0xff, 0x58, 0x04, numerator & 0xff, power, 24, 8] });
  }
  conductor.push({ tick: 0, priority: 1000, bytes: [0xff, 0x2f, 0x00] });
  out.raw(encodeTrack(conductor));

  // ---- note tracks ----
  for (const track of options.tracks) {
    const events: TimedEvent[] = [];
    const ch = Math.min(15, Math.max(0, track.midiChannel));

    if (options.includeNames) {
      events.push({ tick: 0, priority: -10, bytes: metaText(0x03, track.name || 'Track') });
    }
    if (track.program !== undefined) {
      events.push({
        tick: 0,
        priority: -9,
        bytes: [0xc0 | ch, Math.min(127, Math.max(0, Math.round(track.program)))],
      });
    }
    if (options.includeVolume && track.volume !== undefined) {
      events.push({ tick: 0, priority: -8, bytes: [0xb0 | ch, 7, clamp7(track.volume)] });
    }
    if (options.includePan && track.pan !== undefined) {
      events.push({ tick: 0, priority: -7, bytes: [0xb0 | ch, 10, clamp7(track.pan)] });
    }

    for (const note of track.notes) {
      const start = Math.max(0, note.position - shift);
      const end = Math.max(start + 1, note.position + note.length - shift);
      const key = Math.min(127, Math.max(0, Math.round(note.key)));
      const velocity = Math.min(127, Math.max(1, Math.round(note.velocity)));
      // Note-off first so a repeated note at the same tick is not swallowed.
      events.push({ tick: end, priority: 0, bytes: [0x80 | ch, key, 0] });
      events.push({ tick: start, priority: 10, bytes: [0x90 | ch, key, velocity] });
    }

    events.push({ tick: Infinity, priority: 1000, bytes: [0xff, 0x2f, 0x00] });
    out.raw(encodeTrack(events));
  }

  return out.take();
}

function clamp7(value: number): number {
  return Math.min(127, Math.max(0, Math.round(value)));
}

function metaText(type: number, text: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  return [0xff, type, ...varintBytes(bytes.length), ...bytes];
}

function varintBytes(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const stack: number[] = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    stack.push((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return stack.reverse();
}

function encodeTrack(events: TimedEvent[]): number[] {
  const sorted = events.slice().sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.priority - b.priority;
  });

  const body = new Writer();
  let previous = 0;
  for (const event of sorted) {
    const tick = Number.isFinite(event.tick) ? event.tick : previous;
    body.varint(Math.max(0, tick - previous));
    body.raw(event.bytes);
    previous = tick;
  }

  const payload = body.take();
  const chunk = new Writer();
  chunk.ascii('MTrk');
  chunk.u32(payload.length);
  chunk.raw(payload);
  return Array.from(chunk.take());
}
