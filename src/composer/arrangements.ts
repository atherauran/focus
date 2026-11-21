import type { Inst, Language, Params, Style } from './types';

export type CompMode = 'jazz' | 'lofi' | 'ballad' | 'fingerpick' | 'bossa' | 'arp' | 'waltz' | 'ostinato';
export type BassMode = 'walk' | 'two' | 'lofi' | 'bossa' | 'pedal' | 'folk';
export type DrumKit = 'lofi' | 'brushes' | 'bossa' | 'shaker'; // 'lofi' plays recorded hip-hop/soul grooves

/** song: a tune with a head and choruses. loop: a beat tape built on a short loop. arc: one build and release. */
export type Form = 'song' | 'loop' | 'arc';

export interface Arrangement {
  id: string;
  style: Style;
  lang: Language;
  form?: Form; // default 'song'
  meters: number[]; // beats per bar, picked at random
  tempo: [number, number];
  melody: Inst[]; // first plays the head; the second (if any) takes solos / the bridge
  counter?: Inst; // short answers in the melody's gaps
  comp?: { inst: Inst; mode: CompMode };
  bass?: { inst: Inst; mode: BassMode };
  pad?: Inst;
  texture?: { inst: Inst; mode: 'arp' | 'bells' };
  drums?: DrumKit;
  swing: number; // position of the off-beat (0.5 straight, 0.667 triplet)
  swingUnit: 0.5 | 0.25;
  home: Params; // the settings this arrangement suits best
}

export const ARRANGEMENTS: Arrangement[] = [
  {
    id: 'solo-piano', style: 'ballad', lang: 'jazz', meters: [4, 4, 3], tempo: [56, 72],
    melody: ['piano'], comp: { inst: 'piano', mode: 'ballad' },
    swing: 0.6, swingUnit: 0.5,
    home: { energy: 0.2, mood: 0.5, space: 0.4, complexity: 0.6 },
  },
  {
    id: 'rhodes-trio', style: 'jazz', lang: 'jazz', meters: [4], tempo: [84, 116],
    melody: ['rhodes'], comp: { inst: 'rhodes', mode: 'jazz' }, bass: { inst: 'upright', mode: 'walk' }, drums: 'brushes',
    swing: 0.64, swingUnit: 0.5,
    home: { energy: 0.6, mood: 0.5, space: 0.35, complexity: 0.7 },
  },
  {
    id: 'lofi-keys', style: 'lofi', lang: 'lofi', meters: [4], tempo: [70, 86],
    melody: ['nylon', 'vibes'], counter: 'vibes', comp: { inst: 'rhodes', mode: 'lofi' }, bass: { inst: 'upright', mode: 'lofi' }, drums: 'lofi',
    swing: 0.58, swingUnit: 0.25,
    home: { energy: 0.55, mood: 0.45, space: 0.4, complexity: 0.45 },
  },
  {
    id: 'lofi-guitar', style: 'lofi', lang: 'lofi', meters: [4], tempo: [66, 80],
    melody: ['rhodes', 'vibes'], comp: { inst: 'nylon', mode: 'fingerpick' }, bass: { inst: 'upright', mode: 'lofi' }, drums: 'lofi',
    pad: 'pad', swing: 0.57, swingUnit: 0.25,
    home: { energy: 0.45, mood: 0.5, space: 0.5, complexity: 0.35 },
  },
  {
    id: 'pads-bells', style: 'ambient', lang: 'ambient', meters: [4], tempo: [54, 66],
    melody: ['glock', 'vibes'], pad: 'pad', texture: { inst: 'harp', mode: 'arp' }, bass: { inst: 'pad', mode: 'pedal' },
    swing: 0.5, swingUnit: 0.5,
    home: { energy: 0.12, mood: 0.6, space: 0.85, complexity: 0.3 },
  },
  {
    id: 'piano-glass', style: 'ambient', lang: 'ambient', meters: [4, 3], tempo: [56, 70],
    melody: ['piano'], comp: { inst: 'piano', mode: 'arp' }, pad: 'bowedvibes', bass: { inst: 'piano', mode: 'pedal' },
    swing: 0.5, swingUnit: 0.5,
    home: { energy: 0.2, mood: 0.45, space: 0.7, complexity: 0.45 },
  },
  {
    id: 'vibes-quartet', style: 'jazz', lang: 'jazz', meters: [4, 3], tempo: [92, 124],
    melody: ['vibes'], counter: 'piano', comp: { inst: 'piano', mode: 'jazz' }, bass: { inst: 'upright', mode: 'walk' }, drums: 'brushes',
    swing: 0.64, swingUnit: 0.5,
    home: { energy: 0.65, mood: 0.6, space: 0.45, complexity: 0.75 },
  },
  {
    id: 'bossa', style: 'bossa', lang: 'bossa', meters: [4], tempo: [108, 128],
    melody: ['flute', 'vibes'], comp: { inst: 'nylon', mode: 'bossa' }, bass: { inst: 'upright', mode: 'bossa' }, drums: 'bossa',
    swing: 0.52, swingUnit: 0.5,
    home: { energy: 0.65, mood: 0.65, space: 0.4, complexity: 0.6 },
  },
  {
    id: 'harp-lullaby', style: 'ambient', lang: 'folk', meters: [3, 4], tempo: [52, 64],
    melody: ['glock', 'flute'], comp: { inst: 'harp', mode: 'arp' }, pad: 'pad',
    swing: 0.5, swingUnit: 0.5,
    home: { energy: 0.05, mood: 0.55, space: 0.75, complexity: 0.15 },
  },
  {
    id: 'folk-guitar', style: 'folk', lang: 'folk', meters: [4, 3], tempo: [72, 92],
    melody: ['flute', 'piano'], comp: { inst: 'nylon', mode: 'fingerpick' }, bass: { inst: 'upright', mode: 'folk' }, pad: 'bowedvibes', drums: 'shaker',
    swing: 0.53, swingUnit: 0.5,
    home: { energy: 0.4, mood: 0.7, space: 0.5, complexity: 0.25 },
  },
  {
    id: 'rhodes-ballad', style: 'ballad', lang: 'lofi', meters: [4], tempo: [60, 74],
    melody: ['rhodes'], comp: { inst: 'rhodes', mode: 'ballad' }, pad: 'pad', texture: { inst: 'vibes', mode: 'bells' },
    swing: 0.58, swingUnit: 0.5,
    home: { energy: 0.25, mood: 0.4, space: 0.6, complexity: 0.5 },
  },
  // Cinematic: piano ostinatos, string sections and winds, one long build and release.
  {
    id: 'felt-strings', style: 'cinematic', lang: 'cinematic', form: 'arc', meters: [4, 4, 3], tempo: [60, 76],
    melody: ['felt', 'strings'], comp: { inst: 'felt', mode: 'ostinato' }, pad: 'strings', bass: { inst: 'strings', mode: 'pedal' },
    swing: 0.5, swingUnit: 0.5,
    home: { energy: 0.3, mood: 0.45, space: 0.6, complexity: 0.4 },
  },
  {
    id: 'felt-solo', style: 'cinematic', lang: 'cinematic', form: 'arc', meters: [4, 3], tempo: [58, 72],
    melody: ['felt'], comp: { inst: 'felt', mode: 'ostinato' },
    swing: 0.5, swingUnit: 0.5,
    home: { energy: 0.15, mood: 0.5, space: 0.45, complexity: 0.3 },
  },
  {
    id: 'chamber', style: 'cinematic', lang: 'cinematic', form: 'arc', meters: [4, 3], tempo: [64, 84],
    melody: ['clarinet', 'flute'], comp: { inst: 'harp', mode: 'ostinato' }, pad: 'strings', bass: { inst: 'strings', mode: 'pedal' },
    swing: 0.5, swingUnit: 0.5,
    home: { energy: 0.35, mood: 0.62, space: 0.55, complexity: 0.5 },
  },
  {
    id: 'pulse', style: 'cinematic', lang: 'cinematic', form: 'arc', meters: [4], tempo: [76, 96],
    melody: ['strings', 'clarinet'], comp: { inst: 'marimba', mode: 'ostinato' }, pad: 'strings', bass: { inst: 'strings', mode: 'pedal' },
    texture: { inst: 'felt', mode: 'bells' },
    swing: 0.5, swingUnit: 0.5,
    home: { energy: 0.5, mood: 0.5, space: 0.45, complexity: 0.55 },
  },
  // Beat tapes: a short loop, a hook, a beat switch and a drop, over recorded drummers.
  {
    id: 'tape-keys', style: 'beats', lang: 'beats', form: 'loop', meters: [4], tempo: [72, 88],
    melody: ['vibes', 'marimba'], comp: { inst: 'rhodes', mode: 'lofi' }, bass: { inst: 'upright', mode: 'lofi' }, drums: 'lofi', pad: 'pad',
    swing: 0.56, swingUnit: 0.25,
    home: { energy: 0.55, mood: 0.5, space: 0.4, complexity: 0.4 },
  },
  {
    id: 'tape-guitar', style: 'beats', lang: 'beats', form: 'loop', meters: [4], tempo: [70, 84],
    melody: ['rhodes', 'flute'], comp: { inst: 'nylon', mode: 'fingerpick' }, bass: { inst: 'upright', mode: 'lofi' }, drums: 'lofi',
    texture: { inst: 'vibes', mode: 'bells' },
    swing: 0.56, swingUnit: 0.25,
    home: { energy: 0.48, mood: 0.55, space: 0.45, complexity: 0.35 },
  },
  {
    id: 'tape-piano', style: 'beats', lang: 'beats', form: 'loop', meters: [4], tempo: [68, 82],
    melody: ['marimba', 'clarinet'], comp: { inst: 'felt', mode: 'lofi' }, bass: { inst: 'upright', mode: 'lofi' }, drums: 'lofi', pad: 'pad',
    swing: 0.56, swingUnit: 0.25,
    home: { energy: 0.5, mood: 0.4, space: 0.5, complexity: 0.45 },
  },
];

export interface Range {
  lo: number;
  hi: number;
  center: number;
}

export const MELODY_RANGE: Partial<Record<Inst, Range>> = {
  piano: { lo: 62, hi: 86, center: 74 },
  felt: { lo: 64, hi: 86, center: 74 },
  rhodes: { lo: 60, hi: 82, center: 70 },
  nylon: { lo: 57, hi: 79, center: 67 },
  flute: { lo: 64, hi: 91, center: 77 },
  clarinet: { lo: 55, hi: 82, center: 68 },
  strings: { lo: 62, hi: 86, center: 74 },
  vibes: { lo: 60, hi: 84, center: 72 },
  marimba: { lo: 60, hi: 86, center: 72 },
  glock: { lo: 79, hi: 96, center: 86 },
  harp: { lo: 60, hi: 84, center: 72 },
};

export const BASS_RANGE: Partial<Record<Inst, Range>> = {
  upright: { lo: 28, hi: 52, center: 38 },
  strings: { lo: 36, hi: 52, center: 43 },
  piano: { lo: 31, hi: 50, center: 40 },
  pad: { lo: 36, hi: 50, center: 43 },
};

export function arrangementById(id: string): Arrangement {
  const a = ARRANGEMENTS.find((x) => x.id === id);
  if (!a) throw new Error('unknown arrangement ' + id);
  return a;
}
