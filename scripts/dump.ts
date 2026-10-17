// Print what the composer writes: `npx tsx scripts/dump.ts [seed] [pieces] [energy mood space complexity]`
import { Composer } from '../src/composer/composer';
import { chordName, NOTE_NAMES } from '../src/composer/theory';
import type { Params } from '../src/composer/types';

const [seed = '1', pieces = '1', e = '0.5', m = '0.5', s = '0.5', c = '0.5'] = process.argv.slice(2);
const params: Params = { energy: +e, mood: +m, space: +s, complexity: +c };
const comp = new Composer(+seed);
const name = (n: number) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

let done = 0;
let lastPiece = -1;
let seconds = 0;
while (done < +pieces) {
  const bar = comp.next(params);
  seconds += (bar.beats * 60) / bar.tempo;
  if (bar.gap) {
    done++;
    console.log(`--- end of piece, ${(seconds / 60).toFixed(2)} min total\n`);
    continue;
  }
  if (bar.piece !== lastPiece) {
    lastPiece = bar.piece;
    const p = comp.current!;
    console.log(`=== piece ${p.index}: ${p.arr.id} (${p.arr.style}) ${NOTE_NAMES[p.key.tonic]} ${p.key.mode} ${p.beats}/4 @${p.tempo}`);
    console.log('    form: ' + p.sections.map((x) => `${x.label}(${x.bars})`).join(' '));
  }
  const mel = bar.events.filter((x) => x.role === 'melody').map((x) => `${name(x.midi)}@${x.time.toFixed(2)}`).join(' ');
  const counts: Record<string, number> = {};
  for (const x of bar.events) counts[x.role] = (counts[x.role] ?? 0) + 1;
  console.log(
    `${String(bar.bar).padStart(3)} ${bar.section.padEnd(6)} ${bar.chords.map((x) => chordName(x.chord)).join(' ').padEnd(16)} ` +
      `${Object.entries(counts).map(([k, v]) => k[0] + v).join(' ').padEnd(26)} ${mel}`,
  );
}
