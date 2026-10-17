import { Rng, rngFor } from './rng';
import { Key, chordScale, chordTones, mod12, nearestPc, stableTones } from './theory';
import type { BarHarmony, Style } from './types';

/** A melody note inside a bar. pri: 0 structural, 1 secondary, 2 ornamental (dropped first). */
export interface MelNote {
  t: number;
  d: number;
  midi: number;
  vel: number;
  pri: 0 | 1 | 2;
}

type Cell = [number, number][]; // [onset, duration] in beats

/* Idiomatic one-bar rhythm figures. Rests are the gaps between notes. */
const RHYTHMS: Record<string, { motif: Cell[]; busy: Cell[]; cadence: Cell[] }> = {
  swing4: {
    motif: [
      [[0, 1.5], [1.5, 0.5], [2, 2]],
      [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 1.5]],
      [[0, 0.5], [0.5, 0.5], [1, 1], [2.5, 0.5], [3, 1]],
      [[1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
      [[0, 1], [1, 1], [2, 2]],
      [[0.5, 1], [1.5, 0.5], [2, 1.5]],
      [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 2]],
      [[0, 2.5], [2.5, 0.5], [3, 1]],
    ],
    busy: [
      [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
      [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]],
      [[0, 1 / 3], [1 / 3, 1 / 3], [2 / 3, 1 / 3], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]],
      [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]],
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
    ],
    cadence: [[[0, 2.5]], [[0, 3]], [[-0.5, 2.5]], [[0, 1], [1, 2]], [[0, 0.5], [0.5, 2]]],
  },
  lofi4: {
    motif: [
      [[0, 0.75], [0.75, 0.25], [1, 1], [2, 0.5], [2.5, 1.5]],
      [[0.5, 0.5], [1, 1], [2, 0.75], [2.75, 1.25]],
      [[0, 1.5], [1.5, 0.5], [2, 2]],
      [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 1.5]],
      [[1, 0.5], [1.5, 0.75], [2.25, 1.75]],
      [[0, 0.25], [0.25, 0.75], [1, 1], [2.5, 1.5]],
      [[0, 2], [2.5, 0.5], [3, 1]],
    ],
    busy: [
      [[0, 0.5], [0.5, 0.25], [0.75, 0.25], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]],
      [[0, 0.75], [0.75, 0.25], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
      [[0.5, 0.5], [1, 0.25], [1.25, 0.25], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
    ],
    cadence: [[[0, 2.5]], [[0, 3]], [[-0.25, 2.75]], [[0, 0.75], [0.75, 2.25]]],
  },
  ballad4: {
    motif: [
      [[0, 2], [2, 1], [3, 1]],
      [[0, 2.5], [3, 1]],
      [[0, 1], [1, 2.5]],
      [[1, 1], [2, 2]],
      [[0, 1.5], [1.5, 2]],
      [[0, 2], [2.5, 1.5]],
      [[0, 1.5], [1.5, 0.5], [2, 2]],
    ],
    busy: [
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]],
      [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5], [3.5, 0.5]],
      [[0, 1.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
    ],
    cadence: [[[0, 4]], [[0, 3]], [[0, 1], [1, 3]]],
  },
  straight4: {
    motif: [
      [[0, 1.5], [1.5, 1], [2.5, 1.5]],
      [[0.5, 1], [1.5, 1], [2.5, 1.5]],
      [[0, 0.5], [0.5, 1], [1.5, 1.5], [3, 1]],
      [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5]],
      [[0, 2], [2, 1], [3, 1]],
      [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]],
    ],
    busy: [
      [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
      [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
    ],
    cadence: [[[0, 3]], [[0, 2.5]], [[-0.5, 3]], [[0, 1], [1, 2]]],
  },
  waltz3: {
    motif: [
      [[0, 2], [2, 1]],
      [[0, 1], [1, 1], [2, 1]],
      [[0, 1.5], [1.5, 0.5], [2, 1]],
      [[1, 1], [2, 1]],
      [[0, 0.5], [0.5, 0.5], [1, 2]],
      [[0, 3]],
    ],
    busy: [
      [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1]],
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1]],
    ],
    cadence: [[[0, 3]], [[0, 2]], [[0, 1], [1, 2]]],
  },
};

export function rhythmBank(style: Style, beats: number) {
  if (beats === 3) return RHYTHMS.waltz3;
  if (style === 'lofi') return RHYTHMS.lofi4;
  if (style === 'ballad' || style === 'ambient') return RHYTHMS.ballad4;
  if (style === 'bossa' || style === 'folk') return RHYTHMS.straight4;
  return RHYTHMS.swing4;
}

export interface Motif {
  rhythm: Cell;
  answer: Cell; // second bar of the basic idea
  steps: number[]; // scale-step motion between notes, for rhythm + answer + continuation
  start: number; // chord-tone index to start on (0 root, 1 third, 2 fifth)
  pickup: boolean;
}

function contour(rng: Rng, n: number, complexity: number): number[] {
  const shape = rng.pick(['arch', 'rise', 'fall', 'wave'] as const);
  const steps: number[] = [];
  let lastLeap = 0;
  for (let i = 0; i < n; i++) {
    const pos = i / Math.max(1, n - 1);
    let dir = shape === 'arch' ? (pos < 0.5 ? 1 : -1) : shape === 'rise' ? 1 : shape === 'fall' ? -1 : i % 3 === 2 ? -1 : 1;
    if (rng.chance(0.25)) dir = -dir;
    if (lastLeap) {
      // Recover from a leap by step in the opposite direction.
      steps.push(-Math.sign(lastLeap));
      lastLeap = 0;
      continue;
    }
    const kind = rng.weighted([
      ['step', 0.55],
      ['skip', 0.22],
      ['repeat', 0.05],
      ['leap', 0.06 + complexity * 0.1],
    ] as const);
    const mag = kind === 'step' ? 1 : kind === 'skip' ? 2 : kind === 'repeat' ? 0 : rng.int(3, 4);
    if (kind === 'leap') lastLeap = dir * mag;
    steps.push(dir * mag);
  }
  return steps;
}

export function makeMotif(rng: Rng, style: Style, beats: number, complexity: number): Motif {
  const bank = rhythmBank(style, beats);
  const rhythm = rng.pick(bank.motif);
  // The answer usually keeps the rhythm (so the idea is recognizable) or varies its ending.
  let answer = rhythm;
  if (rng.chance(0.45)) {
    const other = rng.pick(bank.motif);
    const cut = Math.ceil(rhythm.length / 2);
    const head = rhythm.slice(0, cut);
    const end = head.length ? head[head.length - 1][0] + head[head.length - 1][1] : 0;
    const tail = other.filter(([t]) => t >= end);
    answer = tail.length ? [...head, ...tail] : rhythm;
  }
  return {
    rhythm,
    answer,
    steps: contour(rng, 24, complexity),
    start: rng.weighted([[1, 0.45], [2, 0.35], [0, 0.2]] as const),
    pickup: rng.chance(style === 'ambient' ? 0.15 : 0.4),
  };
}

/** Derive a contrasting motif for a B section: inverted contour, new rhythm. */
export function contrastMotif(m: Motif, rng: Rng, style: Style, beats: number): Motif {
  const bank = rhythmBank(style, beats);
  const rhythm = rng.pick(bank.motif.filter((r) => r !== m.rhythm));
  return { rhythm, answer: rng.chance(0.6) ? rhythm : rng.pick(bank.motif), steps: m.steps.map((s) => -s), start: (m.start + 1) % 3, pickup: !m.pickup };
}

export interface MelodyCtx {
  key: Key;
  beats: number;
  style: Style;
  lo: number;
  hi: number;
  center: number;
}

const chordAt = (bar: BarHarmony, t: number) => {
  let c = bar[0].chord;
  for (const s of bar) if (t >= s.start - 1e-6) c = s.chord;
  return c;
};

/** Move by scale steps inside the chord-scale of `chord`. */
function stepIn(pitch: number, steps: number, scale: number[]): number {
  let p = pitch;
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    do p += dir;
    while (!scale.includes(mod12(p)));
  }
  if (steps === 0 && !scale.includes(mod12(p))) {
    // Repeated note that's out of the new chord-scale: nudge to nearest scale tone.
    let up = p, dn = p;
    while (!scale.includes(mod12(up))) up++;
    while (!scale.includes(mod12(dn))) dn--;
    p = up - p <= p - dn ? up : dn;
  }
  return p;
}

function snap(pitch: number, tones: number[], prefer: number): number {
  let best = pitch;
  let bestD = Infinity;
  for (const pc of tones) {
    for (const cand of [nearestPc(pc, pitch), nearestPc(pc, pitch) + 12, nearestPc(pc, pitch) - 12]) {
      const d = Math.abs(cand - pitch) + (Math.sign(cand - pitch) === -Math.sign(prefer) && cand !== pitch ? 0.5 : 0);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
  }
  return best;
}

function fitRange(p: number, lo: number, hi: number) {
  while (p > hi) p -= 12;
  while (p < lo) p += 12;
  return p;
}

interface PhrasePlan {
  bars: BarHarmony[];
  rhythms: Cell[]; // one per bar
  goal: 'open' | 'closed';
  register: number;
}

/**
 * Realize a phrase: walk the motif's contour through each bar's chord-scale, snapping strong
 * beats and long notes to stable tones, and land the last note on a cadential goal.
 */
function realize(plan: PhrasePlan, steps: number[], start: number, ctx: MelodyCtx, prevPitch: number | null): MelNote[][] {
  const out: MelNote[][] = plan.bars.map(() => []);
  let p: number | null = prevPitch;
  let si = 0;
  const total = plan.rhythms.reduce((a, r) => a + r.length, 0);
  let k = 0;
  plan.bars.forEach((bar, b) => {
    for (const [t, d] of plan.rhythms[b]) {
      const chord = chordAt(bar, Math.max(0, t));
      const scale = chordScale(chord, ctx.key);
      const stable = stableTones(chord, ctx.key);
      const last = k === total - 1;
      let pitch: number;
      if (p === null || k === 0) {
        const ct = chordTones(chord);
        const pc = ct[Math.min(start, ct.length - 1)];
        pitch = fitRange(nearestPc(pc, plan.register), ctx.lo, ctx.hi);
      } else {
        const s = steps[si++ % steps.length];
        pitch = stepIn(p, s, scale);
        if (pitch > ctx.hi || pitch < ctx.lo) pitch = stepIn(p, -s, scale);
        // Gently pull toward the phrase's register so lines don't drift away.
        if (Math.abs(pitch - plan.register) > 9) pitch = stepIn(p, -Math.sign(pitch - plan.register), scale);
        const strong = (Math.abs(t % (ctx.beats === 3 ? 3 : 2)) < 1e-6) || d >= 1;
        if (strong) pitch = snap(pitch, stable, s);
        if (pitch === p && s !== 0) {
          // Snapping collapsed a step into a repeat: carry on to the next stable tone instead.
          const dir = Math.sign(s) || 1;
          let q = p + dir;
          while (!(strong ? stable : scale).includes(mod12(q))) q += dir;
          pitch = q > ctx.hi || q < ctx.lo ? stepIn(p, -dir, scale) : q;
        }
      }
      if (last) {
        const tonic = ctx.key.tonic;
        const goals = plan.goal === 'closed' ? [tonic, mod12(tonic + (ctx.key.mode === 'minor' || ctx.key.mode === 'dorian' ? 3 : 4))] : chordTones(chord);
        const usable = goals.filter((g) => stable.includes(g));
        pitch = snap(pitch, usable.length ? usable : stable, 0);
      }
      pitch = fitRange(pitch, ctx.lo, ctx.hi);
      const beatPos = t - Math.floor(t);
      const pri: 0 | 1 | 2 = k === 0 || d >= 1 || last || t === 0 ? 0 : beatPos === 0 ? 1 : 2;
      const accent = t === 0 ? 0.06 : beatPos === 0 ? 0.02 : -0.03;
      const height = (pitch - ctx.center) * 0.006;
      out[b].push({ t, d, midi: pitch, vel: 0.62 + accent + height, pri });
      p = pitch;
      k++;
    }
  });
  return out;
}

/** Shift notes with negative onsets (anticipations) into the previous bar. */
function settle(bars: MelNote[][], beats: number): MelNote[][] {
  const out = bars.map((b) => b.filter((n) => n.t >= 0));
  bars.forEach((b, i) => {
    for (const n of b) {
      if (n.t >= 0 || i === 0) continue;
      const t = n.t + beats;
      // An anticipation replaces whatever the previous bar had at that point.
      out[i - 1] = out[i - 1].filter((x) => x.t < t - 0.01);
      out[i - 1].push({ ...n, t });
    }
  });
  // Trim overlaps so each note ends before the next begins.
  const flat: { bar: number; n: MelNote }[] = [];
  out.forEach((b, i) => b.sort((x, y) => x.t - y.t).forEach((n) => flat.push({ bar: i, n })));
  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i], c = flat[i + 1];
    const gap = (c.bar - a.bar) * beats + c.n.t - a.n.t;
    if (a.n.d > gap - 0.02) a.n.d = Math.max(0.1, gap - 0.02);
  }
  return out;
}

export interface SectionMelodyOpts {
  mode: 'theme' | 'themeVar' | 'contrast' | 'improv' | 'sparse';
  motif: Motif;
  harmony: BarHarmony[];
  seed: number;
  complexity: number;
  lift: number; // register lift in semitones (B sections and climaxes sit higher)
  endClosed: boolean;
}

/** Compose a whole section's melody, phrase by phrase (phrases are 4 bars, or 2 in 3/4 at speed). */
export function composeSection(o: SectionMelodyOpts, ctx: MelodyCtx): MelNote[][] {
  const bank = rhythmBank(ctx.style, ctx.beats);
  const bars: MelNote[][] = [];
  const phraseLen = 4;
  let prev: number | null = null;
  for (let p0 = 0; p0 < o.harmony.length; p0 += phraseLen) {
    const ph = Math.floor(p0 / phraseLen);
    const n = Math.min(phraseLen, o.harmony.length - p0);
    const isLast = p0 + n >= o.harmony.length;
    // Theme repeats keep phrase-level choices; variations reseed only the later bars.
    const r1 = rngFor(o.seed, 'phrase', o.mode === 'themeVar' || o.mode === 'contrast' ? 'theme' : o.mode, ph % 2);
    const r2 = rngFor(o.seed, 'cont', o.mode, ph);
    const m = o.motif;
    const rhythms: Cell[] = [];
    for (let b = 0; b < n; b++) {
      const lastBar = b === n - 1;
      if (o.mode === 'sparse') {
        rhythms.push(b % 2 === 0 ? r2.pick(bank.motif.filter((r) => r.length <= 3)) : lastBar ? r2.pick(bank.cadence) : []);
      } else if (o.mode === 'improv') {
        if (b === 0) rhythms.push(m.rhythm);
        else if (lastBar && n === 4) rhythms.push(r2.pick(bank.cadence));
        else rhythms.push(r2.chance(0.3 + o.complexity * 0.5) ? r2.pick(bank.busy) : r2.pick(bank.motif));
      } else if (b === 0) rhythms.push(m.rhythm);
      else if (b === 1) rhythms.push(ph % 2 === 1 && r1.chance(0.5) ? m.rhythm : m.answer);
      else if (lastBar && n >= 3) rhythms.push(r2.pick(bank.cadence));
      else {
        // Continuation: fragment of the motif or a busier figure.
        const frag = m.rhythm.filter(([t]) => t < (ctx.beats === 3 ? 1.5 : 2));
        const fragTwice: Cell = [...frag, ...frag.map(([t, d]) => [t + (ctx.beats === 3 ? 1.5 : 2), d] as [number, number])];
        rhythms.push(r2.chance(0.45) && fragTwice.length >= 2 ? fragTwice : r2.chance(0.4 + o.complexity * 0.3) ? r2.pick(bank.busy) : r2.pick(bank.motif));
      }
    }
    // Rests are part of the melody: breathe at the end of the idea and its answer,
    // and now and then leave half a bar empty.
    const breathe = (cell: Cell, room: number): Cell => {
      if (!cell.length) return cell;
      const [t, d] = cell[cell.length - 1];
      const end = Math.min(t + d, ctx.beats - room);
      if (end - t >= 0.5) return [...cell.slice(0, -1), [t, end - t]];
      return cell.length > 1 ? breathe(cell.slice(0, -1), room) : cell;
    };
    if (o.mode !== 'sparse') {
      if (r2.chance(0.45)) rhythms[0] = breathe(rhythms[0], 0.5);
      if (n > 1 && r1.chance(0.7)) rhythms[1] = breathe(rhythms[1], o.mode === 'improv' ? 0.5 : 1);
      if (n === 4 && o.mode !== 'improv' && r2.chance(0.2)) rhythms[2] = rhythms[2].filter(([t]) => t >= 2);
    }
    const steps = o.mode === 'improv' ? contour(r2, 32, o.complexity) : o.mode === 'themeVar' && ph % 2 === 1 ? [...m.steps.slice(0, 6), ...contour(r2, 16, o.complexity)] : m.steps;
    const register = ctx.center + o.lift + (ph % 2 === 1 ? 2 : 0) + (o.mode === 'improv' ? 2 : 0);
    const goal: 'open' | 'closed' = isLast ? (o.endClosed ? 'closed' : 'open') : ph % 2 === 1 ? 'closed' : 'open';
    const realized = realize({ bars: o.harmony.slice(p0, p0 + n), rhythms, goal, register }, steps, m.start, ctx, prev);
    // Pickup into the phrase, in the empty tail of the previous bar.
    if (m.pickup && bars.length && o.mode !== 'sparse') {
      const prevBar = bars[bars.length - 1];
      const lastEnd = prevBar.length ? Math.max(...prevBar.map((x) => x.t + x.d)) : 0;
      const first = realized[0][0];
      if (first && first.t === 0 && lastEnd <= ctx.beats - 1.1) {
        const scale = chordScale(chordAt(o.harmony[p0 - 1], ctx.beats - 1), ctx.key);
        const a = stepIn(first.midi, -2, scale);
        const b = stepIn(first.midi, -1, scale);
        prevBar.push({ t: ctx.beats - 1, d: 0.5, midi: a, vel: 0.5, pri: 1 }, { t: ctx.beats - 0.5, d: 0.5, midi: b, vel: 0.55, pri: 1 });
      }
    }
    bars.push(...realized);
    const lastBar = realized[realized.length - 1];
    const lastNote = lastBar[lastBar.length - 1];
    prev = lastNote ? lastNote.midi : prev;
  }
  return unrepeat(settle(bars, ctx.beats), o.harmony, ctx);
}

/** Repeated pitches back to back (without a rest between) usually come from snapping: step away. */
function unrepeat(bars: MelNote[][], harmony: BarHarmony[], ctx: MelodyCtx): MelNote[][] {
  const flat: { b: number; n: MelNote }[] = [];
  bars.forEach((bar, b) => bar.forEach((n) => flat.push({ b, n })));
  for (let i = 1; i < flat.length; i++) {
    const a = flat[i - 1], c = flat[i];
    const gap = (c.b - a.b) * ctx.beats + c.n.t - (a.n.t + a.n.d);
    if (c.n.midi !== a.n.midi || gap > 0.75) continue;
    const next = flat[i + 1]?.n.midi ?? c.n.midi;
    const dir = next > c.n.midi ? 1 : next < c.n.midi ? -1 : c.n.midi > ctx.center ? -1 : 1;
    const chord = chordAt(harmony[c.b], c.n.t);
    const pool = c.n.d >= 1 || c.n.t % 2 === 0 ? stableTones(chord, ctx.key) : chordScale(chord, ctx.key);
    let q = c.n.midi + dir;
    while (!pool.includes(mod12(q))) q += dir;
    if (q <= ctx.hi && q >= ctx.lo && q !== next) c.n.midi = q;
  }
  return bars;
}

/** Live shaping: keep structural notes, thin the rest by density, fix clashes with the live chord. */
export function shapeBar(
  notes: MelNote[],
  density: number,
  harmony: BarHarmony,
  key: Key,
  complexity: number,
  rng: Rng,
): MelNote[] {
  const kept: MelNote[] = [];
  for (const n of notes) {
    const keep = n.pri === 0 || (n.pri === 1 && density > 0.22) || (n.pri === 2 && density > 0.5);
    if (keep) kept.push({ ...n });
    else if (kept.length) {
      // Let the previous note sustain over a dropped passing note.
      const prev = kept[kept.length - 1];
      if (Math.abs(prev.t + prev.d - n.t) < 0.1) prev.d = n.t + n.d - prev.t;
    }
  }
  const out: MelNote[] = [];
  for (const n of kept) {
    const chord = chordAt(harmony, n.t);
    const stable = stableTones(chord, key);
    const strong = n.d >= 1 || n.t % 2 === 0;
    const pc = mod12(n.midi);
    const clash = chordTones(chord).some((t) => mod12(pc - t) === 1 || (mod12(t - pc) === 1 && strong));
    if ((strong && !stable.includes(pc)) || (clash && !stable.includes(pc))) n.midi = snap(n.midi, stable, 0);
    // A grace note into long structural notes when the music is intricate.
    if (n.pri === 0 && n.d >= 1 && n.t >= 0.25 && complexity > 0.55 && rng.chance((complexity - 0.5) * 0.5)) {
      const scale = chordScale(chord, key);
      const grace = rng.chance(0.65) ? n.midi - 1 : stepIn(n.midi, 1, scale);
      const before = out[out.length - 1];
      if (!before || before.midi !== grace) out.push({ t: n.t - 0.125, d: 0.125, midi: grace, vel: n.vel * 0.7, pri: 2 });
    }
    out.push(n);
  }
  return out;
}

export { chordAt };
