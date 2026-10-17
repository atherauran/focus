import { Rng } from './rng';
import { Chord, Key, Quality, chordFamily, isMinorMode, mod12, parseRoman } from './theory';
import type { BarHarmony, Language, Span } from './types';

/*
 * Progressions are written as 8-bar roman-numeral phrases ("|" separates bars, "-" holds the
 * previous chord). A-templates end "open" (leading back to the top); a closing cadence can
 * replace the last two bars. Minor templates use flats relative to the major scale.
 */

type Bank = Record<'major' | 'minor', { A: string[]; B: string[] }>;

const JAZZ: Bank = {
  major: {
    A: [
      'IM7 | vi7 | ii7 | V7 | iii7 | VI7 | ii7 | V7',
      'IM7 | - | iv7 bVII7 | IM7 | vi7 | II7 | ii7 | V7',
      'ii7 | V7 | IM7 | VI7 | ii7 | V7 | iii7 VI7 | ii7 V7',
      'IM7 | I7 | IVM7 | iv7 | iii7 | VI7 | ii7 | V7',
      'IM7 | iii7 | IVM7 | #iv7b5 | iii7 | VI7 | ii7 | V7',
      'IVM7 | iii7 | ii7 | IM7 | IVM7 | iii7 VI7 | ii7 | V7',
      'IM7 | VI7 | ii7 | V7 | IM7 | VI7 | ii7 | V7',
    ],
    B: [
      'IVM7 | - | iv7 | bVII7 | iii7 | VI7 | ii7 | V7',
      'III7 | - | VI7 | - | II7 | - | ii7 | V7',
      'v7 | I7 | IVM7 | - | ii7 | V7 | iii7 VI7 | ii7 V7',
      'bVIM7 | - | bVII7 | - | IM7 | vi7 | ii7 | V7',
      'iii7 | VI7 | vi7 | II7 | ii7 | V7 | IM7 | V7sus',
    ],
  },
  minor: {
    A: [
      'i7 | iv7 | bVII7 | bIIIM7 | bVIM7 | ii7b5 | V7 | i7',
      'i7 | - | iv7 | - | ii7b5 | V7 | i7 | V7',
      'i6 | - | ii7b5 | V7 | i7 | bVI7 | ii7b5 | V7',
      'i7 | bVIM7 | ii7b5 | V7 | i7 | iv7 | bVII7 | bIIIM7',
      'iv7 | bVII7 | bIIIM7 | bVIM7 | ii7b5 | V7 | i7 | -',
      'i7 | iv7 | i7 | bVI7 | i7 | iv7 | ii7b5 | V7',
    ],
    B: [
      'iv7 | bVII7 | bIIIM7 | - | bVIM7 | - | ii7b5 | V7',
      'bVIM7 | - | bVII7 | - | bIIIM7 | bVIM7 | ii7b5 | V7',
      'iv7 | - | i7 | - | bVIM7 | bVII7 | V7sus | V7',
      'bIIIM7 | bVIM7 | ii7b5 | V7 | i7 | iv7 | ii7b5 | V7',
    ],
  },
};

const LOFI: Bank = {
  major: {
    A: [
      'IVM7 | V7 | iii7 | vi7 | IVM7 | V7 | iii7 vi7 | ii7 V7sus',
      'IM7 | vi7 | ii7 | V7sus | IM7 | vi7 | ii7 | V7',
      'ii7 | iii7 | IVM7 | V7sus | ii7 | iii7 | IVM7 | V7sus',
      'IVM7 | iv7 | iii7 | VI7 | ii7 | V7sus | IM7 | -',
      'IM7 | iii7 | IVM7 | iv6 | IM7 | iii7 | IVM7 | iv6',
      'vi7 | IVM7 | IM7 | V7sus | vi7 | IVM7 | IM7 | V7sus',
      'IVM7 | iii7 | vi7 | v7 I7 | IVM7 | iii7 | ii7 | V7sus',
      'IM7 | IVM7 | iii7 | VI7 | ii7 | V7 | IM7 | V7sus',
    ],
    B: [
      'vi7 | iii7 | IVM7 | IM7 | ii7 | iii7 | IVM7 | V7sus',
      'IVM7 | - | iii7 | VI7 | ii7 | - | V7sus | V7',
      'bVIM7 | bVII7 | IM7 | vi7 | bVIM7 | bVII7 | IVM7 | V7sus',
      'ii7 | V7 | IM7 | vi7 | ii7 | V7 | iii7 | VI7',
    ],
  },
  minor: {
    A: [
      'i7 | iv7 | bVII7 | bIIIM7 | bVIM7 | iv7 | V7 | i7',
      'i9 | IV9 | i9 | IV9 | bVIM7 | bVII6 | i9 | V7sus',
      'bVIM7 | bVII7 | i7 | - | bVIM7 | bVII7 | ii7b5 | V7',
      'i7 | bIIIM7 | bVIM7 | V7 | i7 | bIIIM7 | bVIM7 | V7',
      'iv9 | v7 | bVIM7 | bVII6 | iv9 | v7 | bVIM7 | V7',
      'i7 | bVIM7 | iv7 | V7alt | i7 | bVIM7 | iv7 | V7',
    ],
    B: [
      'bVIM7 | - | bVII7 | - | bIIIM7 | bVIM7 | iv7 | V7',
      'iv7 | bVII7 | bIIIM7 | bVIM7 | iv7 | bVII7 | V7sus | V7',
      'bIIIM7 | bVIIadd9 | iv7 | v7 | bIIIM7 | bVIIadd9 | bVIM7 | V7',
    ],
  },
};

const AMBIENT: Bank = {
  major: {
    A: [
      'Iadd9 | - | IVM7/I | - | vi7 | - | IVM7 | -',
      'IM7 | - | iii7 | - | IVM7 | - | IVm6 | -',
      'Iadd9 | - | IIadd9/I | - | IM7 | - | vi7 | -',
      'vi7 | - | IVM7 | - | IM7 | - | V7sus | -',
      'IM7 | - | vi9 | - | IVM7#11 | - | V7sus | -',
      'IVM7 | - | Iadd9/III | - | vi7 | - | V7sus | -',
    ],
    B: [
      'vi7 | - | iii7 | - | IVM7 | - | V7sus | -',
      'IVM7 | - | IVm6 | - | iii7 | - | vi7 | -',
      'bVIIadd9 | - | IVadd9 | - | bVIM7 | - | V7sus | -',
      'ii9 | - | V7sus | - | iii7 | - | vi9 | -',
    ],
  },
  minor: {
    A: [
      'i9 | - | bVIM7 | - | bIIIM7 | - | bVIIadd9 | -',
      'i7 | - | iv7/I | - | bVIM7 | - | v7 | -',
      'i9 | - | bVIM7#11 | - | iv9 | - | i9 | -',
      'bVIM7 | - | bIIIM7 | - | bVIIadd9 | - | i9 | -',
      'i9 | - | IV9/I | - | i9 | - | bVIIadd9 | -',
    ],
    B: [
      'bVIM7 | - | bVII6 | - | iv9 | - | V7sus | -',
      'bIIIM7 | - | bVIIadd9 | - | iv7 | - | v7 | -',
      'iv9 | - | bVIIadd9 | - | bIIIM7 | - | bVIM7 | -',
    ],
  },
};

const FOLK: Bank = {
  major: {
    A: [
      'Iadd9 | V | vi7 | IVadd9 | Iadd9 | V | IVM7 | V7sus',
      'I | iii | IV | I | vi | IV | V7sus | V',
      'vi | IV | I | V | vi | IV | Isus2 | V7sus',
      'IVadd9 | I | V | vi | IVadd9 | I | ii7 | V7sus',
      'I | IV/I | I | V | vi | IV | Isus2 | V',
    ],
    B: [
      'IV | V | iii | vi | IV | V | IVadd9 | V7sus',
      'vi | iii | IV | I | ii7 | IV | V7sus | V',
      'IVadd9 | - | I/III | - | ii7 | - | V7sus | V',
    ],
  },
  minor: {
    A: [
      'i | bVII | bVI | bVII | i | bVII | bVI | V',
      'i | iv | bIII | bVII | bVI | iv | V7sus | V',
      'iadd9 | bVI | bIII | bVII | iadd9 | bVI | iv7 | V7sus',
      'i | bVI | bIII | bVII | i | bVI | iv | V',
    ],
    B: [
      'bVI | bVII | i | - | bVI | bVII | V7sus | V',
      'bIII | bVII | iv | i | bVI | bIII | iv | V7sus',
    ],
  },
};

const BOSSA: Bank = {
  major: {
    A: [
      'IM7 | - | II7 | - | ii7 | bII7 | IM7 | bII7',
      'IM7 | VI7 | ii7 | V7 | iii7 | biii7 | ii7 | bII7',
      'IM7 | - | i7 | IV7 | IM7 | VI7 | ii7 | V7',
      'ii7 | V7 | IM7 | - | ii7 | V7 | IM7 | VI7',
    ],
    B: [
      'IVM7 | - | iv7 | bVII7 | IM7 | VI7 | ii7 | V7',
      'bIIM7 | - | bVII7 | - | i7 | IV7 | ii7 | V7',
      'v7 | I7 | IVM7 | - | iv7 | bVII7 | ii7 | V7',
    ],
  },
  minor: {
    A: [
      'i7 | - | iv7 | - | ii7b5 | V7 | i7 | V7',
      'i6 | - | iv6 | - | ii7b5 | V7b9 | i6 | V7b9',
      'i7 | iv7 | bVII7 | bIIIM7 | bVIM7 | ii7b5 | V7 | -',
    ],
    B: [
      'iv7 | bVII7 | bIIIM7 | bVIM7 | ii7b5 | V7 | i7 | V7',
      'bVIM7 | - | bII7 | - | i7 | iv7 | ii7b5 | V7',
    ],
  },
};

const BANKS: Record<Language, Bank> = { jazz: JAZZ, lofi: LOFI, ambient: AMBIENT, folk: FOLK, bossa: BOSSA };

const CLOSE: Record<Language, Record<'major' | 'minor', string[]>> = {
  jazz: { major: ['ii7 V7 | IM7', 'ii7 V7 | I6'], minor: ['ii7b5 V7 | i7', 'ii7b5 V7 | i6'] },
  bossa: { major: ['ii7 V7 | IM7', 'ii7 bII7 | IM7'], minor: ['ii7b5 V7 | i7', 'ii7b5 V7b9 | i6'] },
  lofi: { major: ['ii7 V7sus | IM7', 'IVM7 iv6 | IM7'], minor: ['iv7 V7 | i7', 'bVIM7 V7 | i7'] },
  ambient: { major: ['IVM7 | Iadd9', 'V7sus | IM7'], minor: ['bVIM7 | i9', 'iv9 | i9'] },
  folk: { major: ['IV V | I', 'IVadd9 V7sus | I'], minor: ['iv V | i', 'bVI V | i'] },
};

/** Parse an 8-bar template into per-bar harmony (equal split inside a bar, "-" ties). */
export function parseProgression(src: string, key: Key, beats: number): BarHarmony[] {
  const bars = src.split('|').map((b) => b.trim().split(/\s+/));
  const out: BarHarmony[] = [];
  let last: Chord | null = null;
  for (const toks of bars) {
    const spans: Span[] = [];
    const n = toks.length;
    // 3/4 with two chords: 2 + 1 beats. 4/4: even split.
    const lens = n === 1 ? [beats] : beats === 3 && n === 2 ? [2, 1] : toks.map(() => beats / n);
    let t = 0;
    toks.forEach((tok, i) => {
      const chord: Chord = tok === '-' ? (last as Chord) : parseRoman(tok, key.tonic);
      spans.push({ start: t, dur: lens[i], chord });
      t += lens[i];
      last = chord;
    });
    out.push(spans);
  }
  return out;
}

const fam = (k: Key) => (isMinorMode(k.mode) ? 'minor' : 'major');

export function pickTemplate(rng: Rng, lang: Language, key: Key, part: 'A' | 'B', avoid?: string): string {
  const list = BANKS[lang][fam(key)][part].filter((t) => t !== avoid);
  return rng.pick(list);
}

export function closingCadence(rng: Rng, lang: Language, key: Key, beats: number): BarHarmony[] {
  return parseProgression(rng.pick(CLOSE[lang][fam(key)]), key, beats);
}

/** Final chord: tonic with a gentle color. */
export function finalChord(rng: Rng, key: Key, lang: Language): Chord {
  const minor = isMinorMode(key.mode);
  const q: Quality = minor
    ? rng.pick(lang === 'folk' ? ['madd9', 'min'] : ['m9', 'm6', 'madd9'] as Quality[])
    : rng.pick(lang === 'folk' ? ['add9', 'maj'] : lang === 'ambient' ? ['add9', 'maj9', 'maj7#11'] : ['maj9', '69', 'maj7'] as Quality[]);
  return { root: key.tonic, q };
}

const same = (a: Chord, b: Chord) => a.root === b.root && a.q === b.q && a.bass === b.bass;

function enrich(c: Chord, rng: Rng, lang: Language, key: Key): Chord {
  const r = rng.next();
  const isTonic = c.root === key.tonic;
  switch (c.q) {
    case 'maj7': return { ...c, q: r < 0.45 ? 'maj9' : isTonic && r < 0.7 ? '69' : !isTonic && c.root === mod12(key.tonic + 5) && r < 0.85 ? 'maj7#11' : 'maj7' };
    case 'm7': return { ...c, q: r < 0.5 ? 'm9' : r < 0.7 && lang !== 'jazz' ? 'm11' : 'm7' };
    case '7': return { ...c, q: r < 0.4 ? '9' : r < 0.7 ? '13' : '7' };
    case 'maj': return { ...c, q: lang === 'folk' || lang === 'ambient' ? (r < 0.5 ? 'add9' : 'maj7') : 'maj9' };
    case 'min': return { ...c, q: lang === 'folk' || lang === 'ambient' ? (r < 0.5 ? 'madd9' : 'm7') : 'm9' };
    default: return c;
  }
}

function simplify(c: Chord, lang: Language): Chord {
  const triadic = lang === 'folk' || lang === 'ambient';
  const map: Partial<Record<Quality, Quality>> = triadic
    ? { maj7: 'maj', maj9: 'add9', 'maj7#11': 'maj', '69': 'maj', '6': 'maj', m7: 'min', m9: 'min', m11: 'min', '9': '7', '13': '7', '7b9': '7', '7alt': '7' }
    : { maj9: 'maj7', 'maj7#11': 'maj7', '69': '6', m9: 'm7', m11: 'm7', '9': '7', '13': '7', '7b9': '7', '7alt': '7', add9: 'maj', madd9: 'min' };
  return { ...c, q: map[c.q] ?? c.q };
}

/**
 * Build the three complexity variants of a passage. The rich version adds passing chords,
 * secondary dominants and tritone substitutions in the places a player would.
 */
export function variants(base: BarHarmony[], rng: Rng, lang: Language, key: Key, beats: number) {
  const simple = base.map((bar) => bar.map((s) => ({ ...s, chord: simplify(s.chord, lang) })));
  const functional = lang === 'jazz' || lang === 'bossa' || lang === 'lofi';
  const rich: BarHarmony[] = base.map((bar, i) => {
    const next = base[i + 1]?.[0]?.chord ?? base[0][0].chord;
    const spans = bar.map((s) => ({ ...s, chord: enrich(s.chord, rng, lang, key) }));
    if (!functional) return spans;
    const last = spans[spans.length - 1];
    const lastFam = chordFamily(last.chord);
    const resolvesDown5 = mod12(last.chord.root - next.root) === 7;
    // Tritone substitution of a resolving dominant.
    if (lastFam === 'dom' && resolvesDown5 && rng.chance(lang === 'lofi' ? 0.2 : 0.4)) {
      last.chord = { root: mod12(last.chord.root + 6), q: rng.chance(0.5) ? '9' : '7' };
      return spans;
    }
    // A one-chord bar can borrow its second half for something that leads into the next bar.
    if (spans.length === 1 && beats === 4 && !same(spans[0].chord, next)) {
      const c = spans[0].chord;
      const half = (chord: Chord): Span[] => [{ start: 0, dur: 2, chord: c }, { start: 2, dur: 2, chord }];
      const nextMinor = chordFamily(next) === 'min' || chordFamily(next) === 'hdim';
      if (c.root === key.tonic && chordFamily(c) === 'maj' && mod12(next.root - key.tonic) === 2 && rng.chance(0.5)) {
        return half({ root: mod12(key.tonic + 1), q: 'dim7' });
      }
      if (lastFam === 'dom' && resolvesDown5 && rng.chance(0.35)) {
        return [{ start: 0, dur: 2, chord: { root: mod12(c.root + 7), q: 'm7' } }, { start: 2, dur: 2, chord: c }];
      }
      if (lastFam !== 'dom' && next.root !== c.root && lang !== 'lofi' && rng.chance(0.3)) {
        return half({ root: mod12(next.root + 7), q: nextMinor ? '7b9' : '7' });
      }
    }
    if (lastFam === 'dom' && resolvesDown5 && chordFamily(next) === 'min' && rng.chance(0.5)) {
      last.chord = { ...last.chord, q: rng.chance(0.5) ? '7b9' : '7alt' };
    }
    return spans;
  });
  return { base, rich, simple };
}

/** Colour a chord by the live mood: darker borrows from minor, brighter from lydian/dorian. */
export function moodColor(c: Chord, key: Key, mood: number, nextRoot: number | null): Chord {
  const deg = mod12(c.root - key.tonic);
  const f = chordFamily(c);
  if (mood < 0.3) {
    if (!isMinorMode(key.mode) && deg === 5 && f === 'maj' && (nextRoot === key.tonic || nextRoot === mod12(key.tonic + 4))) {
      return { ...c, q: 'm6' };
    }
    if (f === 'dom' && deg === 7 && (c.q === '7' || c.q === '9')) return { ...c, q: '7b9' };
    if (f === 'maj' && c.q === 'maj7#11') return { ...c, q: 'maj7' };
  } else if (mood > 0.7) {
    if (isMinorMode(key.mode) && deg === 5 && (c.q === 'm7' || c.q === 'm9')) return { ...c, q: '9' };
    if (!isMinorMode(key.mode) && deg === 5 && c.q === 'maj7') return { ...c, q: 'maj7#11' };
    if (c.q === '7b9' || c.q === '7alt') return { ...c, q: '9' };
  }
  return c;
}
