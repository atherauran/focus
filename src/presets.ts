import type { History } from './composer/piece';
import type { Params } from './composer/types';

export type PresetId = 'study' | 'reading' | 'coding' | 'sleep' | 'custom';

export const PRESETS: Record<Exclude<PresetId, 'custom'>, Params> = {
  study: { energy: 0.5, mood: 0.6, space: 0.4, complexity: 0.4 },
  reading: { energy: 0.2, mood: 0.45, space: 0.6, complexity: 0.32 },
  coding: { energy: 0.72, mood: 0.45, space: 0.28, complexity: 0.72 },
  sleep: { energy: 0.04, mood: 0.35, space: 0.9, complexity: 0.12 },
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

const HISTORY_KEY = 'focus.history';

/** Recently played arrangements and keys, so a new session doesn't open like the last one. */
export function loadHistory(): History | undefined {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null') as History | null;
    return h && Array.isArray(h.arrangements) && Array.isArray(h.tonics) ? h : undefined;
  } catch {
    return undefined;
  }
}

export function saveHistory(h: History) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* storage unavailable */
  }
}
