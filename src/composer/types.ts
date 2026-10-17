import type { Chord, Key } from './theory';

export interface Params {
  energy: number; // calm 0 .. lively 1
  mood: number; // dark 0 .. bright 1
  space: number; // intimate 0 .. vast 1
  complexity: number; // simple 0 .. intricate 1
}

export type Inst =
  | 'piano' | 'rhodes' | 'upright' | 'ebass' | 'nylon' | 'jazzgtr' | 'flute'
  | 'vibes' | 'bowedvibes' | 'glock' | 'harp' | 'pad' | 'drums';

export type Role = 'melody' | 'counter' | 'comp' | 'bass' | 'pad' | 'texture' | 'drums';

export type DrumHit =
  | 'kick' | 'snare' | 'xstick' | 'hat' | 'hatfoot' | 'hatopen'
  | 'ride' | 'bell' | 'shaker' | 'brush' | 'swish';

export interface NoteEvent {
  inst: Inst;
  role: Role;
  time: number; // beats from bar start (humanized; may be slightly negative)
  dur: number; // beats
  midi: number; // pitch (unused for drums)
  vel: number; // 0..1 musical dynamic
  hit?: DrumHit;
}

export type Style = 'lofi' | 'jazz' | 'ballad' | 'ambient' | 'bossa' | 'folk' | 'waltz';
export type Language = 'jazz' | 'lofi' | 'ambient' | 'folk' | 'bossa';

export interface Span {
  start: number; // beats within bar
  dur: number;
  chord: Chord;
}

export type BarHarmony = Span[];

export type SectionKind = 'intro' | 'A' | 'B' | 'solo' | 'break' | 'outro';
export type MelodyMode = 'none' | 'theme' | 'themeVar' | 'contrast' | 'improv' | 'sparse';

export interface Section {
  kind: SectionKind;
  label: string;
  bars: number;
  harmony: { base: BarHarmony[]; rich: BarHarmony[]; simple: BarHarmony[] };
  melody: MelodyMode;
  melodyInst: Inst | null;
  intensity: number; // 0..1, the section's place in the piece's dynamic arc
  /** base level per role in this section (0 = out), before energy/space shaping */
  roles: Partial<Record<Role, number>>;
  final?: boolean; // last section: ritardando + fermata
}

export interface Bar {
  piece: number;
  bar: number; // bar index within piece
  beats: number;
  tempo: number; // target bpm for this bar
  baseTempo: number; // the piece's tempo, so a manual tempo can be scaled by tempo/baseTempo
  events: NoteEvent[];
  style: Style;
  arrangement: string;
  section: string;
  chords: Span[];
  key: Key;
  /** true for the silent bar(s) between pieces */
  gap?: boolean;
}
