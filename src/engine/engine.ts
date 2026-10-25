import * as Tone from 'tone';
import { Composer } from '../composer/composer';
import type { Bar, Inst, NoteEvent, Params, Style } from '../composer/types';
import { ALL_INSTS, INST, Voice, createVoice } from './instruments';
import { makeImpulse } from './reverb';

const PPQ = 960;
/** Final output level, after the limiter. */
const OUTPUT = Tone.dbToGain(-15);

interface Channel {
  voice: Voice;
  input: Tone.Gain;
  filter: Tone.BiquadFilter;
  out: Tone.Panner;
  room: Tone.Gain;
  hall: Tone.Gain;
  echo: Tone.Gain;
  extra: Tone.ToneAudioNode[];
}

/** Mastering colour per style: how dark the top end gets and how much tape wobble. */
const FLAVOR: Record<Style, { lpDark: number; lpBright: number; wow: number; drive: number }> = {
  lofi: { lpDark: 7500, lpBright: 13000, wow: 0.16, drive: 0.5 },
  jazz: { lpDark: 10000, lpBright: 19000, wow: 0, drive: 0.25 },
  waltz: { lpDark: 10000, lpBright: 19000, wow: 0, drive: 0.25 },
  ballad: { lpDark: 9000, lpBright: 18000, wow: 0.03, drive: 0.2 },
  bossa: { lpDark: 10000, lpBright: 19000, wow: 0, drive: 0.2 },
  ambient: { lpDark: 8000, lpBright: 17000, wow: 0.04, drive: 0.15 },
  folk: { lpDark: 10000, lpBright: 19000, wow: 0, drive: 0.2 },
};

export interface EngineOptions {
  seed: number;
  params: Params;
  /** offline rendering: load everything up front and skip live niceties */
  offline?: boolean;
  /** only these instruments sound (for stem analysis) */
  solo?: Inst[];
  onBar?: (bar: Bar) => void;
}

function tanhCurve(drive: number) {
  const k = 1 + drive * 3;
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

/**
 * Plays whatever the composer writes. Bars are requested one ahead and scheduled on the
 * transport; global colour (reverb, tone, tape) follows the sliders continuously.
 */
export class Engine {
  readonly composer: Composer;
  params: Params;
  tempoOverride: number | null = null;
  currentTempo = 72;

  private channels = new Map<Inst, Channel>();
  private loading = new Map<Inst, Promise<void>>();
  private transport = Tone.getTransport();
  private master: Tone.Gain;
  private tone: Tone.BiquadFilter;
  private lowShelf: Tone.BiquadFilter;
  private wow: Tone.Vibrato;
  private shaper: Tone.WaveShaper;
  private leveler: Tone.Compressor;
  private comp: Tone.Compressor;
  private limiter: Tone.Limiter;
  private out: Tone.Gain;
  private roomBus: Tone.Convolver;
  private hallBus: Tone.Convolver;
  private echoBus: Tone.FeedbackDelay;
  private echoTone: Tone.BiquadFilter;
  readonly meter: Tone.Meter | null;
  private style: Style = 'jazz';
  private running = false;
  private o: EngineOptions;

  constructor(o: EngineOptions) {
    this.o = o;
    this.params = { ...o.params };
    this.composer = new Composer(o.seed);
    this.transport.PPQ = PPQ;

    this.out = new Tone.Gain(o.offline ? OUTPUT : 0).toDestination();
    this.limiter = new Tone.Limiter(-1).connect(this.out);
    this.comp = new Tone.Compressor({ threshold: -20, ratio: 2.2, attack: 0.025, release: 0.35, knee: 12 }).connect(this.limiter);
    this.shaper = new Tone.WaveShaper(tanhCurve(0.2), 1024).connect(this.comp);
    this.shaper.oversample = '2x';
    // Slow leveler: evens out loudness between pieces (a solo piano vs. a full trio).
    this.leveler = new Tone.Compressor({ threshold: -30, ratio: 2.6, attack: 0.6, release: 1, knee: 8 }).connect(this.shaper);
    this.wow = new Tone.Vibrato({ frequency: 0.55, depth: 0, maxDelay: 0.006, type: 'sine' }).connect(this.leveler);
    this.lowShelf = new Tone.BiquadFilter({ type: 'lowshelf', frequency: 160, gain: 0.5 }).connect(this.wow);
    this.tone = new Tone.BiquadFilter({ type: 'lowpass', frequency: 12000, Q: 0.5 }).connect(this.lowShelf);
    this.master = new Tone.Gain(1).connect(this.tone);
    this.meter = o.offline ? null : new Tone.Meter({ smoothing: 0.85, normalRange: true });
    if (this.meter) this.limiter.connect(this.meter);

    this.roomBus = new Tone.Convolver({ normalize: false }).connect(this.master);
    this.roomBus.buffer = new Tone.ToneAudioBuffer(makeImpulse({ seconds: 1.6, rt60: 0.85, predelay: 0.006, brightness: 9000, darkening: 2500, early: 0.6, seed: 11 }));
    this.hallBus = new Tone.Convolver({ normalize: false }).connect(this.master);
    this.hallBus.buffer = new Tone.ToneAudioBuffer(makeImpulse({ seconds: 6, rt60: 3.6, predelay: 0.028, brightness: 6500, darkening: 900, early: 0.3, seed: 23 }));
    this.echoTone = new Tone.BiquadFilter({ type: 'lowpass', frequency: 2600 }).connect(this.hallBus);
    this.echoTone.connect(this.master);
    this.echoBus = new Tone.FeedbackDelay({ delayTime: 0.5, feedback: 0.32, maxDelay: 2 }).connect(this.echoTone);
  }

  /** Make sure the given instruments are ready (shared sample cache). */
  async ensure(insts: Inst[]) {
    await Promise.all(insts.map((i) => this.channel(i)));
  }

  private channel(id: Inst): Promise<void> {
    let p = this.loading.get(id);
    if (p) return p;
    p = (async () => {
      const voice = await createVoice(id);
      const s = INST[id];
      const out = new Tone.Panner(s.pan).connect(this.master);
      const filter = new Tone.BiquadFilter({ type: 'lowpass', frequency: s.lp, Q: 0.3 });
      const hp = new Tone.BiquadFilter({ type: 'highpass', frequency: s.hp });
      const input = new Tone.Gain(Tone.dbToGain(s.gain));
      const extra: Tone.ToneAudioNode[] = [hp];
      voice.output.connect(input);
      if (s.trem) {
        const trem = new Tone.Tremolo({ frequency: s.trem.freq, depth: s.trem.depth, spread: 120 }).start();
        input.chain(trem, hp, filter);
        extra.push(trem);
      } else input.chain(hp, filter);
      filter.connect(out);
      const room = new Tone.Gain(0).connect(this.roomBus);
      const hall = new Tone.Gain(0).connect(this.hallBus);
      const echo = new Tone.Gain(0).connect(this.echoBus);
      filter.fan(room, hall, echo);
      if (this.o.solo && !this.o.solo.includes(id)) out.disconnect(), room.disconnect(), hall.disconnect(), echo.disconnect();
      this.channels.set(id, { voice, input, filter, out, room, hall, echo, extra });
      this.applyChannel(id, 0);
    })();
    this.loading.set(id, p);
    return p;
  }

  private applyChannel(id: Inst, ramp = 0.8) {
    const ch = this.channels.get(id);
    if (!ch) return;
    const s = INST[id];
    const sp = this.params.space;
    // Intimate: a small bright room. Vast: a long dark hall and echoes.
    ch.room.gain.rampTo(s.room * (0.55 - sp * 0.4), ramp);
    ch.hall.gain.rampTo(s.hall * (0.06 + sp * sp * 0.75), ramp);
    ch.echo.gain.rampTo(s.echo * Math.max(0, sp - 0.3) * 0.9, ramp);
    const lofi = this.style === 'lofi';
    const darkInst = lofi && id !== 'upright' && id !== 'ebass' ? 0.85 : 1;
    ch.filter.frequency.rampTo(Math.min(20000, s.lp * darkInst * (0.8 + this.params.mood * 0.4)), ramp);
  }

  /** Apply the sliders to the sound right away (the composition follows from the next bar). */
  setParams(p: Params) {
    this.params = { ...p };
    this.applyGlobal(1.2);
  }

  private applyGlobal(ramp: number) {
    const f = FLAVOR[this.style];
    const m = this.params.mood;
    this.tone.frequency.rampTo(f.lpDark * Math.pow(f.lpBright / f.lpDark, m), ramp);
    this.lowShelf.gain.rampTo((1 - m) * 1.5, ramp);
    this.wow.depth.rampTo(f.wow, ramp);
    for (const id of this.channels.keys()) this.applyChannel(id, ramp);
  }

  private setStyle(style: Style, tempo: number) {
    if (style === this.style && this.running) return;
    this.style = style;
    this.shaper.curve = tanhCurve(FLAVOR[style].drive);
    this.applyGlobal(2);
    // Dotted-eighth echoes in time with the piece.
    this.echoBus.delayTime.rampTo(Math.min(1.5, (60 / tempo) * 0.75), 0.5);
  }

  async start(at?: number) {
    // Every start begins a fresh piece with its intro.
    if (this.composer.current) this.composer.skip();
    const first = this.composer.next(this.params);
    const piece = this.composer.current!;
    const needed = instrumentsOf(piece.arr);
    await this.ensure(this.o.offline ? ALL_INSTS : needed);
    const now = at ?? Tone.now();
    this.running = true;
    this.setStyle(piece.arr.style, piece.tempo);
    this.transport.cancel(0);
    this.transport.position = 0;
    this.transport.bpm.value = this.tempoFor(first);
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.o.offline ? OUTPUT : 0, now);
    if (!this.o.offline) this.out.gain.linearRampToValueAtTime(OUTPUT, now + 0.6);
    this.scheduleBar(first, 0);
    this.transport.start(now + 0.05);
    if (!this.o.offline) {
      // Fetch the rest in the background so later pieces never wait.
      void this.ensure(ALL_INSTS);
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const now = Tone.now();
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 0.8);
    setTimeout(() => {
      if (this.running) return;
      this.transport.stop();
      this.transport.cancel(0);
      for (const ch of this.channels.values()) ch.voice.release();
      this.composer.skip();
    }, 900);
  }

  private tempoFor(bar: Bar) {
    return this.tempoOverride ? this.tempoOverride * (bar.tempo / bar.baseTempo) : bar.tempo;
  }

  private scheduleBar(bar: Bar, startTick: number) {
    if (bar.bar === 0 && !bar.gap) {
      const piece = this.composer.current!;
      this.transport.scheduleOnce((time) => {
        // New piece: switch mastering colour during the gap's tail.
        this.setStyleAt(piece.arr.style, piece.tempo, time);
      }, `${startTick}i`);
    }
    this.transport.scheduleOnce((time) => {
      if (!this.running) return;
      const bpm = this.tempoFor(bar);
      this.currentTempo = bpm;
      this.glideTempo(bpm, bar.beats, time);
      this.o.onBar?.(bar);
      const next = this.composer.next(this.params);
      this.scheduleBar(next, startTick + Math.round(bar.beats * PPQ));
    }, `${startTick}i`);
    for (const e of bar.events) {
      const tick = Math.max(startTick, startTick + Math.round(e.time * PPQ));
      this.transport.scheduleOnce((time) => this.play(e, time), `${tick}i`);
    }
  }

  /**
   * Move toward the bar's tempo in per-beat steps. (Tone's ramped tempo math is numerically
   * unstable for small changes, so we avoid ramps on the transport entirely.)
   */
  private glideTempo(target: number, beats: number, time: number) {
    const from = this.transport.bpm.getValueAtTime(time);
    if (Math.abs(target - from) < 0.05) return;
    let t = time;
    const steps = Math.max(1, Math.min(beats, Math.ceil(Math.abs(target - from) / 0.4)));
    for (let k = 1; k <= steps; k++) {
      const v = from + ((target - from) * k) / steps;
      this.transport.bpm.setValueAtTime(v, t);
      t += 60 / v;
    }
  }

  private setStyleAt(style: Style, tempo: number, time: number) {
    if (this.o.offline) this.setStyle(style, tempo);
    else setTimeout(() => this.setStyle(style, tempo), Math.max(0, (time - Tone.now()) * 1000));
  }

  private play(e: NoteEvent, time: number) {
    const ch = this.channels.get(e.inst);
    if (!ch) {
      void this.channel(e.inst);
      return;
    }
    const sec = (e.dur * 60) / this.transport.bpm.value;
    ch.voice.play(e.midi, Math.max(0.05, sec), time, e.vel, e.hit);
  }

  dispose() {
    this.transport.cancel(0);
    this.transport.stop();
    for (const ch of this.channels.values()) {
      ch.voice.dispose();
      for (const n of [ch.input, ch.filter, ch.out, ch.room, ch.hall, ch.echo, ...ch.extra]) n.dispose();
    }
    for (const n of [this.master, this.tone, this.lowShelf, this.wow, this.leveler, this.shaper, this.comp, this.limiter, this.out, this.roomBus, this.hallBus, this.echoBus, this.echoTone]) n.dispose();
    this.meter?.dispose();
  }
}

export function instrumentsOf(arr: { melody: Inst[]; counter?: Inst; comp?: { inst: Inst }; bass?: { inst: Inst }; pad?: Inst; texture?: { inst: Inst }; drums?: unknown }): Inst[] {
  const s = new Set<Inst>(arr.melody);
  if (arr.counter) s.add(arr.counter);
  if (arr.comp) s.add(arr.comp.inst);
  if (arr.bass) s.add(arr.bass.inst);
  if (arr.pad) s.add(arr.pad);
  if (arr.texture) s.add(arr.texture.inst);
  if (arr.drums) s.add('drums');
  return [...s];
}
