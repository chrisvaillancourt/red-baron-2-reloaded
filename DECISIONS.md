# Decision log

Significant project decisions, newest at the bottom. Each entry: context,
decision, consequences. Agents append here when they make a call that
another contributor would otherwise have to rediscover.

## D-001 — Platform: browser game in TypeScript + Three.js
**Context.** The goal is a playable modern rebuild of Dynamix's *Red Baron II*
(1997), built by AI agents on macOS, with no asset store or engine licence.
**Decision.** A single-page web game: TypeScript, Three.js (r186) for
WebGL2 rendering, Vite for dev/build, Vitest for unit tests, Playwright for
browser smoke tests and screenshot-driven visual QA. No UI framework: plain
DOM + CSS for menus and HUD.
**Consequences.** Runs with `pnpm dev` and any modern browser; trivially
shareable as static files (`pnpm build`). Sim/campaign logic is pure TS and
testable in Node. We give up native-engine niceties (physics engine, editor).

## D-002 — Stay true to RB2's gameplay pillars
**Decision.** The rebuild keeps what defined RB2:
1. **Career mode** as the heart: German, British, French or American pilot;
   start any date from mid-1915 to late 1918; historical squadrons,
   aircraft availability by date, promotions, medals, wounds, capture, death,
   fame and newspaper notices; the historical aces flying (and dying) on
   their historical schedule, and sometimes appearing in your sky.
2. **Mission variety**: patrols, escort, intercept, balloon busting/defence,
   ground attack, airfield attack, free hunts.
3. **Quick missions / single missions** for instant dogfights against chosen
   types, numbers, skill levels and named aces.
4. **Authentic-feeling flight**: rotary torque, stalls and spins, fragile
   airframes (Albatros lower wing), gun jams, Lewis drum changes, limited
   ammunition — each individually toggleable in realism settings.
5. **Padlock view** and the classic view set (cockpit, chase, fly-by,
   target), time compression, wingman orders, "end flight" when safe.
**Modernisations.** Real-time 3D terrain with streamed LOD, dynamic
lighting/sky/clouds, particle effects; mouse-aim flying option and gamepad
support; relaxed/standard/authentic flight-model presets; autosave; HUD
target cues (toggleable); rebindable keys; procedural audio.

## D-003 — Asset strategy: generated, not sourced
**Decision.** No third-party art. Aircraft 3D models are generated
procedurally by a parametric Blender pipeline (`tools/blender/`, headless
Blender 5.2 via `blender --background`) from `src/data/aircraft.ts` geometry
and exported as glTF binaries to `public/models/`. Liveries/insignia are
applied at runtime (canvas textures) so squadron and personal colours need
no extra files. Menu/briefing art is rendered by Blender to `public/art/`.
Terrain, clouds, effects and ground objects are procedural in Three.js.
Audio is synthesised in WebAudio at runtime (no sample files).
**Consequences.** The repo is self-contained and licence-clean. Model
regeneration is one command. If a GLB is missing the runtime falls back to a
procedural mesh built from the same geometry spec, so the game never blocks
on the art pipeline.

## D-004 — Coordinate frames and units
**Decision.** SI units throughout. World: +X east, +Y up, −Z north; heading 0
= north, clockwise positive. Aircraft body: forward −Z, up +Y, right +X (the
Three.js camera convention, so a camera parented to the aircraft looks
forward). Blender models are authored nose → Blender +Y, top → +Z, right
wing → +X; the glTF exporter's Y-up conversion then yields body frame directly.
**Consequences.** No per-model rotation fixups; physics, rendering and
cameras share one frame.

## D-005 — One real-scale sector of the Western Front
**Decision.** A single theatre at 1:1 scale: Flanders–Artois–Somme, roughly
49.6°N–51.1°N, 1.9°E–3.9°E (~143 × 168 km), equirectangular projection
around Arras (`src/core/geo.ts`). Real towns, rivers, historical aerodromes
and front lines that move with the date (1915 static lines, 1916 Somme,
1917 Hindenburg Line/Arras/Cambrai, 1918 Spring Offensive and Hundred Days).
**Consequences.** Authentic geography and distances (aerodromes 10–25 km
behind the lines) with a manageable world. Squadrons historically based
elsewhere are handled by D-006.

## D-006 — Rebasing squadrons that fought outside the sector
**Decision.** Some iconic units fought elsewhere on the front (e.g. the US
94th "Hat in the Ring" at Toul). For gameplay they are rebased onto sector
aerodromes and flagged `rebased: true` in `src/data/aerodromes.ts`.
**Consequences.** Every nation offers its famous squadrons; the rebasing is
documented rather than hidden.

## D-007 — Parallel development via worktree-isolated agents
**Decision.** Subsystems are built by parallel agents, each in its own git
worktree and owning a disjoint directory. Contracts live in `src/core/` and
are the only shared surface; the lead merges branches into `main`. Agents
commit as they complete work.
**Consequences.** Contract changes require coordination through the lead;
agents stub what they need behind the interfaces rather than editing another
module.

## D-008 — Naming
**Decision.** Working title *Red Baron II: Reloaded*, a non-commercial fan
rebuild. No original Dynamix/Sierra assets, code, or trademarks-as-branding
beyond the title homage.

## D-009 — Audio: pre-rendered synthesis + WebAudio graph, not AudioWorklets
**Context.** D-003 rules out sample files; engine sounds must track rpm for
up to seven aircraft at once without glitching.
**Decision.** Sounds are synthesised in pure TypeScript into buffers at
startup (`src/audio/synthBuffers.ts`), then played through a normal WebAudio
node graph. Engines are pre-rendered exhaust-pulse loops played at
`playbackRate = rpm / 1200`, with per-type profiles (rotary9 / inline6 / v8 /
v12). Doppler is applied as a pitch factor, since WebAudio removed its own.
The master bus ends in a compressor plus soft clipper. Music is original,
written in a small text notation and played by synthesised instruments.
**Consequences.** No AudioWorklet or Blob-URL module loading, so it works
anywhere WebAudio does and the synthesis is unit-testable in Node. Startup
pays about 100 ms to render the flight bank (`warmUp()`). Timbre scales a
little with rpm because the whole loop is resampled, which suits engines.
||||||| 956f402
## D-010 — Historical simplifications in the career data
**Context.** The aircraft roster starts in mid-1915 but lacks several types
squadrons actually flew (SE5, D.H.5, Morane, B.E.2, 1½ Strutter).
**Decision.** Squadron start dates are moved to when a rostered type arrives
(No. 56 Sqn enters play 1 June 1917 with the S.E.5a, skipping its SE5
period; No. 24 Sqn goes from D.H.2 straight to S.E.5a, skipping the D.H.5).
Where a side has no rostered type of a role yet (Allied scouts and two-seaters
before 1916; two-seaters before late 1916/1917), AI flights use the earliest
rostered type of that role as a stand-in. The Lafayette Escadrille (N.124) is
modelled as a US squadron so American careers can begin in 1916; it transfers
to the 103rd Aero on 18 February 1918. JG I's later 1918 moves off-map (the
Marne) are replaced by in-sector fields.
**Consequences.** Every nation/date has a playable squadron; a few squadrons
fly a type a few weeks early or late.

## D-011 — Career consequences are pilot-local
**Decision.** Killing or capturing a historical ace in a career records it in
`CareerPilot.alteredAces` (additive optional field); that ace stops scoring
and never reappears in that career. History otherwise runs on schedule
(aces die on their historical dates). Squadron mates are a deterministic
quarterly roster (seed + squadron + quarter), not persisted individuals.
**Consequences.** No shared "world state" to migrate between careers; mates
turn over every three months rather than tracking individual losses.

## D-012 — Wounds resolve immediately
**Decision.** A wound sets `status: 'hospital'` and `hospitalDays`, and the
career date jumps past the stay at once. The next `generateMission` returns
the pilot to `active`. The UI can show "returned from hospital" while the
status is `hospital`.
