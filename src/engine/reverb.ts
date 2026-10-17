import * as Tone from 'tone';

export interface ReverbShape {
  seconds: number; // length of the impulse
  rt60: number; // decay time
  predelay: number; // seconds
  brightness: number; // starting lowpass in Hz; the tail darkens from here
  darkening: number; // end lowpass in Hz
  early: number; // level of early reflections
  seed: number;
}

/**
 * A synthetic stereo impulse response: sparse early reflections, then decorrelated noise
 * whose decay and high-frequency damping evolve over time, like air and walls absorbing treble.
 */
export function makeImpulse(shape: ReverbShape): AudioBuffer {
  const ctx = Tone.getContext();
  const sr = ctx.sampleRate;
  const len = Math.floor(shape.seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  let s = shape.seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
  const pre = Math.floor(shape.predelay * sr);
  const decay = Math.log(1000) / shape.rt60; // amplitude e-folding for 60 dB
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // Early reflections: a handful of taps in the first ~80 ms.
    for (let i = 0; i < 14; i++) {
      const t = 0.004 + Math.pow(rnd() * 0.5 + 0.5, 1.6) * 0.075;
      const idx = pre + Math.floor(t * sr);
      if (idx < len) d[idx] += rnd() * shape.early * Math.exp(-t * 18);
    }
    let lp = 0;
    let lp2 = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const frac = Math.min(1, t / shape.rt60);
      const fc = shape.brightness * Math.pow(shape.darkening / shape.brightness, frac);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (rnd() - lp);
      lp2 += a * (lp - lp2);
      // Soft onset so the tail swells in rather than clicks.
      const onset = Math.min(1, t / 0.02);
      d[i] += lp2 * Math.exp(-decay * t) * onset * 2.2;
    }
    // Fade the very end to avoid truncation.
    const fade = Math.floor(0.2 * sr);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  // Normalize energy so different shapes sit at a similar level.
  let e = 0;
  for (let ch = 0; ch < 2; ch++) for (const x of buf.getChannelData(ch)) e += x * x;
  // Unit energy per channel: a send of 1 gives a wet signal about as loud as the dry one.
  const g = 1 / Math.sqrt(e / 2);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}
