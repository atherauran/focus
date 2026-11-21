// Extracts real drum performances from Magenta's Groove MIDI Dataset (CC BY 4.0) into
// src/composer/grooves.json: per performance, a run of 4/4 bars with human timing and dynamics.
// Run once: `npm run grooves`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '.sample-cache', '_src');
const dir = join(src, 'groove');
if (!existsSync(dir)) {
  const zip = join(src, 'groove.zip');
  execFileSync('curl', ['-sL', '--create-dirs', '-o', zip, 'https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip']);
  execFileSync('tar', ['-xf', zip, '-C', src]);
}

// Roland TD-11 mapping used by the dataset -> our kit. Index = hit code in the JSON.
// Hit codes: 0 kick, 1 snare, 2 xstick, 3 hat, 4 hatfoot, 5 hatopen, 6 ride, 7 bell (GROOVE_HITS in grooves.ts).
const MAP = { 36: 0, 38: 1, 40: 1, 37: 2, 42: 3, 22: 3, 44: 4, 46: 5, 26: 5, 51: 6, 59: 6, 53: 7 };
const TOMS = new Set([43, 45, 47, 48, 50, 58]);
const CRASH = new Set([49, 52, 55, 57]);

/** Minimal SMF reader: note-ons with absolute ticks, plus the file's resolution. */
function readMidi(buf) {
  let p = 0;
  const u32 = () => (p += 4, buf.readUInt32BE(p - 4));
  const u16 = () => (p += 2, buf.readUInt16BE(p - 2));
  const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  p = 8; u16(); const ntrk = u16(); const ppq = u16();
  const notes = [];
  for (let k = 0; k < ntrk; k++) {
    p += 4; const end = u32() + p;
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      let b = buf[p];
      if (b & 0x80) { status = b; p++; } else b = status;
      const type = status & 0xf0;
      if (status === 0xff) { p++; const len = vlq(); p += len; }
      else if (status === 0xf0 || status === 0xf7) { const len = vlq(); p += len; }
      else if (type === 0xc0 || type === 0xd0) p += 1;
      else {
        const a = buf[p++], v = buf[p++];
        if (type === 0x90 && v > 0) notes.push({ tick, pitch: a, vel: v });
      }
    }
    p = end;
  }
  return { ppq, notes };
}

const rows = readFileSync(join(dir, 'info.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const out = [];
for (const [, , id, style, bpm, beatType, ts, file] of rows) {
  const family = style.split('/')[0];
  if (beatType !== 'beat' || ts !== '4-4' || !['hiphop', 'soul', 'funk'].includes(family) || +bpm > 108) continue;
  const { ppq, notes } = readMidi(readFileSync(join(dir, file)));
  const bars = new Map();
  for (const n of notes) {
    const beat = n.tick / ppq;
    const bar = Math.floor((beat + 0.125) / 4);
    const b = bars.get(bar) ?? bars.set(bar, { hits: [], toms: 0 }).get(bar);
    if (TOMS.has(n.pitch)) b.toms++;
    else if (!CRASH.has(n.pitch) && MAP[n.pitch] !== undefined) b.hits.push([+(beat - bar * 4).toFixed(3), MAP[n.pitch], +(n.vel / 127).toFixed(2)]);
  }
  // Steady groove bars only: kick and backbeat present, no tom fills.
  const good = [...bars.entries()]
    .filter(([i, b]) => i > 0 && b.toms < 2 && b.hits.length >= 8 && b.hits.some((h) => h[1] === 0) && b.hits.some((h) => h[1] === 1 && h[2] > 0.35))
    .map(([, b]) => b.hits.sort((x, y) => x[0] - y[0]));
  if (good.length < 4) continue;
  // Swing: where off-beat cymbal notes fall inside their pair (0.5 straight, 0.67 triplet),
  // measured on 16ths when the drummer plays them, else on 8ths.
  const cym = good.flat().filter((h) => h[1] === 3 || h[1] === 6);
  const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const swingOf = (unit) => {
    // Relative to the drummer's own on-beats, which usually sit a little ahead of or behind the click.
    const lean = median(cym.filter((h) => Math.round(h[0] / unit) % 2 === 0).map((h) => h[0] - Math.round(h[0] / (2 * unit)) * 2 * unit)) ?? 0;
    const r = cym.filter((h) => Math.round(h[0] / unit) % 2 !== 0).map((h) => (h[0] - lean - Math.floor(h[0] / (2 * unit) + 0.1) * 2 * unit) / (2 * unit)).sort();
    return r.length >= 12 ? { unit, swing: +r[r.length >> 1].toFixed(3) } : null;
  };
  const sw = swingOf(0.25) ?? swingOf(0.5) ?? { unit: 0.5, swing: 0.5 };
  out.push({ id: id.replace(/\//g, '-'), style: family, bpm: +bpm, ...sw, bars: good.slice(0, 8) });
}
writeFileSync(join(root, 'src', 'composer', 'grooves.json'), JSON.stringify(out) + '\n');
console.log(`${out.length} grooves, ${out.reduce((n, g) => n + g.bars.length, 0)} bars`, out.map((g) => `${g.style}@${g.bpm} ${g.unit}:${g.swing}`).join(' '));
