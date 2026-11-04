/**
 * Extension-escape grid survey (AI_SOAK=extendgrid): two Camels breaking into `extend`
 * head-on, on real flight and combat, over the grids in `testing/extendEncounter.ts`.
 *   AI_SOAK=extendgrid pnpm exec vitest run src/ai/extendGrid.soak.test.ts
 * Prints colliding encounters per grid. AI_EXTEND_OUT=<file> also writes one line per
 * encounter, so two trees' runs can be diffed for cases one clears and the other doesn't.
 * Counts are of a chosen geometry grid, not gameplay collision rates.
 */
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { extendGrids, runExtendEncounter } from './testing/extendEncounter';

const SOAK = (process.env.AI_SOAK ?? '').split(',');
const OUT = process.env.AI_EXTEND_OUT;

describe.skipIf(!SOAK.includes('extendgrid'))('soak: extension escapes', () => {
  it('grid', () => {
    const lines: string[] = [];
    const summary: string[] = [];
    for (const [name, list] of Object.entries(extendGrids())) {
      let hits = 0;
      for (const e of list) {
        const r = runExtendEncounter(e);
        if (r.collisions) hits++;
        lines.push(`${name} ${JSON.stringify(e)} ${r.collisions ? 'COLLIDE' : 'clear'} ${r.minSeparation.toFixed(2)}`);
      }
      summary.push(`${name.padEnd(15)} ${String(hits).padStart(4)} / ${list.length}`);
    }
    if (OUT) writeFileSync(OUT, lines.join('\n') + '\n');
    process.stdout.write(['', 'EXTEND GRID colliding encounters', ...summary, ''].join('\n'));
  }, 3_600_000);
});
