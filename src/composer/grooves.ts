import data from './grooves.json';
import type { Rng } from './rng';
import type { DrumHit } from './types';

/** A recorded drum performance (Groove MIDI Dataset): bars of [beat, hit, velocity]. */
export interface Groove {
  id: string;
  style: string;
  bpm: number;
  unit: 0.25 | 0.5;
  swing: number;
  bars: [number, number, number][][];
}

export const GROOVES = data as Groove[];
export const GROOVE_HITS: DrumHit[] = ['kick', 'snare', 'xstick', 'hat', 'hatfoot', 'hatopen', 'ride', 'bell'];

/** A performance recorded near this tempo; swung ones are favoured, as lofi leans that way. */
export function pickGroove(rng: Rng, tempo: number): Groove {
  return rng.weighted(GROOVES.map((g) => {
    const t = Math.log(g.bpm / tempo);
    return [g, Math.exp(-(t * t) / 0.02) * (1 + Math.max(0, g.swing - 0.52) * 30) + 1e-4] as const;
  }));
}
