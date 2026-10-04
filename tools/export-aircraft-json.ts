/**
 * Export the aircraft roster (src/data/aircraft.ts) to JSON for the Blender
 * model pipeline. Run: node --experimental-strip-types tools/export-aircraft-json.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIRCRAFT_LIST, bombDimensions } from '../src/data/aircraft.ts';
import { crewStations, stationEye } from '../src/data/crew.ts';
import { COASTLINE, RIVERS, TOWNS } from '../src/data/geography.ts';

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
  engineCount: s.performance.engineCount ?? 1,
  guns: s.guns,
  // Resolved through crew.ts, so the models' EyePoint_<id> empties match the sim's defaults.
  stations: crewStations(s).map((st) => ({ id: st.id, crewIndex: st.crewIndex, guns: st.guns, bombAimer: !!st.bombAimer, eye: stationEye(s, st), posture: st.posture ?? 'standing' })),
  // Sizes from the table the renderer's falling bombs use, so a bomb keeps its size on release.
  bombs: (s.bombs ?? []).map((b) => ({ ...b, ...bombDimensions(b) })),
}));
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`wrote ${data.length} aircraft to ${out}`);

// Geography for the briefing-desk map art (decorative; the approximate
// spring-1917 line is inlined because src/world/frontline.ts has runtime
// imports that plain Node type-stripping can't resolve).
const FRONT_1917: [number, number][] = [
  [51.15, 2.73], [50.95, 2.85], [50.86, 2.95], [50.75, 2.93], [50.62, 2.85], [50.45, 2.8], [50.36, 2.85],
  [50.29, 2.92], [50.2, 3.0], [50.1, 3.1], [49.98, 3.18], [49.85, 3.2], [49.7, 3.15], [49.55, 3.05],
];
writeFileSync(
  resolve(here, 'blender/out/geography.json'),
  JSON.stringify({ towns: TOWNS, rivers: RIVERS.map((r) => ({ name: r.name, points: r.points })), front: FRONT_1917, coast: COASTLINE }),
);
