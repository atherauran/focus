import { Chord, Key, QUALITIES, chordFamily, mod12, pcAtOrAbove, tensions } from './theory';

export interface VoicingOpts {
  lo: number; // lowest allowed midi
  hi: number; // highest allowed midi
  size: number; // number of voices
  rootless: boolean; // bass player covers the root
  color: number; // 0..1, how many tensions to add
  spread?: boolean; // open (pad / ambient) rather than close/drop-2 shapes
  center?: number; // preferred register center
}

/** Pick pitch classes (as intervals above the root) for a voicing of `size` notes. */
export function voicingIntervals(c: Chord, key: Key, size: number, rootless: boolean, color: number): number[] {
  const def = QUALITIES[c.q];
  const core = def.core;
  const third = core.find((i) => i === 3 || i === 4 || i === 2 || i === 5)!;
  const seventh = core.find((i) => i === 9 || i === 10 || i === 11);
  const fifth = core.find((i) => i === 6 || i === 7 || i === 8);
  const ten = tensions(c, key);
  const out: number[] = [third];
  if (seventh !== undefined) out.push(seventh);
  for (const e of def.ext) if (!out.includes(e % 12) && out.length < size) out.push(e % 12);
  const nTensions = Math.round(color * 2.2);
  for (const t of ten) {
    if (out.length >= size || out.filter((x) => !core.includes(x)).length >= nTensions) break;
    if (!out.includes(t % 12)) out.push(t % 12);
  }
  // The diminished fifth / augmented fifth are part of the chord's identity.
  if (fifth !== undefined && fifth !== 7 && !out.includes(fifth)) out.push(fifth);
  if (!rootless && !out.includes(0)) out.push(0);
  if (fifth !== undefined && out.length < size && !out.includes(fifth)) out.push(fifth);
  if (out.length < size && !out.includes(0)) out.push(0);
  // Triads with few tones: double the root or fifth an octave up.
  let i = 0;
  const pool = [0, fifth ?? 7, third];
  while (out.length < size && i < 6) out.push(pool[i++ % pool.length] + 12);
  return out.slice(0, size);
}

function closeShapes(pcs: number[]): number[][] {
  const shapes: number[][] = [];
  for (let r = 0; r < pcs.length; r++) {
    const order = [...pcs.slice(r), ...pcs.slice(0, r)];
    const notes: number[] = [order[0]];
    for (let k = 1; k < order.length; k++) {
      notes.push(pcAtOrAbove(order[k], notes[k - 1] + 1));
    }
    shapes.push(notes);
  }
  return shapes;
}

function candidates(pcs: number[], spread: boolean): number[][] {
  const close = closeShapes(pcs);
  if (pcs.length < 4) {
    const out = [...close];
    // Open triad: middle voice up an octave.
    for (const s of close) if (s.length === 3) out.push([s[0], s[2], s[1] + 12].sort((a, b) => a - b));
    return out;
  }
  const out: number[][] = [];
  for (const s of close) {
    const d2 = [...s];
    d2[d2.length - 2] -= 12;
    d2.sort((a, b) => a - b);
    if (!spread) out.push(s, d2);
    else {
      const d24 = [...s];
      d24[d24.length - 2] -= 12;
      if (d24.length >= 4) d24[d24.length - 4] -= 12;
      d24.sort((a, b) => a - b);
      out.push(d2, d24);
    }
  }
  return out;
}

function movement(a: number[], b: number[]): number {
  // Greedy nearest matching, good enough for 3-6 voices.
  const pool = [...b];
  let cost = 0;
  for (const n of a) {
    let best = 0;
    for (let i = 1; i < pool.length; i++) if (Math.abs(pool[i] - n) < Math.abs(pool[best] - n)) best = i;
    if (pool.length === 0) break;
    cost += Math.abs(pool[best] - n);
    pool.splice(best, 1);
  }
  return cost + pool.length * 3;
}

function roughness(notes: number[], dominant: boolean): number {
  let p = 0;
  for (let i = 1; i < notes.length; i++) {
    const lo = notes[i - 1];
    const iv = notes[i] - lo;
    // Low interval limits: thirds get muddy below ~E3, seconds below ~A3.
    if (iv <= 2 && lo < 57) p += 6;
    if (iv <= 4 && lo < 50) p += 6;
    if (iv < 7 && lo < 43) p += 8;
  }
  for (let i = 0; i < notes.length; i++)
    for (let j = i + 1; j < notes.length; j++) {
      const iv = notes[j] - notes[i];
      if (iv % 12 === 1 && iv > 1 && !dominant) p += 5; // minor ninth
    }
  // Two top voices a half step apart sound like a mistake.
  const n = notes.length;
  if (n >= 2 && notes[n - 1] - notes[n - 2] === 1) p += 4;
  return p;
}

/** Choose a voicing that moves smoothly from `prev` and respects range and register. */
export function voice(c: Chord, key: Key, prev: number[] | null, o: VoicingOpts): number[] {
  const ivs = voicingIntervals(c, key, o.size, o.rootless, o.color);
  const pcs = ivs.map((i) => mod12(c.root + i));
  const uniq = [...new Set(pcs)];
  const shapes = candidates(uniq, !!o.spread);
  const center = o.center ?? (o.lo + o.hi) / 2;
  const dominant = chordFamily(c) === 'dom';
  let best: number[] = [];
  let bestCost = Infinity;
  for (const s of shapes) {
    for (let oct = -1; oct <= 8; oct++) {
      const notes = s.map((n) => n + oct * 12);
      if (notes[0] < o.lo || notes[notes.length - 1] > o.hi) continue;
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let cost = roughness(notes, dominant) + Math.abs(mean - center) * 0.35;
      if (prev && prev.length) cost += movement(notes, prev) * 0.5;
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  if (!best.length) {
    // Range too tight for the shape: stack upward from lo.
    best = [];
    let n = o.lo;
    for (const pc of uniq) {
      n = pcAtOrAbove(pc, n + 1);
      best.push(n);
    }
  }
  return best;
}

/** The bass note of a chord (slash bass if any). */
export const bassPc = (c: Chord) => c.bass ?? c.root;
