import { describe, expect, it } from 'vitest';
import { Composer } from '../src/composer/composer';
import { planPiece } from '../src/composer/piece';
import { chordTones, mod12, stableTones } from '../src/composer/theory';
import type { Bar, Params } from '../src/composer/types';
import { voice } from '../src/composer/voicing';
import { parseProgression } from '../src/composer/harmony';

const MID: Params = { energy: 0.5, mood: 0.5, space: 0.5, complexity: 0.5 };
const PRESETS: Record<string, Params> = {
  study: { energy: 0.45, mood: 0.55, space: 0.45, complexity: 0.5 },
  reading: { energy: 0.28, mood: 0.5, space: 0.55, complexity: 0.4 },
  coding: { energy: 0.62, mood: 0.45, space: 0.35, complexity: 0.62 },
  sleep: { energy: 0.08, mood: 0.4, space: 0.85, complexity: 0.18 },
};

function run(seed: number, params: Params, minutes: number): Bar[] {
  const c = new Composer(seed);
  const bars: Bar[] = [];
  let t = 0;
  while (t < minutes * 60) {
    const b = c.next(params);
    bars.push(b);
    t += (b.beats * 60) / b.tempo;
  }
  return bars;
}

const seconds = (bars: Bar[]) => bars.reduce((s, b) => s + (b.beats * 60) / b.tempo, 0);

describe('determinism', () => {
  it('same seed and params give identical music', () => {
    const a = run(42, MID, 6);
    const b = run(42, MID, 6);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds give different music', () => {
    const a = run(1, MID, 3).flatMap((b) => b.events.map((e) => e.midi));
    const b = run(2, MID, 3).flatMap((b) => b.events.map((e) => e.midi));
    expect(a.join()).not.toBe(b.join());
  });
});

describe('pieces', () => {
  it('last a few minutes each and have a real form', () => {
    for (const [name, p] of Object.entries(PRESETS)) {
      for (let seed = 1; seed <= 6; seed++) {
        const piece = planPiece(seed, 0, p, { arrangements: [], tonics: [] });
        const dur = piece.sections.reduce((s, sec) => s + sec.bars, 0) * (piece.beats * 60) / piece.tempo;
        expect(dur, `${name} seed ${seed} ${piece.arr.id}`).toBeGreaterThan(150);
        expect(dur).toBeLessThan(360);
        const kinds = piece.sections.map((s) => s.kind);
        expect(kinds[0]).toBe('intro');
        expect(kinds[kinds.length - 1]).toBe('outro');
        expect(kinds).toContain('A');
        expect(kinds).toContain('B');
      }
    }
  });

  it('an hour covers clearly different arrangements and keys', () => {
    for (const p of Object.values(PRESETS)) {
      const bars = run(7, p, 60);
      const arrs = new Set(bars.map((b) => b.arrangement));
      const keys = new Set(bars.map((b) => `${b.key.tonic}${b.key.mode}`));
      const pieces = new Set(bars.map((b) => b.piece));
      expect(pieces.size).toBeGreaterThanOrEqual(12);
      expect(arrs.size).toBeGreaterThanOrEqual(4);
      expect(keys.size).toBeGreaterThanOrEqual(8);
      // Never the same arrangement twice in a row.
      const order = [...new Map(bars.map((b) => [b.piece, b.arrangement])).values()];
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    }
  });

  it('pieces end with a ritardando and are separated by a gap', () => {
    const bars = run(3, MID, 12);
    const gaps = bars.filter((b) => b.gap);
    expect(gaps.length).toBeGreaterThan(1);
    for (const g of gaps) {
      const i = bars.indexOf(g);
      expect(bars[i - 1].tempo).toBeLessThan(bars[i - 1].baseTempo * 0.9);
      expect(g.events.length).toBe(0);
    }
  });
});

describe('notes', () => {
  const bars = Object.values(PRESETS).flatMap((p, i) => run(100 + i, p, 25));
  const events = bars.flatMap((b) => b.events.map((e) => ({ ...e, bar: b })));

  it('are well-formed', () => {
    for (const e of events) {
      expect(Number.isFinite(e.time)).toBe(true);
      expect(e.dur).toBeGreaterThan(0);
      expect(e.vel).toBeGreaterThan(0);
      expect(e.vel).toBeLessThanOrEqual(1);
      expect(e.time).toBeGreaterThan(-0.2);
      expect(e.time).toBeLessThan(e.bar.beats + 0.2);
      if (e.inst !== 'drums') {
        expect(e.midi).toBeGreaterThanOrEqual(26);
        expect(e.midi).toBeLessThanOrEqual(96);
      }
    }
  });

  it('melody lands on chord tones or good tensions on strong beats', () => {
    let strong = 0, good = 0;
    for (const b of bars) {
      for (const e of b.events) {
        if (e.role !== 'melody') continue;
        const t = Math.round(e.time * 4) / 4;
        if (!(t % 2 === 0 || e.dur >= 1)) continue;
        const span = [...b.chords].reverse().find((s) => s.start <= t + 0.05) ?? b.chords[0];
        strong++;
        if (stableTones(span.chord, b.key).includes(mod12(e.midi))) good++;
      }
    }
    expect(good / strong).toBeGreaterThan(0.9);
  });

  it('melody moves mostly by step, leaves room, and stays singable', () => {
    for (const p of Object.values(PRESETS)) {
      const mb = run(9, p, 15);
      const mel = mb.flatMap((b, bi) => b.events.filter((e) => e.role === 'melody').map((e) => ({ ...e, abs: bi * 4 + e.time })));
      let steps = 0, leaps = 0;
      for (let i = 1; i < mel.length; i++) {
        const iv = Math.abs(mel[i].midi - mel[i - 1].midi);
        if (iv <= 2) steps++;
        if (iv > 12) leaps++;
      }
      expect(steps / mel.length).toBeGreaterThan(0.35);
      expect(leaps / mel.length).toBeLessThan(0.03);
      // Rests are part of the melody: a good share of melodic bars contain silence.
      const melodicBars = mb.filter((b) => b.events.some((e) => e.role === 'melody'));
      const sounding = melodicBars.map((b) => b.events.filter((e) => e.role === 'melody').reduce((s, e) => s + e.dur, 0) / b.beats);
      expect(sounding.filter((x) => x < 0.75).length / sounding.length).toBeGreaterThan(0.3);
    }
  });

  it('energy changes density', () => {
    const count = (p: Params) => run(5, p, 20).reduce((s, b) => s + b.events.length, 0) / seconds(run(5, p, 20));
    const calm = count({ ...MID, energy: 0.1 });
    const lively = count({ ...MID, energy: 0.9 });
    expect(lively).toBeGreaterThan(calm * 1.5);
  });

  it('sleep has no drums, coding usually has them', () => {
    const sleep = run(11, PRESETS.sleep, 20).flatMap((b) => b.events);
    const coding = run(11, PRESETS.coding, 20).flatMap((b) => b.events);
    expect(sleep.filter((e) => e.role === 'drums').length / sleep.length).toBeLessThan(0.02);
    expect(coding.filter((e) => e.role === 'drums').length).toBeGreaterThan(100);
  });

  it('parts fade in rather than jump: velocities ramp at section starts', () => {
    const b = run(4, MID, 10);
    const firstDrumBar = b.findIndex((x) => x.events.some((e) => e.role === 'drums'));
    if (firstDrumBar >= 0) {
      const v = (i: number) => {
        const d = b[i].events.filter((e) => e.role === 'drums');
        return d.reduce((s, e) => s + e.vel, 0) / Math.max(1, d.length);
      };
      expect(v(firstDrumBar)).toBeLessThanOrEqual(v(firstDrumBar + 6) + 0.05);
    }
  });
});

describe('voice leading', () => {
  it('moves voices smoothly through a ii-V-I chain', () => {
    const key = { tonic: 0, mode: 'major' as const };
    const bars = parseProgression('ii7 | V7 | IM7 | VI7 | ii7 | V7 | IM7 | IM7', key, 4);
    let prev: number[] | null = null;
    let total = 0;
    for (const bar of bars) {
      const v = voice(bar[0].chord, key, prev, { lo: 50, hi: 74, size: 4, rootless: true, color: 0.5 });
      expect(v.length).toBe(4);
      for (const n of v) expect(n).toBeGreaterThanOrEqual(50);
      // Guide tones are present.
      const pcs = v.map(mod12);
      const ct = chordTones(bar[0].chord);
      expect(pcs).toContain(ct[1]);
      if (prev) total += v.reduce((s, n, i) => s + Math.abs(n - prev![i]), 0);
      prev = v;
    }
    expect(total / (bars.length - 1)).toBeLessThan(9);
  });
});
