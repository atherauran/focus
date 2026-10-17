import type { Params } from './composer/types';

export type PresetId = 'study' | 'reading' | 'coding' | 'sleep' | 'custom';

export const PRESETS: Record<Exclude<PresetId, 'custom'>, Params> = {
  study: { energy: 0.45, mood: 0.55, space: 0.45, complexity: 0.5 },
  reading: { energy: 0.28, mood: 0.5, space: 0.55, complexity: 0.4 },
  coding: { energy: 0.62, mood: 0.45, space: 0.35, complexity: 0.62 },
  sleep: { energy: 0.08, mood: 0.4, space: 0.85, complexity: 0.18 },
};

export const PRESET_ORDER: PresetId[] = ['study', 'reading', 'coding', 'sleep', 'custom'];
export const PRESET_LABEL: Record<PresetId, string> = { study: 'Study', reading: 'Reading', coding: 'Coding', sleep: 'Sleep', custom: 'Custom' };

const KEY = 'focus.v1';

export interface Saved {
  preset: PresetId;
  custom: Params;
  tempo: number | null;
}

export function loadSaved(): Saved {
  const fallback: Saved = { preset: 'study', custom: { ...PRESETS.study }, tempo: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Saved>;
    return { ...fallback, ...s, custom: { ...fallback.custom, ...s.custom } };
  } catch {
    return fallback;
  }
}

export function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}
