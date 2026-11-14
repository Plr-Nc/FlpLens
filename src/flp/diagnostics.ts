/**
 * Diagnostics: the artifact a user can paste into an issue.
 *
 * Two rules, both enforced by the acceptance criteria:
 *   1. parsing never throws a bare exception at the UI — everything becomes an Issue;
 *   2. a copied report never contains project content (no title, channel names,
 *      sample paths, notes). Only structural facts.
 */

export type IssueCode =
  | 'NOT_FLP'
  | 'TRUNCATED'
  | 'UNKNOWN_VERSION'
  | 'EVENT_LENGTH_MISMATCH'
  | 'STRIDE_NOT_FOUND'
  | 'UNKNOWN_EVENT'
  | 'REF_MISSING'
  | 'CHANNEL_COUNT_MISMATCH'
  | 'NOTE_BLOB_TRAILING'
  | 'PLAYLIST_EMPTY';

export type Severity = 'fatal' | 'warn' | 'info';

export type Issue = {
  code: IssueCode;
  severity: Severity;
  message: string;
  eventId?: number;
  offset?: number;
  expected?: number;
  actual?: number;
};

export type Diagnostics = {
  issues: Issue[];
  unknownEvents: Map<number, number>;
  eventHistogram: Map<number, number>;
};

export function createDiagnostics(): Diagnostics {
  return { issues: [], unknownEvents: new Map(), eventHistogram: new Map() };
}

export function addIssue(diag: Diagnostics, issue: Issue): void {
  // Keep the report readable: one line per distinct code+eventId pair.
  const duplicate = diag.issues.some(
    (existing) => existing.code === issue.code && existing.eventId === issue.eventId,
  );
  if (!duplicate) diag.issues.push(issue);
}

export function countEvent(diag: Diagnostics, id: number): void {
  diag.eventHistogram.set(id, (diag.eventHistogram.get(id) ?? 0) + 1);
}

export function countUnknown(diag: Diagnostics, id: number): void {
  diag.unknownEvents.set(id, (diag.unknownEvents.get(id) ?? 0) + 1);
}

export function hasFatal(diag: Diagnostics): boolean {
  return diag.issues.some((issue) => issue.severity === 'fatal');
}

/** Structural facts only — safe to paste in a public issue. */
export function buildReport(input: {
  fileSize: number;
  version: string;
  profileId: string;
  header: { format: number; channels: number; ppq: number; dataSize: number } | null;
  diag: Diagnostics;
}): string {
  const lines: string[] = [];
  lines.push('FlpLens diagnostics');
  // Deliberately no file name: it can itself identify a client or a song.
  lines.push(`file size: ${input.fileSize} bytes`);
  lines.push(`fl version: ${input.version || '(not found)'}`);
  lines.push(`profile: ${input.profileId}`);
  if (input.header) {
    lines.push(
      `header: format=${input.header.format} channels=${input.header.channels} ` +
        `ppq=${input.header.ppq} data=${input.header.dataSize}`,
    );
  }
  lines.push('', 'issues:');
  if (input.diag.issues.length === 0) lines.push('  (none)');
  for (const issue of input.diag.issues) {
    const extra = [
      issue.eventId !== undefined ? `event=${issue.eventId}` : '',
      issue.offset !== undefined ? `offset=0x${issue.offset.toString(16)}` : '',
      issue.expected !== undefined ? `expected=${issue.expected}` : '',
      issue.actual !== undefined ? `actual=${issue.actual}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`  [${issue.severity}] ${issue.code} ${extra} — ${issue.message}`);
  }
  lines.push('', 'unknown events:');
  if (input.diag.unknownEvents.size === 0) lines.push('  (none)');
  for (const [id, count] of [...input.diag.unknownEvents].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    lines.push(`  ${id} x${count}`);
  }
  lines.push('', 'event histogram (top 40):');
  for (const [id, count] of [...input.diag.eventHistogram].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    lines.push(`  ${id} x${count}`);
  }
  return lines.join('\n');
}
