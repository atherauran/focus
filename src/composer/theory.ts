export const mod12 = (n: number) => ((n % 12) + 12) % 12;

export type ModeName = 'major' | 'lydian' | 'mixolydian' | 'minor' | 'dorian';

export const MODES: Record<ModeName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

export const isMinorMode = (m: ModeName) => m === 'minor' || m === 'dorian';

export interface Key {
  tonic: number; // pitch class
  mode: ModeName;
}

export const keyPcs = (k: Key) => MODES[k.mode].map((i) => mod12(k.tonic + i));

export type Quality =
  | 'maj' | 'min' | 'sus2' | 'add9' | 'madd9'
  | 'maj7' | 'maj9' | 'maj7#11' | '6' | '69'
  | 'm7' | 'm9' | 'm11' | 'm6' | 'mmaj7'
  | '7' | '9' | '13' | '7sus' | '7b9' | '7alt'
  | 'm7b5' | 'dim7';

export interface Chord {
  root: number; // pitch class
  q: Quality;
  bass?: number; // pitch class when not the root (slash / pedal)
}

interface QualityDef {
  core: number[]; // essential tones, intervals above root
  ext: number[]; // written-in extensions (always part of the sound)
  slots: number[][]; // chord-scale: per degree the options, first = default
  family: 'maj' | 'min' | 'dom' | 'hdim' | 'dim' | 'sus';
}

const MAJ_SLOTS = [[0], [2], [4], [5, 6], [7], [9], [11]];
const MIN_SLOTS = [[0], [2, 1], [3], [5], [7], [9, 8], [10]];
const DOM_SLOTS = [[0], [2, 1, 3], [4], [5], [7], [9, 8], [10]];

export const QUALITIES: Record<Quality, QualityDef> = {
  maj: { core: [0, 4, 7], ext: [], slots: MAJ_SLOTS, family: 'maj' },
  add9: { core: [0, 4, 7], ext: [14], slots: MAJ_SLOTS, family: 'maj' },
  sus2: { core: [0, 2, 7], ext: [], slots: MAJ_SLOTS, family: 'maj' },
  maj7: { core: [0, 4, 7, 11], ext: [], slots: MAJ_SLOTS, family: 'maj' },
  maj9: { core: [0, 4, 7, 11], ext: [14], slots: MAJ_SLOTS, family: 'maj' },
  'maj7#11': { core: [0, 4, 7, 11], ext: [18], slots: [[0], [2], [4], [6], [7], [9], [11]], family: 'maj' },
  '6': { core: [0, 4, 7, 9], ext: [], slots: MAJ_SLOTS, family: 'maj' },
  '69': { core: [0, 4, 7, 9], ext: [14], slots: MAJ_SLOTS, family: 'maj' },
  min: { core: [0, 3, 7], ext: [], slots: MIN_SLOTS, family: 'min' },
  madd9: { core: [0, 3, 7], ext: [14], slots: MIN_SLOTS, family: 'min' },
  m7: { core: [0, 3, 7, 10], ext: [], slots: MIN_SLOTS, family: 'min' },
  m9: { core: [0, 3, 7, 10], ext: [14], slots: MIN_SLOTS, family: 'min' },
  m11: { core: [0, 3, 7, 10], ext: [14, 17], slots: MIN_SLOTS, family: 'min' },
  m6: { core: [0, 3, 7, 9], ext: [], slots: [[0], [2], [3], [5], [7], [9], [10, 11]], family: 'min' },
  mmaj7: { core: [0, 3, 7, 11], ext: [], slots: [[0], [2], [3], [5], [7], [9], [11]], family: 'min' },
  '7': { core: [0, 4, 7, 10], ext: [], slots: DOM_SLOTS, family: 'dom' },
  '9': { core: [0, 4, 7, 10], ext: [14], slots: DOM_SLOTS, family: 'dom' },
  '13': { core: [0, 4, 7, 10], ext: [14, 21], slots: DOM_SLOTS, family: 'dom' },
  '7sus': { core: [0, 5, 7, 10], ext: [14], slots: [[0], [2], [5], [7], [9], [10]], family: 'sus' },
  '7b9': { core: [0, 4, 7, 10], ext: [13], slots: [[0], [1], [3], [4], [7], [8, 9], [10]], family: 'dom' },
  '7alt': { core: [0, 4, 10], ext: [13, 20], slots: [[0], [1], [3], [4], [6], [8], [10]], family: 'dom' },
  m7b5: { core: [0, 3, 6, 10], ext: [], slots: [[0], [1, 2], [3], [5], [6], [8], [10]], family: 'hdim' },
  dim7: { core: [0, 3, 6, 9], ext: [], slots: [[0], [2], [3], [5], [6], [8], [9], [11]], family: 'dim' },
};

export const chordFamily = (c: Chord) => QUALITIES[c.q].family;

/** Chord-scale as pitch classes: each ambiguous degree takes the key's version when it has one. */
export function chordScale(c: Chord, key: Key): number[] {
  const kp = new Set(keyPcs(key));
  const def = QUALITIES[c.q];
  const pcs = def.slots.map((opts) => {
    const inKey = opts.find((o) => kp.has(mod12(c.root + o)));
    return mod12(c.root + (inKey ?? opts[0]));
  });
  for (const e of def.ext) pcs.push(mod12(c.root + e));
  return [...new Set(pcs)].sort((a, b) => a - b);
}

export const chordTones = (c: Chord) => QUALITIES[c.q].core.map((i) => mod12(c.root + i));

/** Tones that are fine to sustain over the chord: chord tones plus non-avoid tensions. */
export function stableTones(c: Chord, key: Key): number[] {
  const core = chordTones(c);
  const fam = chordFamily(c);
  const out = new Set(core);
  for (const e of QUALITIES[c.q].ext) out.add(mod12(c.root + e));
  for (const pc of chordScale(c, key)) {
    if (out.has(pc)) continue;
    // A tension a half step above a chord tone is an avoid note (except on dominants, where b9/b13 color is idiomatic).
    const avoid = core.some((t) => mod12(pc - t) === 1);
    if (!avoid || fam === 'dom') out.add(pc);
  }
  if (fam === 'maj') out.delete(mod12(c.root + 5));
  return [...out];
}

/** Tensions usable in voicings, ordered by how commonly they are added. */
export function tensions(c: Chord, key: Key): number[] {
  const fam = chordFamily(c);
  const scale = new Set(chordScale(c, key));
  const has = (i: number) => scale.has(mod12(c.root + i));
  const t: number[] = [];
  const add = (i: number) => {
    if (has(i) && !t.includes(i)) t.push(i);
  };
  for (const e of QUALITIES[c.q].ext) t.push(e);
  switch (fam) {
    case 'maj':
      add(14); add(21);
      if (has(6)) add(18);
      break;
    case 'min':
      add(14); add(17);
      if (c.q !== 'm6') add(21);
      break;
    case 'dom':
      if (has(2)) add(14); else add(13);
      if (has(9)) add(21); else add(20);
      break;
    case 'sus':
      add(14); add(21);
      break;
    case 'hdim':
      add(17); add(14);
      break;
    case 'dim':
      add(14);
      break;
  }
  return t;
}

const ROMAN: Record<string, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

const SUFFIX: Record<string, Quality> = {
  M7: 'maj7', M9: 'maj9', 'M7#11': 'maj7#11', '6': '6', '69': '69', add9: 'add9', sus2: 'sus2',
  '7': '7', '9': '9', '13': '13', sus: '7sus', '7sus': '7sus', '7alt': '7alt', '7b9': '7b9', alt: '7alt',
  m7: 'm7', m9: 'm9', m11: 'm11', m6: 'm6', mM7: 'mmaj7', madd9: 'madd9',
  m7b5: 'm7b5', o7: 'dim7', '': 'maj',
};

const LOWER_SUFFIX: Record<string, Quality> = {
  '': 'min', '7': 'm7', '9': 'm9', '11': 'm11', '6': 'm6', add9: 'madd9', M7: 'mmaj7', m7b5: 'm7b5', '7b5': 'm7b5', o7: 'dim7',
};

/**
 * Parse a roman-numeral chord relative to a tonic: "IM7", "vi7", "bVII7", "#iv7b5", "IVM7/I", "V7/ii".
 * Upper case = major-family, lower case = minor-family; flats/sharps are relative to the major scale.
 */
export function parseRoman(tok: string, tonic: number): Chord {
  const [main, slash] = tok.split('/');
  const m = /^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(main);
  if (!m) throw new Error('bad roman ' + tok);
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const upper = m[2] === m[2].toUpperCase();
  const deg = ROMAN[m[2].toUpperCase()] + acc;
  const q = upper ? SUFFIX[m[3]] : LOWER_SUFFIX[m[3]];
  if (!q) throw new Error('bad quality ' + tok);
  let root = mod12(tonic + deg);
  let bass: number | undefined;
  if (slash) {
    const sm = /^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)$/.exec(slash);
    if (!sm) throw new Error('bad slash ' + tok);
    const sdeg = ROMAN[sm[2].toUpperCase()] + (sm[1] === 'b' ? -1 : sm[1] === '#' ? 1 : 0);
    // A lowercase/uppercase numeral after a slash on a dominant means "secondary": V7/ii.
    if (/7|9|13|sus|alt/.test(m[3]) && upper && m[2] === 'V') {
      root = mod12(tonic + sdeg + 7);
    } else {
      bass = mod12(tonic + sdeg);
    }
  }
  return { root, q, bass };
}

export const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function chordName(c: Chord): string {
  const n = NOTE_NAMES[c.root] + c.q.replace('maj', 'M').replace(/^min$/, 'm').replace(/^M$/, '');
  return c.bass !== undefined && c.bass !== c.root ? `${n}/${NOTE_NAMES[c.bass]}` : n;
}

/** Nearest midi note with pitch class pc to target (ties go down). */
export function nearestPc(pc: number, target: number): number {
  const base = target - mod12(target - pc);
  return target - base <= base + 12 - target ? base : base + 12;
}

/** Lowest midi >= lo with pitch class pc. */
export const pcAtOrAbove = (pc: number, lo: number) => lo + mod12(pc - lo);
