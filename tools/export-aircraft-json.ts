/**
 * Export the aircraft roster (src/data/aircraft.ts) to JSON for the Blender
 * model pipeline. Run: node --experimental-strip-types tools/export-aircraft-json.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIRCRAFT_LIST } from '../src/data/aircraft.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'blender/out/aircraft.json');
mkdirSync(dirname(out), { recursive: true });
const data = AIRCRAFT_LIST.map((s) => ({
  id: s.id,
  name: s.name,
  nation: s.nation,
  role: s.role,
  geometry: s.geometry,
  engineType: s.performance.engineType,
  guns: s.guns,
}));
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`wrote ${data.length} aircraft to ${out}`);
