import { ARRANGEMENTS, Arrangement, MELODY_RANGE } from './arrangements';
import { closingCadence, finalChord, parseProgression, pickTemplate, variants } from './harmony';
import { MelNote, MelodyCtx, composeSection, contrastMotif, makeMotif } from './melody';
import { Rng, rngFor } from './rng';
import { Key, ModeName, chordTones, mod12, nearestPc } from './theory';
import type { BarHarmony, Inst, MelodyMode, Params, Role, Section, SectionKind } from './types';

export interface Piece {
  index: number;
  seed: number;
  arr: Arrangement;
  key: Key;
  beats: number;
  tempo: number;
  energyAtPlan: number;
  sections: Section[];
  melody: MelNote[][]; // composed melody, per piece bar
  sectionOf: number[];
  barInSection: number[];
  totalBars: number;
}

export interface History {
  arrangements: string[];
  tonics: number[];
}

function chooseArrangement(rng: Rng, p: Params, history: History): Arrangement {
  const recent = history.arrangements.slice(-4);
  const items = ARRANGEMENTS.map((a) => {
    const h = a.home;
    const d = Math.hypot((p.energy - h.energy) * 1.6, (p.space - h.space) * 1.0, (p.complexity - h.complexity) * 0.9, (p.mood - h.mood) * 0.35);
    let w = Math.exp((-d * d) / 0.06) + 0.002;
    const ago = recent.length - recent.lastIndexOf(a.id);
    if (recent.includes(a.id)) w *= ago === 1 ? 0 : ago === 2 ? 0.15 : 0.45;
    return [a, w] as const;
  });
  return rng.weighted(items);
}

function chooseMode(rng: Rng, mood: number, arr: Arrangement): ModeName {
  const m = mood;
  const w: [ModeName, number][] = [
    ['minor', Math.pow(1 - m, 2) * 1.2],
    ['dorian', Math.max(0, 0.55 - Math.abs(m - 0.4)) * (arr.lang === 'folk' ? 0.4 : 1)],
    ['major', Math.pow(m, 1.6)],
    ['lydian', arr.lang === 'ambient' || arr.lang === 'lofi' ? Math.max(0, m - 0.55) * 0.9 : 0],
    ['mixolydian', arr.lang === 'folk' ? Math.max(0, 0.5 - Math.abs(m - 0.6)) * 0.6 : 0],
  ];
  return rng.weighted(w);
}

function chooseTonic(rng: Rng, history: History): number {
  const prev = history.tonics[history.tonics.length - 1];
  // Favour keys that sit well on the instruments, and move somewhere new each piece.
  const pref = [0, 2, 3, 5, 7, 8, 9, 10, 4, 1, 6, 11];
  const items = pref.map((pc, i) => {
    let w = 1 - i * 0.06;
    if (pc === prev) w = 0;
    if (prev !== undefined && [5, 7, 3, 9].includes(mod12(pc - prev))) w *= 1.6;
    return [pc, w] as const;
  });
  return rng.weighted(items);
}

interface Block {
  base: BarHarmony[];
  rich: BarHarmony[];
  simple: BarHarmony[];
}

const slice = (b: Block, from: number, to: number): Block => ({ base: b.base.slice(from, to), rich: b.rich.slice(from, to), simple: b.simple.slice(from, to) });
const concat = (...bs: Block[]): Block => ({ base: bs.flatMap((b) => b.base), rich: bs.flatMap((b) => b.rich), simple: bs.flatMap((b) => b.simple) });

const ROLE_LEVELS: Record<string, Partial<Record<Role, number>>> = {
  intro: { comp: 1, pad: 1, bass: 0.7, drums: 0.3, texture: 0.6 },
  A1: { melody: 1, comp: 1, bass: 1, pad: 0.8, texture: 0.6, drums: 0.55 },
  A2: { melody: 1, comp: 1, bass: 1, pad: 0.8, texture: 0.7, drums: 0.8, counter: 0.6 },
  B: { melody: 1, comp: 1, bass: 1, pad: 1, texture: 0.85, drums: 0.9, counter: 0.8 },
  A3: { melody: 1, comp: 1, bass: 1, pad: 0.85, texture: 0.6, drums: 0.85, counter: 0.5 },
  solo: { melody: 1, comp: 1, bass: 1, pad: 0.7, texture: 0.5, drums: 1, counter: 0.3 },
  break: { melody: 1, comp: 1, bass: 0.8, pad: 1, texture: 0.8, drums: 0 },
  outro: { comp: 1, bass: 1, pad: 1, texture: 0.5, drums: 0.3, melody: 1 },
};

export function planPiece(seed: number, index: number, params: Params, history: History): Piece {
  const rng = rngFor(seed, 'piece', index);
  const arr = chooseArrangement(rng, params, history);
  const beats = rng.pick(arr.meters);
  const [tlo, thi] = arr.tempo;
  const tpos = Math.min(1, Math.max(0, 0.15 + params.energy * 0.7 + rng.range(-0.15, 0.15)));
  const tempo = Math.round((tlo + (thi - tlo) * tpos) * (beats === 3 ? 1.1 : 1));
  const key: Key = { tonic: chooseTonic(rng, history), mode: chooseMode(rng, params.mood, arr) };
  const lang = arr.lang;
  const style = beats === 3 && arr.style === 'jazz' ? 'waltz' : arr.style;

  // Harmony blocks.
  const tplA = pickTemplate(rng, lang, key, 'A');
  const tplB = pickTemplate(rng, lang, key, 'B');
  const aOpen = parseProgression(tplA, key, beats);
  const cadence = closingCadence(rng, lang, key, beats);
  const aClosed = [...aOpen.slice(0, 6), ...cadence];
  const bProg = parseProgression(tplB, key, beats);
  const mk = (bars: BarHarmony[], tag: string): Block => variants(bars, rngFor(seed, 'rich', index, tag), lang, key, beats);
  const A = mk(aOpen, 'A');
  const Ac = mk(aClosed, 'Ac');
  const Bb = mk(bProg, 'B');
  const vamp = rng.chance(0.5);
  const intro: Block = lang === 'ambient' || lang === 'folk' || style === 'ballad' || vamp
    ? concat(slice(A, 0, 2), slice(A, 0, 2))
    : slice(A, 4, 8);
  const fin = finalChord(rng, key, lang);
  const outroBars = closingCadence(rng, lang, key, beats);
  outroBars[1] = [{ start: 0, dur: beats, chord: fin }];
  const outro = mk(outroBars, 'out');
  outro.rich[1] = outro.base[1];
  outro.simple[1] = outro.base[1];

  // Form: a head (A A B A), optional middle choruses, a head out, and a tagged ending.
  const barSec = (beats * 60) / tempo;
  const target = rng.range(190, 280);
  const mel = arr.melody;
  const second = mel[1] ?? mel[0];
  type Plan = { kind: SectionKind; label: string; block: Block; melody: MelodyMode; inst: Inst | null; intensity: number; levels: string; lift: number; closed: boolean };
  const plan: Plan[] = [
    { kind: 'intro', label: 'intro', block: intro, melody: 'none', inst: null, intensity: 0.3, levels: 'intro', lift: 0, closed: false },
    { kind: 'A', label: 'A1', block: A, melody: 'theme', inst: mel[0], intensity: 0.45, levels: 'A1', lift: 0, closed: false },
    { kind: 'A', label: 'A2', block: Ac, melody: 'themeVar', inst: mel[0], intensity: 0.55, levels: 'A2', lift: 0, closed: true },
    { kind: 'B', label: 'B', block: Bb, melody: 'contrast', inst: rng.chance(0.4) ? second : mel[0], intensity: 0.68, levels: 'B', lift: 3, closed: false },
    { kind: 'A', label: 'A3', block: Ac, melody: 'theme', inst: mel[0], intensity: 0.6, levels: 'A3', lift: 0, closed: true },
  ];
  const outroPlan: Plan = { kind: 'outro', label: 'outro', block: outro, melody: 'none', inst: mel[0], intensity: 0.35, levels: 'outro', lift: 0, closed: true };
  const bars = (ps: Plan[]) => ps.reduce((n, p) => n + p.block.base.length, 0);
  const headOut: Plan[] = [
    { kind: 'B', label: 'B-out', block: Bb, melody: 'themeVar', inst: mel[0], intensity: 0.7, levels: 'B', lift: 3, closed: false },
    { kind: 'A', label: 'A-out', block: Ac, melody: 'theme', inst: mel[0], intensity: 0.62, levels: 'A3', lift: 0, closed: true },
  ];
  const middle: Plan[] = [];
  const improvises = style === 'jazz' || style === 'waltz' || style === 'bossa';
  const chunk = (i: number): Plan[] => {
    if (improvises) {
      return [
        { kind: 'solo', label: `S${i}a`, block: A, melody: 'improv', inst: second, intensity: 0.75, levels: 'solo', lift: 2, closed: false },
        { kind: 'solo', label: `S${i}b`, block: Ac, melody: 'improv', inst: second, intensity: 0.82, levels: 'solo', lift: 2, closed: true },
      ];
    }
    if (style === 'lofi') {
      return [
        { kind: 'break', label: `Br${i}`, block: A, melody: 'sparse', inst: second, intensity: 0.4, levels: 'break', lift: 0, closed: false },
        { kind: 'solo', label: `S${i}`, block: Ac, melody: 'improv', inst: second, intensity: 0.7, levels: 'solo', lift: 2, closed: true },
      ];
    }
    return [
      { kind: 'break', label: `I${i}`, block: A, melody: 'sparse', inst: second, intensity: 0.4, levels: 'break', lift: -2, closed: false },
      { kind: 'B', label: `B${i}`, block: Bb, melody: 'themeVar', inst: mel[0], intensity: 0.6, levels: 'B', lift: 3, closed: false },
      { kind: 'A', label: `A${i}`, block: Ac, melody: 'themeVar', inst: mel[0], intensity: 0.55, levels: 'A3', lift: 0, closed: true },
    ];
  };
  let tail = headOut;
  for (let i = 1; i <= 3; i++) {
    const next = chunk(i);
    const total = bars([...plan, ...middle, ...next, ...headOut, outroPlan]) * barSec;
    if (total > target + 30) break;
    middle.push(...next);
  }
  if (bars([...plan, ...middle, ...headOut, outroPlan]) * barSec > target + 40) tail = [headOut[1]];
  const all = [...plan, ...middle, ...tail, outroPlan];

  // Melody: one motif per piece, a derived one for the bridge.
  const mrng = rngFor(seed, 'motif', index);
  const motif = makeMotif(mrng, style, beats, params.complexity);
  const bMotif = contrastMotif(motif, mrng, style, beats);
  const melSeed = rngFor(seed, 'melseed', index).int(0, 1e9);
  const sections: Section[] = [];
  const melody: MelNote[][] = [];
  const sectionOf: number[] = [];
  const barInSection: number[] = [];
  all.forEach((p, si) => {
    const n = p.block.base.length;
    const inst = p.inst;
    let notes: MelNote[][] = Array.from({ length: n }, () => []);
    if (p.melody !== 'none' && inst) {
      const r = MELODY_RANGE[inst]!;
      const ctx: MelodyCtx = { key, beats, style, lo: r.lo, hi: r.hi, center: r.center };
      notes = composeSection(
        {
          mode: p.melody,
          motif: p.kind === 'B' ? bMotif : motif,
          harmony: p.block.base,
          seed: p.melody === 'improv' || p.melody === 'sparse' ? hashLabel(melSeed, p.label) : melSeed + (p.kind === 'B' ? 7 : 0),
          complexity: params.complexity,
          lift: p.lift,
          endClosed: p.closed,
        },
        ctx,
      );
    }
    if (p.kind === 'outro' && inst) {
      // The tune's last word: a long chord tone over the final chord.
      const r = MELODY_RANGE[inst]!;
      const tones = chordTones(fin);
      const pc = rng.pick([tones[0], tones[1], mod12(fin.root + (fin.q.includes('9') || fin.q === 'add9' ? 2 : 7))]);
      notes[n - 1] = [{ t: 0.5, d: beats * 2 - 0.5, midi: Math.min(r.hi, Math.max(r.lo, nearestPc(pc, r.center))), vel: 0.5, pri: 0 }];
    }
    sections.push({
      kind: p.kind,
      label: p.label,
      bars: n,
      harmony: p.block,
      melody: p.kind === 'outro' ? 'sparse' : p.melody,
      melodyInst: inst,
      intensity: p.intensity,
      roles: ROLE_LEVELS[p.levels],
      final: p.kind === 'outro',
    });
    for (let b = 0; b < n; b++) {
      melody.push(notes[b] ?? []);
      sectionOf.push(si);
      barInSection.push(b);
    }
  });

  return { index, seed, arr: { ...arr, style }, key, beats, tempo, energyAtPlan: params.energy, sections, melody, sectionOf, barInSection, totalBars: melody.length };
}

function hashLabel(seed: number, label: string) {
  return rngFor(seed, label).int(0, 1e9);
}
