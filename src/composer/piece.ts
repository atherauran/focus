import { ARRANGEMENTS, Arrangement, Form, MELODY_RANGE } from './arrangements';
import { Groove, pickGroove } from './grooves';
import { closingCadence, finalChord, parseProgression, pickTemplate, variants } from './harmony';
import { MelNote, MelodyCtx, composeSection, contrastMotif, makeMotif } from './melody';
import { Rng, rngFor } from './rng';
import { Chord, Key, ModeName, chordTones, mod12, nearestPc } from './theory';
import type { BarHarmony, Inst, Language, MelodyMode, Params, Role, Section, SectionKind } from './types';

export interface Piece {
  index: number;
  seed: number;
  arr: Arrangement;
  key: Key;
  beats: number;
  tempo: number;
  form: Form;
  swing: number; // where the off-beat falls (0.5 straight)
  swingUnit: 0.5 | 0.25;
  groove: Groove | null; // the recorded drummer, for kits that use one
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

const styleOf = (id: string | undefined) => ARRANGEMENTS.find((a) => a.id === id)?.style;

function chooseArrangement(rng: Rng, p: Params, history: History): Arrangement {
  const recent = history.arrangements.slice(-4);
  const lastStyle = styleOf(recent[recent.length - 1]);
  const items = ARRANGEMENTS.map((a) => {
    const h = a.home;
    const d = Math.hypot((p.energy - h.energy) * 1.6, (p.space - h.space) * 1.0, (p.complexity - h.complexity) * 0.9, (p.mood - h.mood) * 0.35);
    let w = Math.exp((-d * d) / 0.06) + 0.002;
    const ago = recent.length - recent.lastIndexOf(a.id);
    if (recent.includes(a.id)) w *= ago === 1 ? 0 : ago === 2 ? 0.15 : 0.45;
    // Move between genres rather than staying in one for long.
    if (a.style === lastStyle) w *= 0.35;
    return [a, w] as const;
  });
  return rng.weighted(items);
}

function chooseMode(rng: Rng, mood: number, arr: Arrangement): ModeName {
  const m = mood;
  const w: [ModeName, number][] = [
    ['minor', Math.pow(1 - m, 2) * 1.2],
    ['dorian', Math.max(0, 0.55 - Math.abs(m - 0.4)) * (arr.lang === 'folk' ? 0.4 : arr.lang === 'cinematic' ? 0.5 : 1)],
    ['major', Math.pow(m, 1.6)],
    ['lydian', arr.lang === 'ambient' || arr.lang === 'lofi' || arr.lang === 'beats' ? Math.max(0, m - 0.55) * 0.9 : arr.lang === 'cinematic' ? Math.max(0, m - 0.55) * 0.5 : 0],
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
  // arc and loop forms
  quiet: { comp: 1, pad: 0.35, texture: 0.3 },
  interlude: { comp: 1, pad: 0.8, bass: 0.6, texture: 0.7, drums: 0.4 },
  climax: { melody: 1, comp: 1, bass: 1, pad: 1, texture: 0.8, drums: 1, counter: 0.6 },
  loop: { comp: 1, bass: 1, pad: 0.7, texture: 0.5, drums: 0.9 },
  hook: { melody: 1, comp: 1, bass: 1, pad: 0.7, texture: 0.6, drums: 1, counter: 0.5 },
  drop: { melody: 1, comp: 1, pad: 1, texture: 0.8, bass: 0.4, drums: 0 },
};

type Plan = { kind: SectionKind; label: string; block: Block; melody: MelodyMode; inst: Inst | null; intensity: number; levels: string; lift: number; closed: boolean };

const P = (kind: SectionKind, label: string, block: Block, melody: MelodyMode, inst: Inst | null, intensity: number, levels: string, lift = 0, closed = false): Plan =>
  ({ kind, label, block, melody, inst, intensity, levels, lift, closed });

interface FormCtx {
  rng: Rng;
  key: Key;
  beats: number;
  lang: Language;
  style: string;
  mel: Inst[];
  fin: Chord;
  barSec: number;
  target: number;
  mk: (bars: BarHarmony[], tag: string) => Block;
}

const barsOf = (ps: Plan[]) => ps.reduce((n, p) => n + p.block.base.length, 0);

/** Fill the middle with chunks while the piece stays near its target length. */
function fill(c: FormCtx, head: Plan[], tail: Plan[], chunk: (i: number) => Plan[], max = 4): Plan[] {
  const middle: Plan[] = [];
  for (let i = 1; i <= max; i++) {
    const next = chunk(i);
    if (barsOf([...head, ...middle, ...next, ...tail]) * c.barSec > c.target + 30) break;
    middle.push(...next);
  }
  return [...head, ...middle, ...tail];
}

function closingOutro(c: FormCtx): Block {
  const bars = closingCadence(c.rng, c.lang, c.key, c.beats);
  bars[1] = [{ start: 0, dur: c.beats, chord: c.fin }];
  const outro = c.mk(bars, 'out');
  outro.rich[1] = outro.base[1];
  outro.simple[1] = outro.base[1];
  return outro;
}

/** A tune: a head (A A B A), choruses (solos or breaks), a head out and a tagged ending. */
function songForm(c: FormCtx): Plan[] {
  const { rng, key, beats, lang, style, mk, mel } = c;
  const tplA = pickTemplate(rng, lang, key, 'A');
  const tplB = pickTemplate(rng, lang, key, 'B');
  const aOpen = parseProgression(tplA, key, beats);
  const cadence = closingCadence(rng, lang, key, beats);
  const aClosed = [...aOpen.slice(0, 6), ...cadence];
  const bProg = parseProgression(tplB, key, beats);
  const A = mk(aOpen, 'A');
  const Ac = mk(aClosed, 'Ac');
  const Bb = mk(bProg, 'B');
  const vamp = rng.chance(0.5);
  const intro: Block = lang === 'ambient' || lang === 'folk' || style === 'ballad' || vamp
    ? concat(slice(A, 0, 2), slice(A, 0, 2))
    : slice(A, 4, 8);
  const outro = closingOutro(c);
  const second = mel[1] ?? mel[0];
  const head: Plan[] = [
    P('intro', 'intro', intro, 'none', null, 0.3, 'intro'),
    P('A', 'A1', A, 'theme', mel[0], 0.45, 'A1'),
    P('A', 'A2', Ac, 'themeVar', mel[0], 0.55, 'A2', 0, true),
    P('B', 'B', Bb, 'contrast', rng.chance(0.4) ? second : mel[0], 0.68, 'B', 3),
    P('A', 'A3', Ac, 'theme', mel[0], 0.6, 'A3', 0, true),
  ];
  const outroPlan = P('outro', 'outro', outro, 'none', mel[0], 0.35, 'outro', 0, true);
  const headOut: Plan[] = [
    P('B', 'B-out', Bb, 'themeVar', mel[0], 0.7, 'B', 3),
    P('A', 'A-out', Ac, 'theme', mel[0], 0.62, 'A3', 0, true),
  ];
  const improvises = style === 'jazz' || style === 'waltz' || style === 'bossa';
  const chunk = (i: number): Plan[] => {
    if (improvises) {
      return [
        P('solo', `S${i}a`, A, 'improv', second, 0.75, 'solo', 2),
        P('solo', `S${i}b`, Ac, 'improv', second, 0.82, 'solo', 2, true),
      ];
    }
    if (style === 'lofi') {
      return [
        P('break', `Br${i}`, A, 'sparse', second, 0.4, 'break'),
        P('solo', `S${i}`, Ac, 'improv', second, 0.7, 'solo', 2, true),
      ];
    }
    return [
      P('break', `I${i}`, A, 'sparse', second, 0.4, 'break', -2),
      P('B', `B${i}`, Bb, 'themeVar', mel[0], 0.6, 'B', 3),
      P('A', `A${i}`, Ac, 'themeVar', mel[0], 0.55, 'A3', 0, true),
    ];
  };
  const all = fill(c, head, [...headOut, outroPlan], chunk);
  if (barsOf(all) * c.barSec > c.target + 40) all.splice(all.length - 3, 1); // drop the B of the head out
  return all;
}

/** A beat tape: one four-bar loop throughout, a hook, a beat switch on a second loop, a drop. */
function loopForm(c: FormCtx): Plan[] {
  const { rng, key, beats, mk, mel } = c;
  const loopA = pickTemplate(rng, 'beats', key, 'A');
  const loopB = pickTemplate(rng, 'beats', key, 'B');
  const A4 = mk(parseProgression(loopA, key, beats), 'LA');
  const B4 = mk(parseProgression(loopB, key, beats), 'LB');
  const A8 = concat(A4, A4);
  const B8 = concat(B4, B4);
  const lead = mel[0];
  const alt = mel[1] ?? mel[0];
  const outroBars = [...parseProgression(loopA, key, beats).slice(0, 3), [{ start: 0, dur: beats, chord: c.fin }]];
  const outro = mk(outroBars, 'out');
  outro.rich[3] = outro.base[3];
  outro.simple[3] = outro.base[3];
  const head: Plan[] = [
    P('intro', 'intro', A4, 'none', null, 0.3, 'intro'),
    P('A', 'L1', A8, 'none', null, 0.45, 'loop'),
    P('A', 'H1', A8, 'theme', lead, 0.55, 'hook'),
    P('A', 'H2', A8, 'themeVar', lead, 0.6, 'hook'),
    P('B', 'switch', B8, 'contrast', alt, 0.62, 'B', 3),
  ];
  const tail: Plan[] = [
    P('break', 'drop', A4, 'sparse', alt, 0.4, 'drop'),
    P('A', 'H-out', A8, 'theme', lead, 0.65, 'hook'),
    P('outro', 'outro', outro, 'none', lead, 0.35, 'outro'),
  ];
  return fill(c, head, tail, (i) => [
    P('solo', `S${i}`, A8, 'improv', alt, 0.6, 'solo', 2),
    P('B', `switch${i}`, B8, 'sparse', lead, 0.55, 'B'),
  ], 2);
}

/** Cinematic: an ostinato that a theme grows over, a bridge, interludes, a climax and a quiet close. */
function arcForm(c: FormCtx): Plan[] {
  const { rng, key, beats, lang, mk, mel } = c;
  const aOpen = parseProgression(pickTemplate(rng, lang, key, 'A'), key, beats);
  const bProg = parseProgression(pickTemplate(rng, lang, key, 'B'), key, beats);
  const aClosed = [...aOpen.slice(0, 6), ...closingCadence(rng, lang, key, beats)];
  const A = mk(aOpen, 'A');
  const Ac = mk(aClosed, 'Ac');
  const Bb = mk(bProg, 'B');
  const solo = mel[1] ?? mel[0];
  const head: Plan[] = [
    P('intro', 'intro', slice(A, 0, 4), 'none', null, 0.25, 'quiet'),
    P('A', 'A1', A, 'theme', mel[0], 0.4, 'A1'),
    P('A', 'A2', Ac, 'themeVar', mel[0], 0.5, 'A2', 0, true),
    P('B', 'B', Bb, 'contrast', solo, 0.65, 'B', 3),
  ];
  const tail: Plan[] = [
    P('A', 'A-out', Ac, 'theme', mel[0], 0.8, 'climax', 5, true),
    P('outro', 'outro', closingOutro(c), 'none', mel[0], 0.3, 'quiet', 0, true),
  ];
  return fill(c, head, tail, (i) => [
    P('break', `I${i}`, slice(A, 0, 4), 'none', null, 0.45, 'interlude'),
    P('B', `B${i}`, Bb, 'themeVar', solo, 0.7 + i * 0.04, 'climax', 5),
  ]);
}

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

  const form = arr.form ?? 'song';
  const c: FormCtx = {
    rng, key, beats, lang, style, mel: arr.melody, fin: finalChord(rng, key, lang),
    barSec: (beats * 60) / tempo,
    target: form === 'loop' ? rng.range(170, 230) : rng.range(190, 280),
    mk: (bars, tag) => variants(bars, rngFor(seed, 'rich', index, tag), lang, key, beats),
  };
  const all = form === 'loop' ? loopForm(c) : form === 'arc' ? arcForm(c) : songForm(c);
  const fin = c.fin;
  // Play with the recorded drummer's feel: the band swings as much as they do.
  const groove = arr.drums === 'lofi' ? pickGroove(rngFor(seed, 'groove', index), tempo) : null;
  const swingUnit = groove ? groove.unit : arr.swingUnit;
  const swing = groove ? Math.min(0.66, Math.max(0.5, groove.swing > 0.53 ? groove.swing : 0.5 + (arr.swing - 0.5) * 0.4)) : arr.swing;

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

  return {
    index, seed, arr: { ...arr, style }, key, beats, tempo, form, swing, swingUnit, groove,
    sections, melody, sectionOf, barInSection, totalBars: melody.length,
  };
}

function hashLabel(seed: number, label: string) {
  return rngFor(seed, label).int(0, 1e9);
}
