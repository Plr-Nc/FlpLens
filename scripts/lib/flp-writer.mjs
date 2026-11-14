/**
 * Minimal FLP writer used by the fixture and demo generators.
 *
 * This is the inverse of src/flp/project.ts: just enough encoding to produce a
 * structurally valid container. It is NOT a general writer — it only knows the
 * events this project reads.
 */

export const u16 = (value) => [value & 0xff, (value >> 8) & 0xff];

export const u32 = (value) => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >>> 24) & 0xff,
];

export const varint = (value) => {
  const out = [];
  let rest = value >>> 0;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest) byte |= 0x80;
    out.push(byte);
  } while (rest);
  return out;
};

export const ascii = (text) => [...Buffer.from(text, 'ascii'), 0];

export const utf16 = (text) => {
  const out = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    out.push(code & 0xff, (code >> 8) & 0xff);
  }
  return [...out, 0, 0];
};

/** One event: id + payload, sized by the id range rule. */
export function event(id, payload) {
  if (id < 64) return [id, ...payload.slice(0, 1)];
  if (id < 128) return [id, ...payload.slice(0, 2)];
  if (id < 192) return [id, ...payload.slice(0, 4)];
  return [id, ...varint(payload.length), ...payload];
}

/** A 24-byte note record. */
export function note({ position, length, key, channel, velocity = 100, pan = 64, group = 0 }) {
  return [
    ...u32(position),
    ...u16(0), // flags
    ...u16(channel),
    ...u32(length),
    ...u16(key),
    ...u16(group),
    0, // fine pitch
    0, // reserved
    0, // release
    0, // midi channel
    pan,
    velocity,
    0, // mod x
    0, // mod y
  ];
}

/** A 32-byte playlist record (classic stride). */
export function playlistItem({ position, length, track, pattern = null, channel = null, group = 0 }) {
  return [
    ...u32(position),
    ...u16(20480), // pattern_base signature
    ...u16(pattern !== null ? 20480 + pattern : channel),
    ...u32(length),
    ...u16(500 - track),
    ...u16(group),
    ...new Array(16).fill(0),
  ];
}

/** Fruity Wrapper state carrying a hosted VST's identity (event 213). */
export function vstState({ name, vendor = '', path = '' }) {
  const record = (id, text) => {
    const bytes = [...Buffer.from(text, 'utf8'), 0];
    return [...u32(id), ...u32(bytes.length), ...u32(0), ...bytes];
  };
  return [...u32(8), ...record(54, name), ...record(55, path), ...record(56, vendor)];
}

/** Wrap an event list in FLhd + FLdt. */
export function wrapFlp(events, { format = 0, numChannels = 1, ppq = 96 } = {}) {
  const data = events.flat();
  const header = [0x46, 0x4c, 0x68, 0x64, ...u32(6), ...u16(format), ...u16(numChannels), ...u16(ppq)];
  const body = [0x46, 0x4c, 0x64, 0x74, ...u32(data.length), ...data];
  return Buffer.from([...header, ...body]);
}
