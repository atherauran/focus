// Downloads open-licensed samples, trims/normalizes them with ffmpeg into public/samples,
// and writes src/engine/sampleMap.json. Run once: `npm run samples` (needs ffmpeg).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.sample-cache');
const out = join(root, 'public', 'samples');

const RH = 'https://danigb.github.io/samples/jlearman/rhodes-mki/jRhodes3d-st/';
const DB = 'https://danigb.github.io/samples/dsmolken/double-bass/pizz/';
const VCSL = 'https://smpldsnds.github.io/sgossner-vcsl/';
const VSCO = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/';
const vsco = (path) => VSCO + path.split('/').map(encodeURIComponent).join('/');
// FreePats Spanish classical guitar ships as a .7z; it is unpacked into the cache first.
const GUITAR_7Z = 'https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SFZ+FLAC-20190618.7z';
const GUITAR_DIR = join(cache, '_src', 'SpanishClassicalGuitar-SFZ+FLAC-20190618', 'samples');

// VCSL files live in nested folders; resolve by basename from the index.
let vcslIndex;
async function vcsl(name) {
  if (!vcslIndex) {
    const html = await (await fetch(VCSL)).text();
    vcslIndex = [...html.matchAll(/href="([^"]+\.ogg)"/g)].map((m) => m[1]);
  }
  const hit = vcslIndex.find((p) => p.endsWith('/' + name + '.ogg'));
  if (!hit) throw new Error('VCSL sample not found: ' + name);
  return VCSL + hit.split('/').map(encodeURIComponent).join('/');
}

const sharp = (n) => n.replace('s', '#');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
// VSCO 2 and most VCSL sets name notes an octave low (middle C = C3): file name for a sounding note.
const low = (n) => midiToName(noteToMidi(n) - 12);

// key: note name (pitched) or hit name (drums). layers: optional velocity layers.
const instruments = [
  {
    // VCSL Steinway B, sustain pedal down, two velocity layers.
    id: 'piano', maxDur: 9, fade: 2.5, channels: 2,
    layers: [2, 3],
    notes: ['A#1', 'C2', 'E2', 'G#2', 'C3', 'E3', 'G#3', 'C4', 'E4', 'G#4', 'C5', 'E5', 'G#5', 'C6', 'E6', 'G#6', 'C7'],
    url: (n, layer) => vcsl(`JHPiano_Sus_Close_${n}_vl${layer}_rr1`),
  },
  {
    id: 'rhodes', maxDur: 8, fade: 2, channels: 2,
    layers: [4, 2],
    notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'D4', 'F4', 'B4', 'E5', 'A5', 'D6'],
    url: (n, layer) => {
      const midi = noteToMidi(n);
      return `${RH}A_${String(midi).padStart(3, '0')}__${n}_${layer}-ST.ogg`;
    },
  },
  {
    id: 'upright', maxDur: 4.5, fade: 1.2, channels: 1,
    notes: [['C1', 'c1_ma'], ['Eb1', 'eb1_ma'], ['G1', 'g1_ma'], ['Bb1', 'bb1_pd'], ['D2', 'd2_ma'], ['F2', 'f2_ma'], ['A2', 'a2_ma'], ['C3', 'c3_ma'], ['E3', 'e3_ma'], ['G3', 'g3_ma']]
      .map(([k, f]) => ({ key: k, url: `${DB}pizz_${f}.ogg` })),
  },
  {
    // FreePats Spanish classical guitar (local, from the unpacked archive).
    id: 'nylon', maxDur: 4.5, fade: 1.2, channels: 2,
    notes: ['E2', 'G2', 'A2', 'C3', 'E3', 'G3', 'A#3', 'C#4', 'E4', 'G4', 'A#4', 'C#5', 'E5', 'G5', 'C6']
      .map((n) => ({ key: n, file: join(GUITAR_DIR, n + '.flac') })),
  },
  {
    id: 'flute', maxDur: 6, fade: 1.2, channels: 1,
    notes: ['C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6', 'C7']
      .map((n) => ({ key: n, url: vsco(`Woodwinds/Flute/susvib/LDFlute_susvib_${low(n)}_v1_1.wav`) })),
  },
  {
    id: 'clarinet', maxDur: 6, fade: 1.2, channels: 1,
    layers: [1, 2],
    notes: ['F3', 'A#3', 'D4', 'F4', 'A#4', 'D5', 'F5', 'A#5', 'D6'],
    url: (n, layer) => vsco(`Woodwinds/Clarinet/susLong/DCClar_susLong_${low(n)}_v${layer}_rr1_sum.wav`),
  },
  {
    // A string section patch: celli low, violas in the middle, violins on top.
    id: 'strings', maxDur: 8, fade: 2, channels: 2,
    layers: [1, 2],
    notes: ['C2', 'E2', 'G2', 'B2', 'D3', 'G3', 'B3', 'D4', 'F#4', 'A4', 'C5', 'E5', 'G5', 'B5', 'D6'],
    url: (n, layer) => {
      const m = noteToMidi(n);
      if (m < 50) return vsco(`Strings/Cello Section/susvib/susvib_${low(n)}_v${layer === 1 ? 1 : 3}_1.wav`);
      if (m < 62) return vsco(`Strings/Viola Section/susvib/ViolaEns_susvib_${low(n)}_v${layer}_1.wav`);
      return vsco(`Strings/Violin Section/susVib/VlnEns_susVib_${low(n)}_v${layer}.wav`);
    },
  },
  {
    // VCSL Yamaha upright, played softly and darkened in the mix: a felt-piano colour.
    id: 'felt', maxDur: 8, fade: 2.5, channels: 2,
    layers: [1, 2],
    notes: ['A1', 'C#2', 'F2', 'A2', 'C#3', 'F3', 'A3', 'C#4', 'F4', 'A4', 'C#5', 'F5', 'A5', 'C#6', 'F6', 'A6'],
    url: (n, layer) => vcsl(`Player_vl${layer}_rr1_${low(n)}`),
  },
  {
    id: 'marimba', maxDur: 3, fade: 1, channels: 2,
    layers: ['soft', 'med'],
    notes: ['F2', 'C3', 'G3', 'B3', 'F4', 'C5', 'G5', 'B5'],
    url: (n, layer) => vcsl(`Marimba_hit_Outrigger_${low(n)}_${layer}_01`),
  },
  {
    id: 'vibes', maxDur: 7, fade: 2, channels: 2,
    layers: [1, 2],
    notes: ['F3', 'A3', 'C4', 'E4', 'G4', 'B4', 'D5', 'F5', 'A5', 'C6', 'E6'],
    url: (n, layer) => vcsl(`Vibes_soft_${low(n)}_v${layer}_rr1_Main`).catch(() => vcsl(`Vibes_soft_${low(n)}_v${layer}_rr2_Main`)),
  },
  {
    id: 'bowedvibes', maxDur: 9, fade: 2.5, channels: 2,
    notes: ['A3', 'E4', 'G4', 'D5', 'A5', 'E6'],
    url: (n) => vcsl(`Vibes_bowed_${low(n)}_rr1_Main`),
  },
  {
    id: 'glock', maxDur: 5, fade: 1.5, channels: 2,
    notes: [['G5', 'glock_soft_G4_01'], ['C6', 'glock_soft_C5_02'], ['G6', 'glock_soft_G5_01'], ['C7', 'glock_soft_C6_01'], ['G7', 'glock_soft_G6_01'], ['C8', 'glock_soft_C7_03']]
      .map(([k, f]) => ({ key: k, url: () => vcsl(f) })),
  },
  {
    id: 'harp', maxDur: 6, fade: 1.5, channels: 2,
    notes: [['G1', 'KSHarp_G1_mp1'], ['D2', 'KSHarp_D2_mf1'], ['A2', 'KSHarp_A2_mf1'], ['E3', 'KSHarp_E3_mf1'], ['B3', 'KSHarp_B3_mf1'], ['F4', 'KSHarp_F4_mf1'], ['C5', 'KSHarp_C5_mf1'], ['G5', 'KSHarp_G5_mf1'], ['D6', 'KSHarp_D6_mf1'], ['A6', 'KSHarp_A6_mf1']]
      .map(([k, f]) => ({ key: k, url: () => vcsl(f) })),
  },
  {
    id: 'drums', channels: 1, drums: true,
    notes: [
      ['kick1', 'BDrumNew_hit_v2_rr1_Sum', 1.2], ['kick2', 'BDrumNew_hit_v3_rr1_Sum', 1.2], ['kick3', 'BDrumNew_hit_v5_rr2_Sum', 1.2],
      ['snare1', 'Snare4_HitSN_v2_rr1_Mid', 1.2], ['snare2', 'Snare4_HitSN_v2_rr2_Mid', 1.2], ['snare3', 'Snare4_HitSN_v4_rr1_Mid', 1.2],
      ['xstick1', 'Snare4_Xstick_v2_rr1_Mid', 0.8], ['xstick2', 'Snare4_Xstick_v2_rr2_Mid', 0.8],
      ['hat1', 'HiHat_HitC_v1_rr1_Mid', 0.8], ['hat2', 'HiHat_HitC_v1_rr2_Mid', 0.8], ['hat3', 'HiHat_HitC_v2_rr1_Mid', 0.8],
      ['hatfoot', 'HiHat_Close_rr1_Mid', 0.6], ['hatopen', 'HiHat_HitLoose_rr1_Mid', 1.5],
      ['ride1', 'susCymb1_hit_stick_pp1', 4], ['ride2', 'susCymb1_hit_stick_mp1', 4], ['bell', 'susCymb1_hit_bell_pp1', 4],
      ['shaker1', 'Mid_ShakerDouble_Down_rr1', 0.6], ['shaker2', 'Mid_ShakerDouble_Up_rr1', 0.6],
    ].map(([k, f, d]) => ({ key: k, url: () => vcsl(f), maxDur: d, channels: k.startsWith('ride') || k === 'bell' ? 2 : 1 })),
  },
];

function noteToMidi(n) {
  const m = /^([A-G])([b#]?)(-?\d)$/.exec(n);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return pc + 12 * (Number(m[3]) + 1);
}

async function download(url, file) {
  if (existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function measurePeak(src) {
  const r = spawnSync('ffmpeg', ['-nostats', '-i', src, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr)[1]);
}

function convert(src, dst, { maxDur, fade, channels, gain }) {
  mkdirSync(dirname(dst), { recursive: true });
  const filters = [
    'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.004',
    `atrim=0:${maxDur}`,
    `afade=t=out:st=${Math.max(0, maxDur - fade)}:d=${fade}`,
    `volume=${gain.toFixed(2)}dB`,
  ].join(',');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', filters, '-ac', String(channels), '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '4', dst]);
}

function unpackGuitar() {
  if (existsSync(GUITAR_DIR)) return;
  const archive = join(cache, '_src', 'guitar.7z');
  execFileSync('curl', ['-sL', '-o', archive, '--create-dirs', GUITAR_7Z]);
  execFileSync('tar', ['-xf', archive, '-C', join(cache, '_src')]); // bsdtar reads 7z
}

const PEAK_TARGET = -3;
unpackGuitar();
const map = {};
for (const inst of instruments) {
  const entries = {};
  const layers = inst.layers ?? [null];
  for (const n of inst.notes) {
    const note = typeof n === 'string' ? { key: n } : n;
    // Layers of one note share a gain so their relative loudness survives normalization.
    const files = [];
    for (const layer of layers) {
      const safe = (layer == null ? note.key : `${note.key}_v${layer}`).replace('#', 's');
      let cached = note.file;
      if (!cached) {
        let url = note.url ?? inst.url(note.key, layer);
        if (typeof url === 'function') url = url();
        url = await url;
        cached = join(cache, inst.id, `${safe}.${url.split('.').pop()}`);
        await download(url, cached);
      }
      files.push({ layer, safe, cached });
    }
    const gain = PEAK_TARGET - Math.max(...files.map((f) => measurePeak(f.cached)));
    for (const { layer, safe, cached } of files) {
      const maxDur = note.maxDur ?? inst.maxDur;
      convert(cached, join(out, inst.id, `${safe}.mp3`), { maxDur, fade: inst.fade ?? Math.min(0.4, maxDur / 3), channels: note.channels ?? inst.channels, gain });
      const layerKey = layer == null ? 'main' : `v${layers.indexOf(layer)}`;
      (entries[layerKey] ??= {})[note.key] = `${inst.id}/${safe}.mp3`;
      process.stdout.write('.');
    }
  }
  map[inst.id] = entries;
  console.log(' ' + inst.id);
}

writeFileSync(join(root, 'src', 'engine', 'sampleMap.json'), JSON.stringify(map, null, 1) + '\n');
const total = execFileSync('du', ['-sh', out]).toString().trim();
console.log('done', total);
