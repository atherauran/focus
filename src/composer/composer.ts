import { moodColor } from './harmony';
import { shapeBar } from './melody';
import { BarCtx, PieceState, bass, comp, counter, drums, pad, texture } from './parts';
import { History, Piece, planPiece } from './piece';
import { Rng, rngFor } from './rng';
import { Chord } from './theory';
import type { Bar, BarHarmony, NoteEvent, Params, Role } from './types';

type Variant = 'base' | 'rich' | 'simple';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Stateful but deterministic: the same seed and the same sequence of params always produce the
 * same bars. Pieces are planned up front (form, harmony, melody); accompaniment and dynamics are
 * played bar by bar so the live controls can reshape them.
 */
export class Composer {
  private seed: number;
  private piece: Piece | null = null;
  private pieceCount = 0;
  private bar = 0;
  private state!: PieceState;
  private lastChord: Chord | null = null;
  private history: History = { arrangements: [], tonics: [] };
  private gapPending = false;
  private lastTempo = 72;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  get current(): Piece | null {
    return this.piece;
  }

  /** Abandon the current piece; the next bar starts a new one. */
  skip() {
    this.piece = null;
    this.gapPending = false;
  }

  next(params: Params): Bar {
    if (this.piece && this.bar >= this.piece.totalBars) {
      if (this.gapPending) {
        this.gapPending = false;
        return this.gapBar();
      }
      this.piece = null;
    }
    if (!this.piece) this.startPiece(params);
    const out = this.render(params);
    this.bar++;
    if (this.bar >= this.piece!.totalBars) this.gapPending = true;
    return out;
  }

  private startPiece(params: Params) {
    const p = planPiece(this.seed, this.pieceCount++, params, this.history);
    this.piece = p;
    this.bar = 0;
    this.lastChord = null;
    this.history.arrangements.push(p.arr.id);
    this.history.tonics.push(p.key.tonic);
    const r = rngFor(this.seed, 'habits', p.index);
    this.state = {
      voicing: {},
      bassLast: null,
      pushed: {},
      levels: {},
      habits: { comp: [r.int(0, 6), r.int(0, 6), r.int(0, 6)], bass: [r.int(0, 2), r.int(0, 4)], kick: [r.int(0, 4), r.int(0, 4)] },
    };
  }

  private gapBar(): Bar {
    const p = this.piece!;
    return {
      piece: p.index, bar: p.totalBars, beats: 4, tempo: this.lastTempo, baseTempo: this.lastTempo, events: [],
      style: p.arr.style, arrangement: p.arr.id, section: 'gap', chords: [], key: p.key, gap: true,
    };
  }

  private harmonyAt(bi: number, v: Variant, mood: number): BarHarmony {
    const p = this.piece!;
    if (bi >= p.totalBars) return [{ start: 0, dur: p.beats, chord: { root: p.key.tonic, q: 'maj' } }];
    const sec = p.sections[p.sectionOf[bi]];
    const raw = sec.harmony[v][p.barInSection[bi]];
    return raw.map((s, i) => {
      const nextRoot = raw[i + 1]?.chord.root ?? this.rawNext(bi, v)?.root ?? null;
      return { ...s, chord: moodColor(s.chord, p.key, mood, nextRoot) };
    });
  }

  private rawNext(bi: number, v: Variant): Chord | null {
    const p = this.piece!;
    if (bi + 1 >= p.totalBars) return null;
    const sec = p.sections[p.sectionOf[bi + 1]];
    return sec.harmony[v][p.barInSection[bi + 1]][0].chord;
  }

  private render(params: Params): Bar {
    const p = this.piece!;
    const bi = this.bar;
    const si = p.sectionOf[bi];
    const sec = p.sections[si];
    const sb = p.barInSection[bi];
    const B = p.beats;
    const { energy, mood, space, complexity } = params;
    const v: Variant = complexity < 0.3 ? 'simple' : complexity > 0.68 ? 'rich' : 'base';
    const harmony = this.harmonyAt(bi, v, mood);
    const nextH = this.harmonyAt(bi + 1, v, mood);
    const final = !!sec.final && sb === sec.bars - 1;
    const rng = rngFor(this.seed, 'bar', p.index, bi);
    const phrasePos = sb % 4;

    // Role levels glide toward their targets so parts enter and leave over a few bars.
    const arr = p.arr;
    const targets: Partial<Record<Role, number>> = {};
    const R = sec.roles;
    const drumGate = clamp01((energy - 0.12) / 0.33);
    if (arr.comp) targets.comp = R.comp ?? 0;
    if (arr.bass) targets.bass = (R.bass ?? 0) * (energy < 0.1 && arr.bass.mode !== 'pedal' ? 0.6 : 1);
    if (arr.pad) targets.pad = (R.pad ?? 0) * clamp01(0.45 + space * 0.7);
    if (arr.texture) targets.texture = (R.texture ?? 0) * clamp01(0.25 + space * 0.5 + complexity * 0.35);
    if (arr.counter) targets.counter = (R.counter ?? 0) * clamp01((complexity - 0.25) * 2);
    if (arr.drums) targets.drums = (R.drums ?? 0) * drumGate * (final ? 0.5 : 1);
    targets.melody = sec.melody === 'none' ? 0 : 1;
    const lv = this.state.levels;
    for (const role of Object.keys(targets) as Role[]) {
      const cur = lv[role] ?? (bi === 0 ? targets[role]! : 0);
      const tgt = targets[role]!;
      // Changes driven by the sliders wait for a phrase boundary; section changes don't.
      const step = role === 'melody' ? 1 : sb === 0 || phrasePos === 0 ? 0.34 : 0.12;
      lv[role] = cur + Math.max(-step, Math.min(step, tgt - cur));
    }

    const events: NoteEvent[] = [];
    const melodyDensity = clamp01(0.3 + energy * 0.45 + complexity * 0.35 - space * 0.3);
    const rawMel = p.melody[bi];
    const melNotes = sec.melodyInst && (lv.melody ?? 0) > 0 ? shapeBar(rawMel, melodyDensity, harmony, p.key, complexity, rngFor(this.seed, 'orn', p.index, bi)) : [];
    for (const n of melNotes) events.push({ inst: sec.melodyInst!, role: 'melody', time: n.t, dur: n.d, midi: n.midi, vel: n.vel, });
    const melodyLow = melNotes.length ? Math.min(...melNotes.map((n) => n.midi)) : null;
    const melodyEnd = melNotes.length ? Math.max(...melNotes.map((n) => n.t + n.d)) : 0;

    const hold = (t: number) => {
      const chordAtT = harmony.filter((s) => s.start <= t + 1e-6).pop()!.chord;
      const same = (c: Chord) => c.root === chordAtT.root && c.q === chordAtT.q && c.bass === chordAtT.bass;
      for (const s of harmony) if (s.start > t + 1e-6 && !same(s.chord)) return s.start - t;
      let acc = B - t;
      for (let k = bi + 1; k < Math.min(p.totalBars, bi + 5); k++) {
        const h = this.harmonyAt(k, v, mood);
        for (const s of h) if (!same(s.chord)) return acc + s.start;
        acc += B;
      }
      return acc;
    };

    const base: Omit<BarCtx, 'level' | 'rng'> = {
      beats: B, key: p.key, harmony, prevChord: this.lastChord, next: nextH[0].chord, params, intensity: sec.intensity,
      phrasePos, sectionKind: sec.kind, sectionBar: sb, barIndex: bi, final, hold, melodyLow, melodyEnd,
      hasBass: !!arr.bass && (lv.bass ?? 0) > 0.3, state: this.state, arr,
    };
    const ctxFor = (role: Role): BarCtx => ({ ...base, level: lv[role] ?? 0, rng: rngFor(this.seed, role, p.index, bi) });
    const on = (role: Role) => (lv[role] ?? 0) > 0.06;

    if (arr.comp && on('comp')) events.push(...comp(ctxFor('comp')));
    if (arr.bass && on('bass')) events.push(...bass(ctxFor('bass')));
    if (arr.pad && on('pad')) events.push(...pad(ctxFor('pad'), arr.pad));
    if (arr.texture && on('texture') && !final) events.push(...texture(ctxFor('texture')));
    if (arr.counter && on('counter') && !final && sec.melody !== 'none') events.push(...counter(ctxFor('counter'), arr.counter));
    if (arr.drums && on('drums')) events.push(...drums(ctxFor('drums')));

    this.lastChord = harmony[harmony.length - 1].chord;

    // Tempo: the piece's tempo, nudged by energy, breathing at phrase ends, slowing to the end.
    let tempo = p.tempo * (1 + (energy - p.energyAtPlan) * 0.08);
    const rubato = arr.style === 'ballad' || arr.style === 'ambient';
    if (rubato) tempo *= phrasePos === 3 ? 0.965 : 1 + rng.range(-0.008, 0.012);
    if (sec.final) tempo *= sb === sec.bars - 1 ? 0.8 : 0.92;
    this.lastTempo = tempo;

    this.humanize(events, rng, params, sec.intensity, phrasePos, tempo, lv, rubato);

    return {
      piece: p.index, bar: bi, beats: B, tempo, baseTempo: p.tempo, events, style: arr.style, arrangement: arr.id,
      section: sec.label, chords: harmony, key: p.key,
    };
  }

  private humanize(events: NoteEvent[], rng: Rng, params: Params, intensity: number, phrasePos: number, tempo: number, lv: Partial<Record<Role, number>>, rubato: boolean) {
    const arr = this.piece!.arr;
    const msToBeats = (ms: number) => (ms / 1000) * (tempo / 60);
    const swing = 0.5 + (arr.swing - 0.5) * Math.max(0.4, Math.min(1, (150 - tempo) / 70));
    const unit = arr.swingUnit;
    const arc = [0.95, 1, 1.05, 0.97][phrasePos];
    const dyn = (0.8 + params.energy * 0.28) * (0.86 + intensity * 0.28);
    for (const e of events) {
      // Swing the off-beat subdivisions.
      // (Tolerance covers the small offsets of rolled chords.)
      const k = Math.round(e.time / unit);
      if (Math.abs(e.time - k * unit) < 0.06 && k % 2 === 1) e.time += unit * (2 * swing - 1);
      let ms = 0;
      switch (e.role) {
        case 'melody': ms = rng.gauss() * (rubato ? 16 : 9) + 6; break;
        case 'counter': ms = rng.gauss() * 10 + 4; break;
        case 'comp': ms = rng.gauss() * 7; break;
        case 'bass': ms = rng.gauss() * 5 + 7; break;
        case 'texture': ms = rng.gauss() * 12; break;
        case 'drums': ms = rng.gauss() * (e.hit === 'swish' ? 10 : 3.5); break;
        default: ms = 0;
      }
      e.time += msToBeats(ms);
      const level = lv[e.role] ?? 1;
      const shaped = e.role === 'drums' || e.role === 'pad' ? 1 : arc;
      e.vel = Math.max(0.02, Math.min(1, e.vel * dyn * shaped * (0.35 + 0.65 * level) + rng.gauss() * 0.02));
    }
    events.sort((a, b) => a.time - b.time);
  }
}
