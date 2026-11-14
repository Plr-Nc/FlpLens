/**
 * FLP → Project model.
 *
 * Scope: read-only. Nothing here writes, patches or re-serialises an .flp.
 * Layout knowledge lives in events.ts (stable ids) and profiles.ts (what
 * changes per FL release); this file is the state machine that walks the
 * event stream once and assembles the model.
 *
 * Two regions exist in the stream, in this order: the channel rack (+ patterns,
 * arrangements, playlist, tracks) and then the mixer. `inMixer` flips at the
 * first insert-name event, because events 201/203/213 mean different things in
 * the two regions.
 */

import { ByteReader, ascii, decodeText, u16At, u32At } from './stream.ts';
import {
  EVENT,
  EVENT_NAMES,
  PLAYLIST_PATTERN_BASE,
  PLAYLIST_TRACK_SPACE,
  VST_MARKERS,
  VST_RECORD,
  WRAPPER_INTERNAL_NAME,
  colorToHex,
} from './events.ts';
import { resolveProfile } from './profiles.ts';
import type { FlpProfile } from './profiles.ts';
import { addIssue, countEvent, countUnknown, createDiagnostics } from './diagnostics.ts';
import type { Diagnostics } from './diagnostics.ts';

export type FlpVst = { name: string; vendor: string; path: string };

export type Channel = {
  index: number;
  kind: number | null;
  /** What the user sees: rename (203) → internal name (201) → fallback. */
  name: string;
  internalName: string;
  vst: FlpVst | null;
  samplePath: string;
  color: string | null;
};

export type Note = {
  position: number;
  length: number;
  key: number;
  channel: number;
  velocity: number;
  pan: number;
  pattern: number;
};

export type Pattern = { index: number; name: string; color: string | null; notes: Note[] };

export type PlaylistItem = {
  arrangement: number;
  position: number;
  length: number;
  track: number;
  /** Pattern clips reference a pattern; audio/automation clips reference a channel. */
  pattern: number | null;
  channel: number | null;
  group: number;
};

export type MixerSlot = {
  index: number;
  internalName: string;
  name: string;
  vst: FlpVst | null;
};

export type MixerInsert = {
  index: number;
  name: string;
  color: string | null;
  slots: MixerSlot[];
};

export type TimeMarker = {
  name: string;
  numerator: number;
  denominator: number;
};

export type TimeSignature = { numerator: number; denominator: number };

export type ProjectMeta = {
  version: string;
  format: number;
  numChannels: number;
  ppq: number;
  tempo: number | null;
  timeSignature: TimeSignature;
  useTimeSignatures: boolean;
  title: string;
  author: string;
  comment: string;
  genre: string;
  url: string;
  licensed: boolean | null;
  trialSaved: boolean | null;
};

export type Project = {
  meta: ProjectMeta;
  profile: FlpProfile;
  channels: Channel[];
  patterns: Pattern[];
  arrangements: number[];
  arrangementNames: Map<number, string>;
  playlist: PlaylistItem[];
  trackNames: Map<number, string>;
  mixer: MixerInsert[];
  timeMarkers: TimeMarker[];
  diagnostics: Diagnostics;
  /** File length in bytes, for the UI footer. */
  byteLength: number;
};

const utf8 = new TextDecoder('utf-8');

function vstIdentity(payload: Uint8Array): FlpVst | null {
  if (payload.length < 4) return null;
  if (!VST_MARKERS.includes(u32At(payload, 0))) return null;
  const fields = new Map<number, string>();
  let at = 4;
  while (at + 12 <= payload.length) {
    const id = u32At(payload, at);
    const length = u32At(payload, at + 4) + u32At(payload, at + 8) * 0x100000000;
    const start = at + 12;
    if (length > payload.length - start) break;
    if (id === VST_RECORD.NAME || id === VST_RECORD.PATH || id === VST_RECORD.VENDOR) {
      fields.set(id, utf8.decode(payload.subarray(start, start + length)).replace(/\0+$/, ''));
    }
    at = start + length;
  }
  const name = fields.get(VST_RECORD.NAME);
  if (!name) return null;
  return {
    name,
    vendor: fields.get(VST_RECORD.VENDOR) ?? '',
    path: fields.get(VST_RECORD.PATH) ?? '',
  };
}

/**
 * Playlist records grow era by era (32 / 60 / 80 / 88) without a version tag,
 * so the stride is detected: the smallest aligned size where every record head
 * carries the pattern_base signature and a plausible track index.
 */
export function detectPlaylistStride(blob: Uint8Array): number | null {
  for (let stride = 32; stride <= 256; stride += 4) {
    if (blob.length % stride !== 0) continue;
    let fits = true;
    for (let at = 0; at < blob.length; at += stride) {
      if (at + 16 > blob.length) {
        fits = false;
        break;
      }
      if (u16At(blob, at + 4) !== PLAYLIST_PATTERN_BASE) {
        fits = false;
        break;
      }
      const track = PLAYLIST_TRACK_SPACE - u16At(blob, at + 12);
      if (track < 0 || track > PLAYLIST_TRACK_SPACE) {
        fits = false;
        break;
      }
    }
    if (fits) return stride;
  }
  return null;
}

export function parseNotes(blob: Uint8Array, pattern: number): Note[] {
  const notes: Note[] = [];
  const count = Math.floor(blob.length / 24);
  for (let i = 0; i < count; i++) {
    const at = i * 24;
    notes.push({
      position: u32At(blob, at),
      length: u32At(blob, at + 8),
      key: u16At(blob, at + 12),
      channel: u16At(blob, at + 6),
      velocity: blob[at + 21],
      pan: blob[at + 20],
      pattern,
    });
  }
  return notes;
}

function parsePlaylist(blob: Uint8Array, arrangement: number, stride: number): PlaylistItem[] {
  const items: PlaylistItem[] = [];
  for (let at = 0; at + 16 <= blob.length; at += stride) {
    const base = u16At(blob, at + 4);
    if (base !== PLAYLIST_PATTERN_BASE) continue;
    const item = u16At(blob, at + 6);
    const isPattern = item >= PLAYLIST_PATTERN_BASE;
    items.push({
      arrangement,
      position: u32At(blob, at),
      length: u32At(blob, at + 8),
      track: PLAYLIST_TRACK_SPACE - u16At(blob, at + 12),
      pattern: isPattern ? item - PLAYLIST_PATTERN_BASE : null,
      channel: isPattern ? null : item,
      group: u16At(blob, at + 14),
    });
  }
  return items;
}

const EMPTY_META: ProjectMeta = {
  version: '',
  format: -1,
  numChannels: 0,
  ppq: 96,
  tempo: null,
  timeSignature: { numerator: 4, denominator: 4 },
  useTimeSignatures: false,
  title: '',
  author: '',
  comment: '',
  genre: '',
  url: '',
  licensed: null,
  trialSaved: null,
};

/** Plugin label for display: hosted VST name → rename → internal name. */
export function pluginLabel(slot: { internalName: string; name: string; vst: FlpVst | null }): string {
  if (slot.vst?.name) return slot.vst.name;
  if (slot.name) return slot.name;
  if (slot.internalName && slot.internalName !== WRAPPER_INTERNAL_NAME) return slot.internalName;
  return '';
}

export function parseFlp(bytes: Uint8Array, profileOverride?: FlpProfile): Project {
  const diag = createDiagnostics();
  const channels: Channel[] = [];
  const patterns: Pattern[] = [];
  const playlist: PlaylistItem[] = [];
  const arrangements: number[] = [];
  const arrangementNames = new Map<number, string>();
  const trackNames = new Map<number, string>();
  const mixer: MixerInsert[] = [];
  const timeMarkers: TimeMarker[] = [];
  const meta: ProjectMeta = { ...EMPTY_META, timeSignature: { ...EMPTY_META.timeSignature } };
  let profile = profileOverride ?? resolveProfile('');

  const empty = (): Project => ({
    meta,
    profile,
    channels,
    patterns,
    arrangements: arrangements.length ? arrangements : [0],
    arrangementNames,
    playlist,
    trackNames,
    mixer,
    timeMarkers,
    diagnostics: diag,
    byteLength: bytes.length,
  });

  const fail = (message: string): Project => {
    addIssue(diag, { code: 'NOT_FLP', severity: 'fatal', message });
    return empty();
  };

  if (bytes.length < 16 || ascii(bytes, 0, 4) !== 'FLhd') {
    return fail('missing FLhd header — this is not an FL Studio project');
  }

  const reader = new ByteReader(bytes, 4);
  const headerSize = reader.u32();
  meta.format = reader.i16();
  meta.numChannels = reader.u16();
  meta.ppq = reader.u16() || 96;

  const dataStart = 8 + headerSize;
  if (dataStart + 8 > bytes.length) return fail('header size runs past end of file');
  reader.seek(dataStart);
  if (ascii(bytes, dataStart, 4) !== 'FLdt') return fail('missing FLdt data chunk');
  reader.seek(dataStart + 4);
  const dataSize = reader.u32();
  const dataEnd = Math.min(reader.pos + dataSize, bytes.length);

  let currentChannel: Channel | null = null;
  let currentPattern: Pattern | null = null;
  let currentArrangement = 0;
  let currentMarker: TimeMarker | null = null;
  let currentTrackIndex: number | null = null;
  let currentInsert: MixerInsert | null = null;
  let currentSlot: MixerSlot | null = null;
  let inMixer = false;

  let textIsUtf16 = profile.textEncoding === 'utf16le';
  let stride: number | null = profile.playlistStride ?? null;
  let sawVersion = false;
  let coarseTempo: number | null = null;
  let fineTempoWord: number | null = null;

  const slotAt = (insert: MixerInsert, index: number): MixerSlot => {
    let slot = insert.slots.find((item) => item.index === index);
    if (!slot) {
      slot = { index, internalName: '', name: '', vst: null };
      insert.slots.push(slot);
    }
    return slot;
  };

  while (reader.pos < dataEnd) {
    const offset = reader.pos;
    const id = reader.u8();
    let size: number;
    if (id < 64) size = 1;
    else if (id < 128) size = 2;
    else if (id < 192) size = 4;
    else size = profile.eventSizeOverrides[id] ?? reader.varint();

    if (reader.pos + size > dataEnd) {
      addIssue(diag, {
        code: 'TRUNCATED',
        severity: 'fatal',
        eventId: id,
        offset,
        message: 'event payload runs past the data chunk',
      });
      break;
    }
    const payload = reader.take(size);
    countEvent(diag, id);

    switch (id) {
      case EVENT.VERSION: {
        meta.version = ascii(payload);
        sawVersion = true;
        profile = profileOverride ?? resolveProfile(meta.version);
        textIsUtf16 = profile.textEncoding === 'utf16le';
        if (!profile.verified) {
          addIssue(diag, {
            code: 'UNKNOWN_VERSION',
            severity: 'warn',
            eventId: id,
            message: `no verified profile for FL ${meta.version || '(empty)'} (using ${profile.id})`,
          });
        }
        break;
      }
      case EVENT.PROJECT_TS_NUM:
        meta.timeSignature.numerator = payload[0] || 4;
        break;
      case EVENT.PROJECT_TS_DEN:
        meta.timeSignature.denominator = payload[0] || 4;
        break;
      case EVENT.USE_TIME_SIGNATURES:
        meta.useTimeSignatures = payload[0] === 1;
        break;
      case EVENT.TEMPO:
        if (size === 4) meta.tempo = u32At(payload, 0) / 1000;
        break;
      case EVENT.TEMPO_COARSE:
        if (size === 2) coarseTempo = u16At(payload, 0);
        break;
      case EVENT.TEMPO_FINE_WORD:
        if (size === 2) fineTempoWord = u16At(payload, 0);
        break;
      case EVENT.TITLE:
        meta.title = decodeText(payload, textIsUtf16);
        break;
      case EVENT.COMMENT:
        meta.comment = decodeText(payload, textIsUtf16);
        break;
      case EVENT.URL:
        meta.url = decodeText(payload, textIsUtf16);
        break;
      case EVENT.GENRE:
        meta.genre = decodeText(payload, textIsUtf16);
        break;
      case EVENT.AUTHOR:
        meta.author = decodeText(payload, textIsUtf16);
        break;
      case EVENT.NEW_CHANNEL: {
        const index = size === 2 ? u16At(payload, 0) : channels.length;
        currentChannel = {
          index,
          kind: null,
          name: '',
          internalName: '',
          vst: null,
          samplePath: '',
          color: null,
        };
        channels.push(currentChannel);
        break;
      }
      case EVENT.CHANNEL_TYPE:
        if (currentChannel) currentChannel.kind = payload[0];
        break;
      case EVENT.CHANNEL_COLOR:
        if (!inMixer && currentChannel && size === 4) currentChannel.color = colorToHex(u32At(payload, 0));
        break;
      case EVENT.PLUGIN_INTERNAL: {
        const text = decodeText(payload, textIsUtf16);
        if (inMixer) {
          if (currentInsert && currentSlot) currentSlot.internalName ||= text;
        } else if (currentChannel && !currentChannel.internalName) {
          currentChannel.internalName = text;
        }
        break;
      }
      case EVENT.PLUGIN_NAME: {
        const text = decodeText(payload, textIsUtf16);
        if (inMixer) {
          if (currentInsert && currentSlot) currentSlot.name ||= text;
        } else if (currentChannel) {
          currentChannel.name = text;
        }
        break;
      }
      case EVENT.PLUGIN_DATA: {
        const vst = vstIdentity(payload);
        if (!vst) break;
        if (inMixer) {
          if (currentInsert && currentSlot && !currentSlot.vst) currentSlot.vst = vst;
        } else if (currentChannel && !currentChannel.vst) {
          currentChannel.vst = vst;
        }
        break;
      }
      case EVENT.SAMPLE_PATH:
        if (currentChannel) currentChannel.samplePath = decodeText(payload, textIsUtf16);
        break;
      case EVENT.NEW_PATTERN: {
        const index = size === 2 ? u16At(payload, 0) : patterns.length;
        currentPattern = { index, name: '', color: null, notes: [] };
        patterns.push(currentPattern);
        break;
      }
      case EVENT.PATTERN_NAME:
        if (currentPattern) currentPattern.name = decodeText(payload, textIsUtf16);
        break;
      case EVENT.PATTERN_COLOR:
        if (currentPattern && size === 4) currentPattern.color = colorToHex(u32At(payload, 0));
        break;
      case EVENT.PATTERN_NOTES:
        if (currentPattern) {
          if (size % 24 !== 0) {
            addIssue(diag, {
              code: 'NOTE_BLOB_TRAILING',
              severity: 'warn',
              eventId: id,
              expected: Math.floor(size / 24) * 24,
              actual: size,
              message: 'note blob is not a multiple of 24 bytes; trailing bytes ignored',
            });
          }
          currentPattern.notes.push(...parseNotes(payload, currentPattern.index));
        } else {
          addIssue(diag, {
            code: 'REF_MISSING',
            severity: 'info',
            eventId: id,
            message: 'notes seen before any pattern was declared; ignored',
          });
        }
        break;
      case EVENT.NEW_ARRANGEMENT: {
        currentArrangement = size === 2 ? u16At(payload, 0) : arrangements.length;
        if (!arrangements.includes(currentArrangement)) arrangements.push(currentArrangement);
        break;
      }
      case EVENT.ARRANGEMENT_NAME:
        arrangementNames.set(currentArrangement, decodeText(payload, textIsUtf16));
        break;
      case EVENT.PLAYLIST: {
        const detected = stride ?? detectPlaylistStride(payload);
        if (detected === null) {
          addIssue(diag, {
            code: 'STRIDE_NOT_FOUND',
            severity: 'warn',
            eventId: id,
            actual: size,
            message: 'could not detect the playlist record size; arrangement skipped',
          });
          break;
        }
        stride = detected;
        if (!arrangements.includes(currentArrangement)) arrangements.push(currentArrangement);
        playlist.push(...parsePlaylist(payload, currentArrangement, detected));
        break;
      }
      case EVENT.NEW_PLAYLIST_TRACK:
        if (size >= 4) currentTrackIndex = u32At(payload, 0);
        break;
      case EVENT.PLAYLIST_TRACK_NAME:
        if (currentTrackIndex !== null) {
          trackNames.set(currentTrackIndex, decodeText(payload, textIsUtf16));
        }
        break;
      case EVENT.NEW_TIME_MARKER:
        currentMarker = {
          name: '',
          numerator: meta.timeSignature.numerator,
          denominator: meta.timeSignature.denominator,
        };
        timeMarkers.push(currentMarker);
        break;
      case EVENT.TIMEMARKER_NAME:
        if (currentMarker) currentMarker.name = decodeText(payload, textIsUtf16);
        break;
      case EVENT.TIMEMARKER_NUMERATOR:
        if (currentMarker && payload[0]) currentMarker.numerator = payload[0];
        break;
      case EVENT.TIMEMARKER_DENOMINATOR:
        if (currentMarker && payload[0]) currentMarker.denominator = payload[0];
        break;
      case EVENT.INSERT_FLAGS: {
        // The n-th InsertFlags (236) opens insert n (0 = Master); it is the
        // only reliable mixer-section boundary — insert names are optional.
        inMixer = true;
        currentInsert = { index: mixer.length, name: '', color: null, slots: [] };
        mixer.push(currentInsert);
        currentSlot = null;
        break;
      }
      case EVENT.INSERT_NAME:
        if (currentInsert) currentInsert.name = decodeText(payload, textIsUtf16);
        break;
      case EVENT.INSERT_COLOR:
        if (currentInsert && size === 4) currentInsert.color = colorToHex(u32At(payload, 0));
        break;
      case EVENT.CURRENT_SLOT:
        // Low byte is the slot number; the word carries extra state.
        if (currentInsert && size >= 2) currentSlot = slotAt(currentInsert, payload[0]);
        break;
      default:
        if (id >= 192 && EVENT_NAMES[id] === undefined) countUnknown(diag, id);
        break;
    }
  }

  if (meta.tempo === null && coarseTempo !== null) {
    meta.tempo = coarseTempo + (fineTempoWord ?? 0) / 1000;
  }

  if (!sawVersion) {
    addIssue(diag, {
      code: 'UNKNOWN_VERSION',
      severity: 'warn',
      message: 'no FL version event found; text decoding assumed UTF-16',
    });
  }

  // Structural self-check: the invariant that catches a desynced stream.
  if (channels.length !== meta.numChannels) {
    addIssue(diag, {
      code: 'CHANNEL_COUNT_MISMATCH',
      severity: 'warn',
      expected: meta.numChannels,
      actual: channels.length,
      message: 'parsed channel count differs from the header count',
    });
  }

  for (const channel of channels) {
    if (!channel.name) {
      channel.name =
        channel.vst?.name ||
        (channel.internalName && channel.internalName !== WRAPPER_INTERNAL_NAME
          ? channel.internalName
          : '') ||
        `Channel ${channel.index + 1}`;
    }
  }

  if (playlist.length === 0) {
    addIssue(diag, {
      code: 'PLAYLIST_EMPTY',
      severity: 'info',
      message: 'no playlist items (empty arrangement or unsupported layout)',
    });
  }

  return empty();
}
