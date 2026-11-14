/**
 * Event ids that matter for a read-only view.
 *
 * The full name table comes from flp-file's `flp-event-type.js` (which in turn
 * cites Monad.FLParser and KFLP); semantics below are the subset this viewer
 * reads, cross-checked against flpkit / PyFLP / ling-daw and observed on FL 2025
 * files. Unknown ids are counted in diagnostics rather than dropped silently.
 */

export const EVENT = {
  PROJECT_TS_NUM: 17,
  PROJECT_TS_DEN: 18,
  CHANNEL_TYPE: 21,
  TIMEMARKER_NUMERATOR: 33,
  TIMEMARKER_DENOMINATOR: 34,
  USE_TIME_SIGNATURES: 35,
  NEW_CHANNEL: 64,
  NEW_PATTERN: 65,
  TEMPO_COARSE: 66,
  TEMPO_FINE_WORD: 93,
  CURRENT_SLOT: 98,
  NEW_ARRANGEMENT: 99,
  CHANNEL_COLOR: 128,
  NEW_TIME_MARKER: 148,
  INSERT_COLOR: 149,
  PATTERN_COLOR: 150,
  TEMPO: 156,
  CHANNEL_NAME: 192,  PATTERN_NAME: 193,
  TITLE: 194,
  COMMENT: 195,
  SAMPLE_PATH: 196,
  URL: 197,
  VERSION: 199,
  PLUGIN_INTERNAL: 201,
  PLUGIN_NAME: 203,
  INSERT_NAME: 204,
  TIMEMARKER_NAME: 205,
  GENRE: 206,
  AUTHOR: 207,
  PLUGIN_WRAPPER: 212,
  PLUGIN_DATA: 213,
  CHANNEL_LEVELS: 219,
  PATTERN_NOTES: 224,
  CHAN_GROUP_NAME: 231,
  PLAYLIST: 233,
  INSERT_ROUTES: 235,
  INSERT_FLAGS: 236,
  SAVE_TIMESTAMP: 237,
  NEW_PLAYLIST_TRACK: 238,
  PLAYLIST_TRACK_NAME: 239,
  ARRANGEMENT_NAME: 241,
} as const;

export const EVENT_NAMES: Record<number, string> = {
  [EVENT.PROJECT_TS_NUM]: 'project time signature numerator',
  [EVENT.PROJECT_TS_DEN]: 'project time signature denominator',
  [EVENT.CHANNEL_TYPE]: 'channel type',
  [EVENT.TIMEMARKER_NUMERATOR]: 'time marker numerator',
  [EVENT.TIMEMARKER_DENOMINATOR]: 'time marker denominator',
  [EVENT.USE_TIME_SIGNATURES]: 'use time signatures',
  [EVENT.NEW_CHANNEL]: 'new channel',
  [EVENT.NEW_PATTERN]: 'new pattern',
  [EVENT.TEMPO_COARSE]: 'tempo (coarse)',
  [EVENT.TEMPO_FINE_WORD]: 'tempo (fine word)',
  [EVENT.CURRENT_SLOT]: 'current mixer slot',
  [EVENT.NEW_ARRANGEMENT]: 'new arrangement',
  [EVENT.CHANNEL_COLOR]: 'channel color',
  [EVENT.NEW_TIME_MARKER]: 'new time marker',
  [EVENT.INSERT_COLOR]: 'insert color',
  [EVENT.PATTERN_COLOR]: 'pattern color',
  [EVENT.TEMPO]: 'tempo',
  [EVENT.CHANNEL_NAME]: 'channel name',
  [EVENT.PATTERN_NAME]: 'pattern name',
  [EVENT.TITLE]: 'project title',
  [EVENT.COMMENT]: 'project comment',
  [EVENT.SAMPLE_PATH]: 'sample path',
  [EVENT.URL]: 'project url',
  [EVENT.VERSION]: 'fl version',
  [EVENT.PLUGIN_INTERNAL]: 'plugin internal name',
  [EVENT.PLUGIN_NAME]: 'plugin display name',
  [EVENT.INSERT_NAME]: 'mixer insert name',
  [EVENT.TIMEMARKER_NAME]: 'time marker name',
  [EVENT.GENRE]: 'genre',
  [EVENT.AUTHOR]: 'author',
  [EVENT.PLUGIN_WRAPPER]: 'plugin wrapper state',
  [EVENT.PLUGIN_DATA]: 'plugin data',
  [EVENT.CHANNEL_LEVELS]: 'channel levels',
  [EVENT.PATTERN_NOTES]: 'pattern notes',
  [EVENT.CHAN_GROUP_NAME]: 'channel group name',
  [EVENT.PLAYLIST]: 'playlist',
  [EVENT.INSERT_ROUTES]: 'insert routes',
  [EVENT.INSERT_FLAGS]: 'insert flags',
  [EVENT.SAVE_TIMESTAMP]: 'save timestamp',
  [EVENT.NEW_PLAYLIST_TRACK]: 'new playlist track',
  [EVENT.PLAYLIST_TRACK_NAME]: 'playlist track name',
  [EVENT.ARRANGEMENT_NAME]: 'arrangement name',
};

/** Channel `kind` values observed in FL 2025 files. */
export const CHANNEL_KIND: Record<number, string> = {
  0: 'Sampler',
  1: 'Hybrid',
  2: 'Instrument',
  3: 'Layer',
  4: 'Audio clip',
  5: 'Automation',
};

export function channelKindName(kind: number | null): string {
  if (kind === null) return 'unknown';
  return CHANNEL_KIND[kind] ?? `type ${kind}`;
}

/** Fruity Wrapper state record ids (event 213). */
export const VST_RECORD = { NAME: 54, PATH: 55, VENDOR: 56 } as const;
export const VST_MARKERS = [8, 10];
export const WRAPPER_INTERNAL_NAME = 'Fruity Wrapper';

/** Playlist record signature: every record head carries 20480 as `base`. */
export const PLAYLIST_PATTERN_BASE = 20480;
export const PLAYLIST_TRACK_SPACE = 500;

/** FL stores colours as 0x00BBGGRR in some events and 0x00RRGGBB in others. */
export function colorToHex(value: number | null): string | null {
  if (value === null || value === 0) return null;
  const r = value & 0xff;
  const g = (value >> 8) & 0xff;
  const b = (value >> 16) & 0xff;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
