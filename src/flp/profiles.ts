/**
 * Version capability profiles.
 *
 * The point of keeping these as data: when a user reports "FL 26 won't open",
 * the fix is one object in one file plus one fixture — not a change to the
 * parser. See planning/implementation-details.md §5.
 *
 * `events.ts` holds the stable meaning of an event id; this file holds what
 * changes between FL releases (text encoding, event payload sizes, record
 * strides).
 */

export type FlpProfile = {
  id: string;
  match: (version: string) => boolean;
  /** FL switched to UTF-16 text at 11.5. */
  textEncoding: 'utf16le' | 'latin1';
  /** Event ids whose payload size breaks the id-range rule (e.g. FL 2026: {172: 1}). */
  eventSizeOverrides: Record<number, number>;
  /** Playlist record stride; omit to detect it from the data signature. */
  playlistStride?: number;
  /** false => the UI shows "unverified version" and skips structural guesses. */
  verified: boolean;
  note?: string;
};

const fl25: FlpProfile = {
  id: 'fl25',
  match: (version) => /^25\./.test(version),
  textEncoding: 'utf16le',
  eventSizeOverrides: {},
  verified: true,
  note: '56 local projects, 0 parse failures, channel counts match header',
};

const fl20: FlpProfile = {
  id: 'fl20',
  match: (version) => /^20\./.test(version),
  textEncoding: 'utf16le',
  eventSizeOverrides: {},
  verified: false,
  note: 'no local samples beyond 2 files; structural parse unverified',
};

const fl21: FlpProfile = {
  id: 'fl21',
  match: (version) => /^21\./.test(version),
  textEncoding: 'utf16le',
  eventSizeOverrides: {},
  verified: false,
  note: 'no local samples beyond 2 files; structural parse unverified',
};

const fl26: FlpProfile = {
  id: 'fl26',
  match: (version) => /^26\./.test(version),
  textEncoding: 'utf16le',
  eventSizeOverrides: { 172: 1 },
  verified: false,
  note: 'event 172 is 1 byte in FL 2026 (measured by flpkit); unverified here',
};

const generic: FlpProfile = {
  id: 'generic',
  match: () => true,
  textEncoding: 'utf16le',
  eventSizeOverrides: {},
  verified: false,
  note: 'fallback: header + text events only, structure left empty',
};

export const PROFILES: FlpProfile[] = [fl25, fl21, fl20, fl26, generic];

export function resolveProfile(version: string): FlpProfile {
  return PROFILES.find((profile) => profile.match(version)) ?? generic;
}
