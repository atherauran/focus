import type { Arrangement } from './arrangements';
import { BASS_RANGE } from './arrangements';
import { chordAt } from './melody';
import type { Rng } from './rng';
import { Chord, Key, chordFamily, chordScale, chordTones, mod12, nearestPc, stableTones } from './theory';
import type { BarHarmony, DrumHit, Inst, NoteEvent, Params, Role, SectionKind } from './types';
import { bassPc, voice, voicingIntervals } from './voicing';

export interface PieceState {
  voicing: Partial<Record<string, number[]>>;
  bassLast: number | null;
  pushed: Partial<Record<Role, boolean>>;
  levels: Partial<Record<Role, number>>;
  habits: { comp: number[]; bass: number[]; kick: number[] };
}

export interface BarCtx {
  beats: number;
  key: Key;
  harmony: BarHarmony;
  prevChord: Chord | null; // last chord of the previous bar
  next: Chord; // first chord of the next bar
  params: Params;
  intensity: number;
  phrasePos: number; // 0..3 within a 4-bar phrase
  sectionKind: SectionKind;
  sectionBar: number;
  barIndex: number;
  final: boolean; // fermata bar: one long chord
  hold: (t: number) => number; // beats until the harmony changes after time t
  melodyLow: number | null;
  melodyEnd: number; // where the melody's last note in this bar ends (0 if none)
  hasBass: boolean;
  rng: Rng;
  state: PieceState;
  arr: Arrangement;
  level: number;
}

const ev = (inst: Inst, role: Role, time: number, dur: number, midi: number, vel: number, hit?: DrumHit): NoteEvent =>
  ({ inst, role, time, dur, midi, vel, hit });

const changesAt = (ctx: BarCtx, t: number) => {
  const s = ctx.harmony.find((x) => Math.abs(x.start - t) < 1e-6);
  if (!s) return null;
  const before = t === 0 ? ctx.prevChord : chordAt(ctx.harmony, t - 0.01);
  const c = s.chord;
  return before && before.root === c.root && before.q === c.q && before.bass === c.bass ? null : c;
};

function clampRange(p: number, lo: number, hi: number) {
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p;
}

/* ---------------------------------- bass ---------------------------------- */

function bassNear(pc: number, ctx: BarCtx, lo: number, hi: number, center: number) {
  const ref = ctx.state.bassLast ?? center;
  // Stay near the previous note but drift back toward the instrument's sweet spot.
  const target = ref * 0.7 + center * 0.3;
  return clampRange(nearestPc(pc, target), lo, hi);
}

function approach(target: number, prev: number, ctx: BarCtx, chord: Chord, lo: number, hi: number): number {
  const r = ctx.rng.next();
  let p: number;
  if (r < 0.45) p = target + (prev > target ? 1 : -1);
  else if (r < 0.65) p = target + (ctx.rng.chance(0.5) ? 7 : -5);
  else {
    const scale = chordScale(chord, ctx.key);
    p = prev > target ? target + 1 : target - 1;
    while (!scale.includes(mod12(p))) p += prev > target ? 1 : -1;
  }
  p = clampRange(p, lo, hi);
  return p === prev ? clampRange(target + (prev > target ? -1 : 1), lo, hi) : p;
}

export function bass(ctx: BarCtx): NoteEvent[] {
  const b = ctx.arr.bass!;
  const inst = b.inst;
  const R = BASS_RANGE[inst]!;
  const { lo, hi, center } = R;
  const out: NoteEvent[] = [];
  const B = ctx.beats;
  const e = ctx.params.energy;
  const push = (t: number, d: number, p: number, v: number) => {
    out.push(ev(inst, 'bass', t, d, p, v));
    ctx.state.bassLast = p;
  };

  if (ctx.final) {
    push(0, B * 2, bassNear(bassPc(ctx.harmony[0].chord), ctx, lo, hi, center - 3), 0.6);
    return out;
  }

  let mode = b.mode;
  const calm = e < 0.32 || ctx.sectionKind === 'intro' || ctx.sectionKind === 'outro';
  if (mode === 'walk' && (calm || (B === 3 && e < 0.55))) mode = 'two';
  if (mode === 'lofi' && e < 0.18) mode = 'pedal';

  switch (mode) {
    case 'walk': {
      let prev = ctx.state.bassLast ?? center;
      for (let beat = 0; beat < B; beat++) {
        const chord = chordAt(ctx.harmony, beat);
        const startHere = ctx.harmony.some((s) => s.start === beat);
        const nextChord = beat === B - 1 ? ctx.next : chordAt(ctx.harmony, beat + 1);
        const targetIsChange = beat === B - 1 || ctx.harmony.some((s) => s.start === beat + 1);
        let p: number;
        if (startHere) p = bassNear(bassPc(chord), ctx, lo, hi, center);
        else if (targetIsChange) {
          const target = clampRange(nearestPc(bassPc(nextChord), prev), lo, hi);
          p = approach(target, prev, ctx, chord, lo, hi);
        } else {
          const tones = [...chordTones(chord), ...stableTones(chord, ctx.key)];
          const goingUp = prev < center + ctx.rng.range(-4, 4);
          const cands = tones.map((pc) => clampRange(nearestPc(pc, prev + (goingUp ? 3 : -3)), lo, hi)).filter((x) => x !== prev);
          p = cands.sort((a, c) => Math.abs(a - prev - (goingUp ? 3 : -3)) - Math.abs(c - prev - (goingUp ? 3 : -3)))[0] ?? prev;
        }
        if (p === prev && beat > 0) p = clampRange(p + (p > center ? -2 : 2), lo, hi);
        push(beat, 0.92, p, beat === 0 ? 0.72 : 0.62 + ctx.rng.range(-0.04, 0.04));
        // The occasional skip note: a ghosted swung eighth into the next beat.
        if (beat < B - 1 && ctx.params.complexity > 0.45 && ctx.rng.chance((ctx.params.complexity - 0.4) * 0.25)) {
          out[out.length - 1].dur = 0.45;
          push(beat + 0.5, 0.4, p, 0.32);
        }
        prev = p;
      }
      break;
    }
    case 'two': {
      const p0 = bassNear(bassPc(chordAt(ctx.harmony, 0)), ctx, lo, hi, center);
      if (B === 3) {
        push(0, 2.8, p0, 0.66);
        break;
      }
      push(0, 1.85, p0, 0.68);
      const c2 = changesAt(ctx, 2);
      let p2: number;
      if (c2) p2 = bassNear(bassPc(c2), ctx, lo, hi, center);
      else if (ctx.rng.chance(0.35)) p2 = approach(clampRange(nearestPc(bassPc(ctx.next), p0), lo, hi), p0, ctx, ctx.harmony[0].chord, lo, hi);
      else p2 = clampRange(nearestPc(mod12(bassPc(chordAt(ctx.harmony, 2)) + 7), p0), lo, hi);
      if (ctx.params.complexity > 0.5 && ctx.rng.chance(0.25)) {
        push(1.5, 0.45, clampRange(p2 + (ctx.rng.chance(0.5) ? 1 : -1), lo, hi), 0.4);
      }
      push(2, 1.85, p2, 0.62);
      break;
    }
    case 'lofi': {
      const P: [number, number, string][][] = [
        [[0, 1.5, 'R'], [2.5, 0.5, 'R'], [3, 0.75, '5']],
        [[0, 2.5, 'R'], [3, 0.5, '5'], [3.5, 0.5, 'A']],
        [[0, 0.75, 'R'], [0.75, 1.75, 'R'], [3, 1, '3']],
        [[0, 3.5, 'R'], [3.5, 0.5, 'A']],
        [[0, 1, 'R'], [1.5, 1, '8'], [2.5, 1, '5'], [3.5, 0.5, 'A']],
      ];
      const habit = ctx.state.habits.bass;
      let idx = e < 0.4 ? (ctx.phrasePos % 2 ? 3 : 1) : habit[ctx.phrasePos % 2];
      if (ctx.phrasePos === 3 && e > 0.5) idx = 4;
      let pat = P[idx];
      if (ctx.harmony.length > 1) pat = [[0, 1.75, 'R'], [2, 1.5, 'R'], [3.5, 0.5, 'A']];
      for (const [t, d, k] of pat) {
        const chord = chordAt(ctx.harmony, t);
        const root = bassNear(bassPc(chord), ctx, lo, hi, center);
        let p = root;
        if (k === '5') p = clampRange(root + 7, lo, hi);
        else if (k === '8') p = root + 12 <= hi ? root + 12 : root;
        else if (k === '3') p = clampRange(nearestPc(chordTones(chord)[1], root + 4), lo, hi);
        else if (k === 'A') p = approach(clampRange(nearestPc(bassPc(ctx.next), root), lo, hi), root, ctx, chord, lo, hi);
        push(t, d, p, t === 0 ? 0.72 : 0.58);
      }
      break;
    }
    case 'bossa': {
      const spans = ctx.harmony.length > 1 ? ctx.harmony : [{ start: 0, dur: 2, chord: ctx.harmony[0].chord }, { start: 2, dur: 2, chord: ctx.harmony[0].chord }];
      for (const s of spans) {
        const root = bassNear(bassPc(s.chord), ctx, lo, hi, center);
        const fifth = clampRange(root - 5, lo, hi);
        push(s.start, 1.4, s.start === 0 ? root : fifth, 0.66);
        push(s.start + 1.5, 0.45, s.start === 0 ? fifth : root, 0.48);
      }
      break;
    }
    case 'folk': {
      const pos = B === 3 ? [0] : [0, 2];
      pos.forEach((t, i) => {
        const chord = chordAt(ctx.harmony, t);
        const root = bassNear(bassPc(chord), ctx, lo, hi, center);
        const isNew = ctx.harmony.some((s) => s.start === t);
        push(t, B === 3 ? 2.8 : 1.7, i === 0 || isNew ? root : clampRange(root + 7, lo, hi), i === 0 ? 0.62 : 0.52);
      });
      break;
    }
    case 'pedal': {
      for (const s of ctx.harmony) {
        const c = changesAt(ctx, s.start) ?? (ctx.sectionBar === 0 && s.start === 0 ? s.chord : null);
        if (!c) continue;
        const p = bassNear(bassPc(c), ctx, lo, hi, center - 2);
        push(s.start, Math.min(ctx.hold(s.start), 12) - 0.1, p, 0.5);
      }
      break;
    }
  }
  return out;
}

/* ---------------------------------- comp ---------------------------------- */

type Hits = [number, number][];

const JAZZ4: Hits[] = [
  [[0, 3.6]],
  [[0, 1.2], [1.5, 2.2]],
  [[1, 0.7], [3, 0.7]],
  [[0, 0.7], [2.5, 1.2]],
  [[0.5, 1.2], [2, 1.5]],
  [[0, 1.8], [2, 1.8]],
  [[1.5, 1], [3, 0.8]],
];
const JAZZ3: Hits[] = [[[0, 2.7]], [[0, 0.9], [1.5, 1.3]], [[1, 0.8], [2, 0.8]], [[0, 1.4], [2, 0.9]]];
const LOFI4: Hits[] = [
  [[0, 3.75]],
  [[0, 1.75], [2, 1.75]],
  [[0, 2.5], [2.75, 1.25]],
  [[0, 0.75], [0.75, 3]],
  [[0, 1.5], [2.5, 1.5]],
];

function voiceFor(ctx: BarCtx, key: string, chord: Chord, o: Parameters<typeof voice>[3]) {
  const v = voice(chord, ctx.key, ctx.state.voicing[key] ?? null, o);
  ctx.state.voicing[key] = v;
  return v;
}

function strum(out: NoteEvent[], inst: Inst, role: Role, notes: number[], t: number, d: number, vel: number, roll: number, rng: Rng) {
  notes.forEach((n, i) => {
    const v = vel * (i === notes.length - 1 ? 1.06 : 0.94) + rng.range(-0.03, 0.03);
    out.push(ev(inst, role, t + i * roll, Math.max(0.15, d - i * roll), n, v));
  });
}

/** Chord for a hit at t: off-beat hits just before a change anticipate it. */
function chordForHit(ctx: BarCtx, t: number): Chord {
  if (t % 1 === 0.5 || t % 1 === 0.75) {
    const ahead = t + (t % 1 === 0.5 ? 0.5 : 0.25);
    if (ahead >= ctx.beats) return ctx.next;
    if (ctx.harmony.some((s) => s.start === ahead)) return chordAt(ctx.harmony, ahead);
  }
  return chordAt(ctx.harmony, t);
}

export function comp(ctx: BarCtx): NoteEvent[] {
  const { inst, mode } = ctx.arr.comp!;
  const out: NoteEvent[] = [];
  const B = ctx.beats;
  const { energy, complexity, space } = ctx.params;
  const rng = ctx.rng;
  const capHi = (hi: number) => (ctx.melodyLow ? Math.max(Math.min(hi, ctx.melodyLow - 2), 64) : hi);
  const roleKey = 'comp';

  if (ctx.final) {
    if (mode === 'arp' || mode === 'fingerpick') {
      const notes = arpNotes(ctx, ctx.harmony[0].chord, 'final');
      notes.forEach((n, i) => out.push(ev(inst, 'comp', i * 0.25, B * 2, n, 0.42 - i * 0.02)));
    } else {
      const v = voiceFor(ctx, roleKey, ctx.harmony[0].chord, { lo: 48, hi: capHi(76), size: 4, rootless: ctx.hasBass, color: 0.6 });
      strum(out, inst, 'comp', v, 0, B * 2, 0.45, 0.06, rng);
      if (mode === 'ballad' && !ctx.hasBass) out.push(ev(inst, 'comp', 0, B * 2, clampRange(bassPc(ctx.harmony[0].chord) + 36, 33, 45), 0.5));
    }
    return out;
  }

  const activity = Math.max(0, Math.min(1, energy * 0.65 + complexity * 0.35 - space * 0.25 + (ctx.intensity - 0.5) * 0.3));

  switch (mode) {
    case 'jazz':
    case 'lofi':
    case 'waltz': {
      const bank = B === 3 ? JAZZ3 : mode === 'lofi' ? LOFI4 : JAZZ4;
      let hits: Hits;
      if (ctx.harmony.length > 1) {
        const mid = ctx.harmony[1].start;
        hits = rng.chance(0.5 + activity * 0.3) && mid >= 1.5
          ? [[0, mid - 0.6], [mid - 0.5, B - mid + 0.3]]
          : [[0, mid - 0.1], [mid, B - mid - 0.2]];
      } else {
        const habit = ctx.state.habits.comp;
        const sparse = activity < 0.35;
        const idx = sparse ? (rng.chance(0.7) ? 0 : 5 % bank.length) : rng.chance(0.65) ? habit[ctx.phrasePos % habit.length] % bank.length : rng.int(0, bank.length - 1);
        hits = bank[idx];
      }
      if (ctx.state.pushed.comp) hits = hits.filter(([t]) => t >= 0.5);
      ctx.state.pushed.comp = false;
      // Push the next chord a half beat early now and then.
      const lastEnd = hits.length ? hits[hits.length - 1][0] : 0;
      if (B === 4 && lastEnd < 3 && rng.chance(activity * 0.3)) {
        const t = mode === 'lofi' ? 3.75 : 3.5;
        hits = [...hits.map(([a, d]) => [a, Math.min(d, t - a - 0.05)] as [number, number]), [t, 1.2]];
        ctx.state.pushed.comp = true;
      }
      const size = complexity < 0.3 ? 3 : mode === 'lofi' && complexity > 0.6 ? 5 : 4;
      for (const [t, d] of hits) {
        const chord = t >= B - 0.75 && ctx.state.pushed.comp ? ctx.next : chordForHit(ctx, t);
        const v = voiceFor(ctx, roleKey, chord, { lo: mode === 'lofi' ? 50 : 50, hi: capHi(mode === 'lofi' ? 77 : 75), size, rootless: ctx.hasBass, color: 0.2 + complexity * 0.8, center: 63 });
        const vel = 0.42 + energy * 0.1 + (t % 1 ? 0.04 : 0) + (t === 0 ? 0.03 : 0);
        strum(out, inst, 'comp', v, t, d, vel, inst === 'rhodes' ? 0.018 : 0.012, rng);
      }
      break;
    }
    case 'ballad': {
      // Left hand: bass + shell, right hand: soft voicing under the melody.
      for (const s of ctx.harmony) {
        const c = s.chord;
        const root = clampRange(nearestPc(bassPc(c), ctx.state.bassLast ?? 40), 33, 48);
        ctx.state.bassLast = root;
        const shell = chordFamily(c) === 'maj' || chordFamily(c) === 'min' ? chordTones(c)[1] : chordTones(c)[3] ?? chordTones(c)[1];
        const shellNote = clampRange(nearestPc(shell, root + 12), root + 7, root + 17);
        const flowing = activity > 0.35 && s.dur >= 2;
        if (flowing) {
          // Broken left hand: root, shell, fifth, shell in eighths or quarters.
          const step = activity > 0.6 && B === 4 ? 0.5 : 1;
          const fifth = clampRange(root + 7, root + 5, root + 9);
          const seq = [root, fifth, shellNote, fifth + 12 <= 62 ? fifth + 12 : shellNote];
          for (let t = 0, i = 0; t < s.dur - 0.01; t += step, i++) {
            out.push(ev(inst, 'comp', s.start + t, s.dur - t, seq[i % seq.length], i === 0 ? 0.5 : 0.36));
          }
        } else {
          out.push(ev(inst, 'comp', s.start, s.dur, root, 0.5));
          out.push(ev(inst, 'comp', s.start + 0.02, s.dur, shellNote, 0.38));
        }
        const melodyBusy = ctx.melodyLow !== null;
        const hi = capHi(melodyBusy ? 72 : 76);
        const v = voiceFor(ctx, 'rh', c, { lo: 55, hi, size: 3, rootless: true, color: 0.3 + complexity * 0.7, center: 64 });
        const rhT = s.start + (rng.chance(0.4) && s.dur >= 2 ? 0.5 : 0);
        strum(out, inst, 'comp', v, rhT, s.dur - (rhT - s.start), melodyBusy ? 0.34 : 0.4, 0.03, rng);
        if (!melodyBusy && s.dur >= 4 && activity > 0.3) strum(out, inst, 'comp', v, s.start + 2.5, 1.4, 0.32, 0.03, rng);
      }
      break;
    }
    case 'fingerpick': {
      const quarters = activity < 0.3;
      for (const s of ctx.harmony) {
        const c = s.chord;
        const bassN = clampRange(nearestPc(bassPc(c), 45), 40, 52);
        const fifth = clampRange(bassN + 7, 40, 55);
        const up = voiceFor(ctx, roleKey, c, { lo: 53, hi: capHi(72), size: 3, rootless: true, color: 0.2 + complexity * 0.6, center: 62 });
        const P8 = B === 3 ? [['T', 0, 1, 2, 1, 0]] : [['T', 2, 'F', 1, 'T', 2, 'F', 1], ['T', 0, 1, 2, 'F', 2, 1, 0], ['T', 1, 0, 1, 'F', 2, 1, 0]];
        const pat = quarters ? (B === 3 ? ['T', 1, 2] : ['T', 1, 'F', 2]) : P8[ctx.state.habits.comp[0] % P8.length];
        const step = quarters ? 1 : 0.5;
        pat.forEach((k, i) => {
          const t = i * step;
          if (t < s.start - 1e-6 || t >= s.start + s.dur - 1e-6) return;
          const n = k === 'T' ? bassN : k === 'F' ? fifth : up[Math.min(up.length - 1, k as number)];
          const bassy = k === 'T' || k === 'F';
          out.push(ev(inst, 'comp', t, bassy ? 1.8 : 1.4, n, (bassy ? 0.5 : 0.4) * (ctx.hasBass && bassy ? 0.8 : 1) + (t === 0 ? 0.04 : 0)));
        });
      }
      break;
    }
    case 'bossa': {
      const even = ctx.barIndex % 2 === 0;
      const stabs = activity < 0.3 ? [0, 2] : even ? [0, 1.5, 3] : [1, 2.5];
      for (const t of stabs) {
        const c = chordForHit(ctx, t);
        const v = voiceFor(ctx, roleKey, c, { lo: 52, hi: capHi(72), size: 3, rootless: true, color: 0.3 + complexity * 0.6, center: 62 });
        strum(out, inst, 'comp', v, t, 0.8, 0.4 + (t % 1 ? 0.04 : 0), 0.012, rng);
      }
      for (const t of [0, 2]) {
        if (ctx.hasBass && activity < 0.5) continue;
        const c = chordAt(ctx.harmony, t);
        const r = clampRange(nearestPc(bassPc(c), 45), 40, 52);
        out.push(ev(inst, 'comp', t, 1.6, t === 0 ? r : clampRange(r + 7, 40, 55), 0.38));
      }
      break;
    }
    case 'arp': {
      const rate = activity < 0.25 ? 1 : activity < 0.7 ? 0.5 : 0.5;
      for (const s of ctx.harmony) {
        const notes = arpNotes(ctx, s.chord, inst === 'harp' ? 'harp' : 'piano');
        const seq = [...notes, ...notes.slice(1, -1).reverse()];
        let i = 0;
        for (let t = s.start; t < s.start + s.dur - 1e-6; t += rate, i++) {
          const n = seq[i % seq.length];
          const vel = 0.36 + (t === s.start ? 0.08 : 0) - (n - 60) * 0.002;
          out.push(ev(inst, 'comp', t, rate * 4, n, vel + rng.range(-0.03, 0.03)));
          if (activity > 0.75 && complexity > 0.6 && rng.chance(0.12)) {
            out.push(ev(inst, 'comp', t + rate / 2, rate * 2, seq[(i + 1) % seq.length], vel * 0.75));
          }
        }
      }
      break;
    }
  }
  return out;
}

function arpNotes(ctx: BarCtx, c: Chord, flavor: 'harp' | 'piano' | 'final'): number[] {
  const low = clampRange(nearestPc(bassPc(c), 43), 38, 50);
  const ivs = voicingIntervals(c, ctx.key, 4, true, 0.3 + ctx.params.complexity * 0.6).map((i) => i % 12);
  const notes = [low, low + 7];
  let p = low + 7;
  const span = flavor === 'harp' ? 26 : 22;
  const pcs = [...new Set(ivs.map((i) => mod12(c.root + i)))];
  for (let k = 0; notes.length < 7 && k < 20; k++) {
    const pc = pcs[k % pcs.length];
    p = p + 1 + mod12(pc - (p + 1));
    if (p > low + 7 + span) break;
    notes.push(p);
  }
  return [...new Set(notes)].sort((a, b) => a - b).filter((n) => !ctx.melodyLow || n < ctx.melodyLow - 1 || n < 60);
}

/* ------------------------------- pad / texture ------------------------------- */

export function pad(ctx: BarCtx, inst: Inst): NoteEvent[] {
  const out: NoteEvent[] = [];
  const spread = 0.3 + ctx.params.space * 0.7;
  for (const s of ctx.harmony) {
    const c = changesAt(ctx, s.start) ?? (ctx.sectionBar === 0 && s.start === 0 ? s.chord : null);
    if (!c && !ctx.final) continue;
    const chord = c ?? s.chord;
    const hi = inst === 'bowedvibes' ? 79 : 74 + Math.round(spread * 5);
    const v = voiceFor(ctx, 'pad', chord, { lo: 50, hi, size: inst === 'bowedvibes' ? 3 : 4, rootless: true, color: 0.35 + ctx.params.complexity * 0.5, spread: true, center: 63 + spread * 3 });
    const dur = ctx.final ? ctx.beats * 2 : Math.min(ctx.hold(s.start), 16) - 0.05;
    for (const n of v) out.push(ev(inst, 'pad', s.start, dur, n, 0.42));
  }
  return out;
}

export function texture(ctx: BarCtx): NoteEvent[] {
  const t = ctx.arr.texture!;
  const out: NoteEvent[] = [];
  if (t.mode === 'arp') {
    // A slower, higher arpeggio than a comping harp: notes dropping like light.
    const rate = ctx.params.energy < 0.3 ? 1 : 0.5;
    for (const s of ctx.harmony) {
      const tones = stableTones(s.chord, ctx.key);
      const base = 67;
      const pool = [...new Set(tones.map((pc) => clampRange(nearestPc(pc, base), 62, 79)))].sort((a, b) => a - b);
      const seq = [...pool, ...pool.map((n) => n + 12).filter((n) => n <= 86)];
      let i = ctx.rng.int(0, seq.length - 1);
      for (let x = s.start; x < s.start + s.dur - 1e-6; x += rate) {
        if (!ctx.rng.chance(0.55 + ctx.params.complexity * 0.3)) continue;
        i = (i + (ctx.rng.chance(0.7) ? 1 : -1) + seq.length) % seq.length;
        out.push(ev(t.inst, 'texture', x, 3, seq[i], 0.28 + ctx.rng.range(0, 0.1)));
      }
    }
  } else {
    const n = ctx.rng.chance(0.35 + ctx.params.space * 0.3) ? (ctx.rng.chance(0.3) ? 2 : 1) : 0;
    for (let k = 0; k < n; k++) {
      const x = ctx.rng.int(0, ctx.beats * 2 - 1) / 2;
      const chord = chordAt(ctx.harmony, x);
      const tones = stableTones(chord, ctx.key);
      const pc = ctx.rng.pick(tones);
      out.push(ev(t.inst, 'texture', x, 4, clampRange(nearestPc(pc, 79), 74, 88), 0.26 + ctx.rng.range(0, 0.08)));
    }
  }
  return out;
}

/* ---------------------------------- counter ---------------------------------- */

export function counter(ctx: BarCtx, inst: Inst): NoteEvent[] {
  const B = ctx.beats;
  const gapStart = Math.ceil(ctx.melodyEnd * 2) / 2 + 0.5;
  if (B - gapStart < 1.5) return [];
  if (!ctx.rng.chance(0.2 + ctx.params.complexity * 0.45)) return [];
  const out: NoteEvent[] = [];
  const chord = chordAt(ctx.harmony, gapStart);
  const scale = chordScale(chord, ctx.key);
  let p = clampRange(nearestPc(ctx.rng.pick(chordTones(chord)), 69), 62, 79);
  const dir = ctx.rng.chance(0.5) ? 1 : -1;
  const n = Math.min(4, Math.floor((B - gapStart) / 0.5));
  for (let i = 0; i < n; i++) {
    const t = gapStart + i * 0.5;
    out.push(ev(inst, 'counter', t, i === n - 1 ? 1.2 : 0.45, p, 0.4 - i * 0.02));
    do p += dir;
    while (!scale.includes(mod12(p)));
  }
  return out;
}

/* ---------------------------------- drums ---------------------------------- */

export function drums(ctx: BarCtx): NoteEvent[] {
  const kit = ctx.arr.drums!;
  const out: NoteEvent[] = [];
  const B = ctx.beats;
  const L = ctx.level;
  const { energy, complexity } = ctx.params;
  const rng = ctx.rng;
  const hit = (h: DrumHit, t: number, v: number, d = 0.5) => out.push(ev('drums', 'drums', t, d, 0, v, h));
  const fill = ctx.phrasePos === 3 && ctx.sectionKind !== 'intro';

  if (ctx.final) {
    hit(kit === 'brushes' ? 'swish' : 'bell', 0, 0.3, 2);
    if (kit !== 'shaker') hit('ride', 0, 0.28, 4);
    return out;
  }

  switch (kit) {
    case 'lofi': {
      const hatV = 0.32 + energy * 0.14;
      for (let i = 0; i < B * 2; i++) {
        const t = i * 0.5;
        if (fill && t >= 3.5 && rng.chance(0.5)) continue;
        hit('hat', t, (i % 2 ? hatV * 0.72 : hatV) + rng.range(-0.04, 0.04));
        if (complexity > 0.45 && rng.chance((complexity - 0.4) * 0.35)) hit('hat', t + 0.25, 0.14);
      }
      if (fill && rng.chance(0.4)) hit('hatopen', 3.5, 0.3, 1);
      if (L > 0.35) {
        const K = [[0, 2.5], [0, 1.75, 2.5], [0, 0.75, 2.5], [0, 2.5, 2.75], [0, 1.5, 2.5]];
        let ks = K[ctx.state.habits.kick[ctx.phrasePos % 2] % K.length];
        if (fill) ks = ks.filter((t) => t < 2.5);
        for (const t of ks) hit('kick', t, (t === 0 ? 0.78 : 0.62) + rng.range(-0.05, 0.05));
      }
      if (L > 0.22) {
        const snare: DrumHit = L > 0.6 && energy > 0.42 ? 'snare' : 'xstick';
        for (const t of [1, 3]) hit(snare, t + 0.035, (snare === 'snare' ? 0.55 : 0.6) + rng.range(-0.05, 0.05));
        if (complexity > 0.35 && rng.chance(complexity * 0.4)) hit('snare', rng.pick([1.75, 2.75, 3.75]), 0.13);
        if (fill && snare === 'snare') for (const t of [3.25, 3.5, 3.75]) hit('snare', t, 0.16 + (t - 3) * 0.25);
      }
      break;
    }
    case 'brushes': {
      const ride = (ctx.sectionKind === 'solo' || ctx.sectionKind === 'B') && energy > 0.45 && L > 0.6;
      for (let beat = 0; beat < B; beat++) {
        hit('swish', beat, (ride ? 0.14 : 0.24) + energy * 0.08 + (beat % 2 ? 0.04 : 0), 1);
      }
      const backbeats = B === 3 ? [1, 2] : [1, 3];
      for (const t of backbeats) hit('brush', t, 0.32 + energy * 0.08);
      if (complexity > 0.35 && rng.chance(complexity * 0.5)) hit('brush', B - 0.5, 0.18);
      if (L > 0.4) for (const t of backbeats) hit('hatfoot', t, 0.34);
      if (L > 0.55) hit('kick', 0, 0.22);
      if (ride) {
        const R = B === 3 ? [0, 1, 1.5, 2] : [0, 1, 1.5, 2, 3, 3.5];
        for (const t of R) hit('ride', t, t % 1 ? 0.24 : 0.34 + (t % 2 === 1 ? 0.04 : 0), 2);
      }
      if (fill && rng.chance(0.5)) for (const t of [B - 1, B - 2 / 3, B - 1 / 3]) hit('brush', t, 0.22 + rng.range(0, 0.08));
      break;
    }
    case 'bossa': {
      const even = ctx.barIndex % 2 === 0;
      for (const t of even ? [0, 1.5, 3] : [1, 2.5]) hit('xstick', t, 0.48 + rng.range(-0.04, 0.04));
      for (let i = 0; i < B * 2; i++) hit('shaker', i * 0.5, (i % 2 ? 0.3 : 0.2) + rng.range(-0.03, 0.03));
      if (L > 0.45) {
        hit('kick', 0, 0.5); hit('kick', 1.5, 0.32); hit('kick', 2, 0.52); hit('kick', 3.5, 0.32);
      }
      if (L > 0.6 && energy > 0.55) for (let i = 0; i < B * 2; i++) hit('hat', i * 0.5, i % 2 ? 0.22 : 0.14);
      break;
    }
    case 'shaker': {
      for (let i = 0; i < B * 2; i++) hit('shaker', i * 0.5, (i % 2 ? 0.26 : 0.2) + rng.range(-0.03, 0.03));
      if (L > 0.5) for (const t of B === 3 ? [0] : [0, 2]) hit('kick', t, 0.4);
      if (L > 0.7 && energy > 0.5) hit('xstick', B === 3 ? 2 : 3, 0.32);
      break;
    }
  }
  return out;
}
