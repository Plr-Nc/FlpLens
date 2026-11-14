#!/usr/bin/env node
/**
 * Builds a minimal, structurally valid .flp from scratch.
 *
 * Why: regression tests must not depend on anyone's music. This file is
 * synthesised byte by byte from the layout documented in src/flp/events.ts,
 * so it also doubles as executable documentation of what the parser expects.
 *
 *   node scripts/make-fixture.mjs test/fixtures/minimal/sample.flp
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ascii, event, note, playlistItem, u16, u32, utf16, wrapFlp } from './lib/flp-writer.mjs';

const notes = [
  note({ position: 0, length: 96, key: 60, channel: 0 }),
  note({ position: 96, length: 96, key: 64, channel: 0 }),
  note({ position: 192, length: 48, key: 67, channel: 0 }),
];

const events = [
  event(199, ascii('25.1.4.4951')),
  event(17, [4]), // project time signature numerator
  event(18, [4]), // denominator
  event(35, [1]),
  event(195, utf16('generated fixture')),

  event(64, u16(0)), // new channel 0
  event(21, [2]), // instrument
  event(128, u32(0x00c396d4)), // colour (0x00BBGGRR)
  event(201, utf16('Fruity Wrapper')),
  event(203, utf16('Test Synth')),

  event(65, u16(0)), // new pattern 0
  event(193, utf16('Verse')),
  event(150, u32(0x004a9eff)),
  event(224, notes.flat()),

  event(99, u16(0)), // arrangement 0
  event(241, utf16('Arrangement')),
  event(233, playlistItem({ position: 0, length: 384, track: 1, pattern: 0 })),

  event(236, u32(0)), // insert 0 = Master
  event(204, utf16('Master')),
  event(149, u32(0x007e6e68)),
  event(98, u16(0)),
  event(201, utf16('Fruity Limiter')),
];

const bytes = wrapFlp(events, { numChannels: 1, ppq: 96 });
const out = process.argv[2] || 'test/fixtures/minimal/sample.flp';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`${out} (${bytes.length} bytes, ${events.length} events)`);
