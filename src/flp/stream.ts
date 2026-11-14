/**
 * Byte access primitives for the FLP container.
 *
 * FLP events use four length classes: ids 0-63 carry 1 byte, 64-127 carry 2,
 * 128-191 carry 4, and 192-255 are prefixed by a 7-bit varint length.
 * Everything here is little-endian.
 */

export class ByteReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos: number;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  get length(): number {
    return this.bytes.length;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  u8(): number {
    return this.bytes[this.pos++];
  }

  i8(): number {
    const v = this.bytes[this.pos++];
    return v > 127 ? v - 256 : v;
  }

  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** 7-bit little-endian varint, as used by length-prefixed events. */
  varint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.bytes[this.pos++];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      if (shift > 35) throw new Error('varint too long');
    }
  }

  /** Zero-copy view of the next `n` bytes. */
  take(n: number): Uint8Array {
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  seek(pos: number): void {
    this.pos = pos;
  }
}

export function u16At(buf: Uint8Array, at: number): number {
  return buf[at] | (buf[at + 1] << 8);
}

export function u32At(buf: Uint8Array, at: number): number {
  return (buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16)) + buf[at + 3] * 0x1000000;
}

export function i8At(buf: Uint8Array, at: number): number {
  const v = buf[at];
  return v > 127 ? v - 256 : v;
}

/** ASCII payload with trailing NULs removed (used by the version event). */
export function ascii(buf: Uint8Array, at = 0, len = buf.length): string {
  let out = '';
  for (let i = at; i < at + len && i < buf.length; i++) {
    const c = buf[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

/** NUL-terminated text in the encoding the file declares. */
export function decodeText(buf: Uint8Array, utf16: boolean): string {
  if (!utf16) {
    let out = '';
    for (const byte of buf) {
      if (byte === 0) break;
      out += String.fromCharCode(byte);
    }
    return out;
  }
  let out = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}
