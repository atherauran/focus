import * as Tone from 'tone';
import type { DrumHit, Inst } from '../composer/types';
import sampleMap from './sampleMap.json';

type Layers = Record<string, Record<string, string>>;
const MAP = sampleMap as Record<string, Layers>;

const base = () => `${import.meta.env?.BASE_URL ?? '/'}samples/`;

/** Decoded buffers are context-independent, so one cache serves live and offline rendering. */
const cache = new Map<string, Promise<Tone.ToneAudioBuffer>>();
function load(path: string): Promise<Tone.ToneAudioBuffer> {
  let p = cache.get(path);
  if (!p) {
    p = Tone.ToneAudioBuffer.fromUrl(base() + path);
    cache.set(path, p);
  }
  return p;
}

export async function loadLayers(id: string): Promise<Record<string, Record<string, Tone.ToneAudioBuffer>>> {
  const layers = MAP[id];
  const out: Record<string, Record<string, Tone.ToneAudioBuffer>> = {};
  await Promise.all(
    Object.entries(layers).map(async ([layer, notes]) => {
      out[layer] = {};
      await Promise.all(Object.entries(notes).map(async ([note, path]) => (out[layer][note] = await load(path))));
    }),
  );
  return out;
}

export interface Voice {
  output: Tone.ToneAudioNode;
  play(midi: number, dur: number, time: number, vel: number, hit?: DrumHit): void;
  release(time?: number): void;
  dispose(): void;
}

// Perceived dynamics: velocity 0..1 to gain.
const velGain = (v: number) => Math.pow(Math.max(0, Math.min(1, v)), 1.5);

interface SamplerOpts {
  attack?: number;
  release?: number;
  /** velocity threshold between two recorded layers */
  split?: number;
}

/** A multi-sampled instrument with optional velocity layers. */
export class SampledVoice implements Voice {
  output = new Tone.Gain(1);
  private layers: Tone.Sampler[] = [];

  constructor(buffers: Record<string, Record<string, Tone.ToneAudioBuffer>>, private o: SamplerOpts) {
    const mk = (urls: Record<string, Tone.ToneAudioBuffer>) =>
      new Tone.Sampler({ urls, attack: o.attack ?? 0, release: o.release ?? 0.8, curve: 'exponential' }).connect(this.output);
    for (const n of Object.keys(buffers).sort()) this.layers.push(mk(buffers[n]));
  }

  play(midi: number, dur: number, time: number, vel: number) {
    const f = Tone.mtof(midi as Tone.Unit.MidiNote);
    const layer = this.layers.length > 1 && vel > (this.o.split ?? 0.6) ? this.layers[1] : this.layers[0];
    layer.triggerAttackRelease(f, dur, time, velGain(vel));
  }

  release(time?: number) {
    for (const l of this.layers) l.releaseAll(time);
  }

  dispose() {
    for (const l of this.layers) l.dispose();
    this.output.dispose();
  }
}

const PAD_ENV = { attack: 1.6, decay: 2, sustain: 0.75, release: 3.5 };
const PAD_DETUNE = [-8, 0, 8]; // cents
const PAD_OSC_GAIN = Tone.dbToGain(-9.3);
// Tone's 'sine' attack curve.
const SINE_IN = Array.from({ length: 128 }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / 127)));

/** Band-limited sawtooth starting at the given phase (same partials as Tone's oscillator). */
function sawWave(ctx: Tone.BaseContext, phase: number) {
  const n = 2048;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    const b = (2 / (k * Math.PI)) * (k & 1 ? 1 : -1);
    real[k] = -b * Math.sin(phase * k);
    imag[k] = b * Math.cos(phase * k);
  }
  return ctx.createPeriodicWave(real, imag);
}

/**
 * Warm analog-style pad (also used for low drones): three detuned saws per note, the same
 * sound as Tone's fatsawtooth synth but built from bare oscillators with fixed pitch, which
 * costs a fraction of the CPU.
 */
export class PadVoice implements Voice {
  output = new Tone.Gain(1);
  private filter: Tone.Filter;
  private chorus: Tone.Chorus;
  private lfo: Tone.LFO;
  private waves: PeriodicWave[];
  private notes = new Set<Tone.Gain>();

  constructor() {
    this.chorus = new Tone.Chorus({ frequency: 0.35, delayTime: 4.5, depth: 0.6, spread: 160, wet: 0.6 }).connect(this.output);
    this.chorus.start();
    this.filter = new Tone.Filter({ frequency: 900, type: 'lowpass', rolloff: -24, Q: 0.4 }).connect(this.chorus);
    this.lfo = new Tone.LFO({ frequency: 0.07, min: 650, max: 1300 }).connect(this.filter.frequency);
    this.lfo.start();
    this.waves = [0, 120, 240].map((deg) => sawWave(this.output.context, (deg * Math.PI) / 180));
  }

  play(midi: number, dur: number, time: number, vel: number) {
    const ctx = this.output.context;
    const env = new Tone.Gain({ context: ctx, gain: 0 }).connect(this.filter);
    const peak = velGain(vel) * PAD_OSC_GAIN;
    const { attack, decay, sustain, release } = PAD_ENV;
    env.gain.setValueCurveAtTime(SINE_IN, time, attack, peak);
    env.gain.exponentialApproachValueAtTime(peak * sustain, time + attack, decay);
    env.gain.targetRampTo(0, release, time + dur);
    const freq = Tone.mtof(midi as Tone.Unit.MidiNote);
    this.waves.forEach((wave, i) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = freq;
      osc.detune.value = PAD_DETUNE[i];
      osc.connect(env.input);
      osc.start(time);
      osc.stop(time + dur + release);
      if (i === 0) osc.onended = () => (this.notes.delete(env), env.dispose());
    });
    this.notes.add(env);
  }

  release(time = this.output.context.currentTime) {
    for (const env of this.notes) env.gain.targetRampTo(0, PAD_ENV.release, time);
  }

  dispose() {
    for (const env of this.notes) env.dispose();
    this.filter.dispose();
    this.lfo.dispose();
    this.chorus.dispose();
    this.output.dispose();
  }
}

const KIT: Record<string, string[]> = {
  kick: ['kick1', 'kick2', 'kick3'],
  snare: ['snare1', 'snare2', 'snare3'],
  xstick: ['xstick1', 'xstick2'],
  hat: ['hat1', 'hat2', 'hat3'],
  hatfoot: ['hatfoot'],
  hatopen: ['hatopen'],
  ride: ['ride1', 'ride2'],
  bell: ['bell'],
  shaker: ['shaker1', 'shaker2'],
};

const PAN: Partial<Record<DrumHit, number>> = { hat: 0.28, hatfoot: 0.22, hatopen: 0.28, ride: -0.3, bell: -0.3, shaker: 0.35, snare: -0.05, xstick: -0.08, brush: -0.05, swish: 0 };
const TRIM: Partial<Record<DrumHit, number>> = { kick: 1, snare: 0.5, xstick: 0.55, hat: 0.32, hatfoot: 0.35, hatopen: 0.25, ride: 0.3, bell: 0.22, shaker: 0.22 };

/** Sampled kit with round-robin, plus synthesized brushes. */
export class DrumVoice implements Voice {
  output = new Tone.Gain(1);
  private buses = new Map<DrumHit, Tone.Panner>();
  private rr = 0;
  private swish: Tone.NoiseSynth;
  private tap: Tone.NoiseSynth;

  constructor(private buffers: Record<string, Tone.ToneAudioBuffer>) {
    for (const [hit, pan] of Object.entries(PAN) as [DrumHit, number][]) {
      this.buses.set(hit, new Tone.Panner(pan).connect(this.output));
    }
    this.buses.set('kick', new Tone.Panner(0).connect(this.output));
    // Brush circles: soft band-limited noise swells. Taps: short bright bursts.
    const swishBand = new Tone.BiquadFilter({ frequency: 3200, type: 'bandpass', Q: 0.6 }).connect(this.buses.get('swish')!);
    this.swish = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.09, decay: 0.32, sustain: 0, release: 0.12 } }).connect(swishBand);
    const tapBand = new Tone.BiquadFilter({ frequency: 4200, type: 'bandpass', Q: 0.9 }).connect(this.buses.get('brush')!);
    this.tap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 0.11, sustain: 0, release: 0.05 } }).connect(tapBand);
  }

  private last = { swish: -1, tap: -1 };

  play(_m: number, dur: number, time: number, vel: number, hit?: DrumHit) {
    if (!hit) return;
    // The brush synths are monophonic: hits closer than a flam are merged.
    if (hit === 'swish') {
      if (time - this.last.swish < 0.03) return;
      this.last.swish = time;
      this.swish.triggerAttackRelease(Math.min(dur, 0.4), time, velGain(vel) * 0.55);
      return;
    }
    if (hit === 'brush') {
      if (time - this.last.tap < 0.03) return;
      this.last.tap = time;
      this.tap.triggerAttackRelease(0.06, time, velGain(vel) * 0.7);
      this.oneShot('snare', 'snare1', time, vel * 0.35, 0.6);
      return;
    }
    const names = KIT[hit];
    if (!names) return;
    // Softer hits use the softer recordings (they're ordered by dynamic).
    const name = hit === 'kick' || hit === 'snare' ? names[Math.min(names.length - 1, Math.floor(vel * names.length * 0.9))] : names[this.rr++ % names.length];
    this.oneShot(hit, name, time, vel, hit === 'ride' || hit === 'bell' ? 3.5 : hit === 'hatopen' ? 1.2 : 0.9);
  }

  private oneShot(hit: DrumHit, name: string, time: number, vel: number, len: number) {
    const buf = this.buffers[name];
    if (!buf) return;
    const src = new Tone.ToneBufferSource({ context: this.output.context, url: buf, fadeOut: 0.05, curve: 'exponential' }).connect(this.buses.get(hit)!);
    src.onended = () => src.dispose();
    src.start(time, 0, len, velGain(vel) * (TRIM[hit] ?? 0.5));
  }

  release() {}

  dispose() {
    this.swish.dispose();
    this.tap.dispose();
    for (const b of this.buses.values()) b.dispose();
    this.output.dispose();
  }
}

/** Per-instrument sound: level, tone and how much room each sends. */
export interface InstSpec {
  gain: number; // dB
  lp: number; // channel lowpass Hz
  hp: number;
  pan: number;
  room: number;
  hall: number;
  echo: number;
  attack?: number;
  release?: number;
  split?: number;
  trem?: { freq: number; depth: number };
}

export const INST: Record<Inst, InstSpec> = {
  piano: { gain: -7, lp: 16000, hp: 30, pan: 0, room: 0.5, hall: 0.85, echo: 0, release: 1.1, split: 0.55 },
  rhodes: { gain: -9, lp: 10000, hp: 45, pan: 0, room: 0.5, hall: 0.7, echo: 0.1, release: 0.7, split: 0.45, trem: { freq: 4.2, depth: 0.28 } },
  upright: { gain: -9, lp: 2400, hp: 32, pan: 0.05, room: 0.35, hall: 0.18, echo: 0, release: 0.25 },
  ebass: { gain: -10, lp: 1600, hp: 32, pan: 0, room: 0.25, hall: 0.12, echo: 0, release: 0.2 },
  nylon: { gain: -8, lp: 11000, hp: 70, pan: -0.18, room: 0.5, hall: 0.6, echo: 0.05, release: 0.6 },
  jazzgtr: { gain: -9, lp: 6500, hp: 90, pan: 0.18, room: 0.55, hall: 0.6, echo: 0.15, release: 0.35 },
  flute: { gain: -12, lp: 9000, hp: 200, pan: 0.12, room: 0.45, hall: 1, echo: 0.25, attack: 0.03, release: 0.35 },
  vibes: { gain: -11, lp: 9000, hp: 120, pan: 0.15, room: 0.5, hall: 1, echo: 0.2, release: 1.2, split: 0.5, trem: { freq: 5.2, depth: 0.18 } },
  bowedvibes: { gain: -15, lp: 7000, hp: 150, pan: 0, room: 0.3, hall: 1.3, echo: 0, attack: 0.35, release: 2.2 },
  glock: { gain: -17, lp: 10000, hp: 400, pan: -0.1, room: 0.4, hall: 1.2, echo: 0.35, release: 1.6 },
  harp: { gain: -10, lp: 9000, hp: 60, pan: -0.15, room: 0.45, hall: 1.05, echo: 0.1, release: 1.4 },
  pad: { gain: -18, lp: 6000, hp: 40, pan: 0, room: 0.2, hall: 1.3, echo: 0 },
  drums: { gain: -8, lp: 16000, hp: 30, pan: 0, room: 0.6, hall: 0.25, echo: 0 },
};

export async function createVoice(id: Inst): Promise<Voice> {
  if (id === 'pad') return new PadVoice();
  const layers = await loadLayers(id);
  if (id === 'drums') return new DrumVoice(layers.main);
  const s = INST[id];
  return new SampledVoice(layers, { attack: s.attack, release: s.release, split: s.split });
}

export const ALL_INSTS = Object.keys(INST) as Inst[];
