#!/usr/bin/env node
/**
 * Batch regression over real .flp files.
 *
 * Asserts the acceptance criteria that can be checked without a browser:
 *   S1  every file opens without a fatal issue
 *   S2  parsed channel count equals the header's num_channels
 *   S7  the diagnostics report carries no project content
 *
 * Usage:
 *   node scripts/verify.mjs                     # default: ~/Documents/Image-Line
 *   FLP_DIR=D:\projects node scripts/verify.mjs # custom root
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { parseFlp } from '../src/flp/project.ts';
import { buildReport, hasFatal } from '../src/flp/diagnostics.ts';

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (extname(entry.name).toLowerCase() === '.flp') out.push(full);
  }
  return out;
}

const root = process.env.FLP_DIR || join(homedir(), 'Documents', 'Image-Line');
const files = walk(root, []).sort();

if (files.length === 0) {
  console.error(`no .flp files under ${root}`);
  process.exit(2);
}

let ok = 0;
let fatal = 0;
let mismatched = 0;
let unverified = 0;
let leaked = 0;
const times = [];
const rows = [];

for (const file of files) {
  const bytes = readFileSync(file);
  const started = performance.now();
  const project = parseFlp(bytes, undefined);
  const ms = performance.now() - started;
  times.push(ms);

  const failed = hasFatal(project.diagnostics);
  if (failed) fatal++;
  else ok++;
  if (!project.profile.verified) unverified++;
  if (project.channels.length !== project.meta.numChannels) mismatched++;

  // S7: the pasteable report must not contain sample content.
  const report = buildReport({
    fileSize: bytes.length,
    version: project.meta.version,
    profileId: project.profile.id,
    header: {
      format: project.meta.format,
      channels: project.meta.numChannels,
      ppq: project.meta.ppq,
      dataSize: bytes.length,
    },
    diag: project.diagnostics,
  });
  const leaks = [project.meta.title, project.meta.author, project.channels[0]?.name]
    .filter((value) => value && value.length > 3)
    .filter((value) => report.includes(value));
  if (leaks.length > 0) {
    leaked++;
    console.log(`  LEAK ${basename(file)}: ${leaks.join(', ')}`);
  }

  rows.push({
    file: basename(file),
    ms,
    version: project.meta.version,
    channels: project.channels.length,
    expected: project.meta.numChannels,
    patterns: project.patterns.length,
    notes: project.patterns.reduce((sum, p) => sum + p.notes.length, 0),
    playlist: project.playlist.length,
    arrangements: project.arrangements.length,
    kb: bytes.length / 1024,
    issues: project.diagnostics.issues.length,
  });
}

times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];

console.log(`root       ${root}`);
console.log(`files      ${files.length}`);
console.log(`ok         ${ok}   fatal ${fatal}`);
console.log(`S2 channel-count mismatches: ${mismatched}`);
console.log(`S7 report leaks: ${leaked}`);
console.log(`unverified profile: ${unverified}`);
console.log(`parse ms   min ${times[0].toFixed(0)}  median ${pct(0.5).toFixed(0)}  p95 ${pct(0.95).toFixed(0)}  max ${times[times.length - 1].toFixed(0)}`);

const heaviest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log('\nheaviest:');
for (const r of heaviest) {
  console.log(
    `  ${r.ms.toFixed(0).padStart(4)}ms  ${String(r.kb.toFixed(0)).padStart(6)}KB  ` +
      `ch ${r.channels}/${r.expected}  pat ${r.patterns}  notes ${r.notes}  pl ${r.playlist}  ` +
      `arr ${r.arrangements}  ${r.version}  ${r.file.slice(0, 44)}`,
  );
}

const failing = rows.filter((r) => r.issues > 0).slice(0, 10);
if (failing.length > 0) {
  console.log('\nfiles with issues:');
  for (const r of failing) console.log(`  ${r.issues} issue(s)  ${r.file}`);
}

process.exit(fatal > 0 || mismatched > 0 || leaked > 0 ? 1 : 0);
