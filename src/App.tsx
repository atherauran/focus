import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import type { Params } from './composer/types';
import { Engine } from './engine/engine';
import { PRESETS, PRESET_LABEL, PRESET_ORDER, PresetId, loadSaved, save } from './presets';

type Status = 'idle' | 'loading' | 'playing';

const SLIDERS: { key: keyof Params; label: string }[] = [
  { key: 'energy', label: 'Energy' },
  { key: 'mood', label: 'Mood' },
  { key: 'space', label: 'Space' },
  { key: 'complexity', label: 'Complexity' },
];

const valuesFor = (id: PresetId, custom: Params) => (id === 'custom' ? custom : PRESETS[id]);

export default function App() {
  const saved = useRef(loadSaved()).current;
  const [preset, setPreset] = useState<PresetId>(saved.preset);
  const [custom, setCustom] = useState<Params>(saved.custom);
  const [params, setParams] = useState<Params>(valuesFor(saved.preset, saved.custom));
  const [tempo, setTempo] = useState<number | null>(saved.tempo);
  const [liveTempo, setLiveTempo] = useState<number | null>(null);
  const [tuning, setTuning] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const engine = useRef<Engine | null>(null);
  const glow = useRef<HTMLButtonElement>(null);
  const paramsRef = useRef(params);

  useEffect(() => save({ preset, custom, tempo }), [preset, custom, tempo]);

  const apply = useCallback((p: Params) => {
    paramsRef.current = p;
    setParams(p);
    engine.current?.setParams(p);
  }, []);

  const choosePreset = (id: PresetId) => {
    setPreset(id);
    apply(valuesFor(id, custom));
  };

  const onSlider = (key: keyof Params, v: number) => {
    const p = { ...paramsRef.current, [key]: v };
    apply(p);
    setPreset('custom');
    setCustom(p);
  };

  const toggle = useCallback(async () => {
    if (status === 'loading') return;
    if (status === 'playing') {
      engine.current?.stop();
      setStatus('idle');
      return;
    }
    setStatus('loading');
    await Tone.start();
    if (!engine.current) {
      Tone.getContext().lookAhead = 0.2;
      engine.current = new Engine({
        seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
        params: paramsRef.current,
        onBar: () => setLiveTempo(Math.round(engine.current!.currentTempo)),
      });
    }
    engine.current.tempoOverride = tempo;
    engine.current.setParams(paramsRef.current);
    await engine.current.start();
    setStatus('playing');
  }, [status, tempo]);

  useEffect(() => {
    if (engine.current) engine.current.tempoOverride = tempo;
  }, [tempo]);

  // Space toggles playback (unless typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
      e.preventDefault();
      void toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // OS media controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Focus' });
    navigator.mediaSession.setActionHandler('play', () => status !== 'playing' && void toggle());
    navigator.mediaSession.setActionHandler('pause', () => status === 'playing' && void toggle());
    navigator.mediaSession.playbackState = status === 'playing' ? 'playing' : 'paused';
  }, [status, toggle]);

  // The button breathes with the music.
  useEffect(() => {
    if (status !== 'playing') {
      glow.current?.style.setProperty('--glow', '0');
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const m = engine.current?.meter?.getValue();
      const v = typeof m === 'number' ? m : 0;
      smooth += (Math.min(1, v * 3) - smooth) * 0.08;
      glow.current?.style.setProperty('--glow', smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const shownTempo = tempo ?? liveTempo;

  return (
    <main className="app">
      <button
        ref={glow}
        className={`play ${status}`}
        onClick={() => void toggle()}
        aria-label={status === 'playing' ? 'Stop' : 'Play'}
      >
        {status === 'playing' ? (
          <svg viewBox="0 0 24 24" aria-hidden><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden><path d="M9 6.5v11a.6.6 0 0 0 .9.5l8.6-5.5a.6.6 0 0 0 0-1L9.9 6a.6.6 0 0 0-.9.5z" /></svg>
        )}
      </button>

      <section className="sliders">
        {SLIDERS.map(({ key, label }) => (
          <label key={key} className="slider">
            <span>{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={params[key]}
              style={{ '--v': params[key] } as React.CSSProperties}
              onChange={(e) => onSlider(key, Number(e.target.value))}
            />
          </label>
        ))}
      </section>

      <nav className="presets">
        {PRESET_ORDER.map((id) => (
          <button key={id} className={id === preset ? 'on' : ''} onClick={() => choosePreset(id)}>
            {PRESET_LABEL[id]}
          </button>
        ))}
      </nav>

      <div className="tempo">
        {tuning ? (
          <div className="tempo-row">
            <input
              type="range"
              min={50}
              max={140}
              step={1}
              value={shownTempo ?? 80}
              style={{ '--v': ((shownTempo ?? 80) - 50) / 90 } as React.CSSProperties}
              onChange={(e) => setTempo(Number(e.target.value))}
              aria-label="Tempo"
            />
            <span className="bpm">{shownTempo ?? '–'}</span>
            <button
              className={`auto ${tempo === null ? 'on' : ''}`}
              onClick={() => setTempo(tempo === null ? (shownTempo ?? 80) : null)}
            >
              auto
            </button>
            <button className="close" onClick={() => setTuning(false)} aria-label="Close">×</button>
          </div>
        ) : (
          <button className="bpm-readout" onClick={() => setTuning(true)}>
            {shownTempo ? `${shownTempo} bpm` : 'tempo'}
          </button>
        )}
      </div>
    </main>
  );
}
