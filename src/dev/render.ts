// Dev tool: render minutes of Focus offline and post WAV + bar log to the dev server.
// e.g. /render.html?seed=3&minutes=4&energy=.5&mood=.5&space=.5&complexity=.5&solo=piano,drums
import * as Tone from 'tone';
import { Engine, instrumentsOf } from '../engine/engine';
import type { Bar, Inst } from '../composer/types';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const seed = num('seed', 1);
const params = { energy: num('energy', 0.5), mood: num('mood', 0.5), space: num('space', 0.5), complexity: num('complexity', 0.5) };
const seconds = num('minutes', 3) * 60;
const solo = q.get('solo')?.split(',') as Inst[] | undefined;
const name = q.get('name') ?? `s${seed}`;
const log = document.getElementById('log')!;

function wav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, data[c][i]));
    out.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    o += 2;
  }
  return out.buffer;
}

let lastBars: Omit<Bar, 'events'>[] = [];
async function render(file: string, only?: Inst[]) {
  const t0 = performance.now();
  const bars: Omit<Bar, 'events'>[] = [];
  lastBars = bars;
  let used: Inst[] = [];
  // Render synchronously: the async path yields on timers, which hidden tabs throttle.
  const original = Tone.getContext();
  const ctx = new Tone.OfflineContext(2, seconds, 44100);
  Tone.setContext(ctx);
  const engine = new Engine({ seed, params, offline: true, solo: only, onBar: (b) => bars.push({ ...b, events: undefined } as never) });
  await engine.start(0);
  used = instrumentsOf(engine.composer.current!.arr);
  const buffer = await ctx.render(false).catch((e) => {
    const b = bars[bars.length - 1];
    throw new Error(`${e?.stack ?? e} at ${ctx.currentTime.toFixed(2)}s, ${bars.length} bars, last ${JSON.stringify({ p: b?.piece, b: b?.bar, t: b?.tempo, s: b?.section })}`);
  });
  Tone.setContext(original);
  const audio = buffer.get() as AudioBuffer;
  if (q.has('stats')) {
    // Loudness per piece (RMS over the piece, both channels), no audio written.
    const L = audio.getChannelData(0), R = audio.getChannelData(1);
    const pieces: Record<string, { arr: string; sum: number; n: number }> = {};
    let t = 0;
    for (const b of bars) {
      const d = (b.beats * 60) / b.tempo;
      const i0 = Math.floor(t * audio.sampleRate), i1 = Math.min(L.length, Math.floor((t + d) * audio.sampleRate));
      const key = String(b.piece);
      const p = (pieces[key] ??= { arr: b.arrangement, sum: 0, n: 0 });
      if (!b.gap && b.section !== 'intro' && b.section !== 'outro') for (let i = i0; i < i1; i++) { p.sum += L[i] * L[i] + R[i] * R[i]; p.n += 2; }
      t += d;
    }
    const out = Object.values(pieces).filter((p) => p.n).map((p) => ({ arr: p.arr, db: 10 * Math.log10(p.sum / p.n) }));
    await fetch(`/__render?name=${file}.json`, { method: 'POST', body: JSON.stringify({ seed, params, pieces: out }) });
    log.textContent += `\n${file} ${((performance.now() - t0) / 1000).toFixed(1)}s`;
    return used;
  }
  await fetch(`/__render?name=${file}.wav`, { method: 'POST', body: wav(audio) });
  await fetch(`/__render?name=${file}.json`, { method: 'POST', body: JSON.stringify({ seed, params, bars }) });
  log.textContent += `\n${file} ${((performance.now() - t0) / 1000).toFixed(1)}s`;
  return used;
}

// Start after load so the page (and any tool waiting on it) isn't blocked during navigation.
setTimeout(() => void (async () => {
  const used = await render(name, solo);
  if (q.has('stems')) for (const i of used) await render(`${name}-${i}`, [i]);
  document.title = 'done';
})().catch((e) => {
  const b = lastBars[lastBars.length - 1];
  log.textContent = `error after ${lastBars.length} bars, last ${JSON.stringify({ p: b?.piece, b: b?.bar, t: b?.tempo, s: b?.section })} at ${Tone.getContext().currentTime.toFixed(2)}s\n` + (e?.stack ?? e);
  document.title = 'error';
}), 300);
