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

## D-XXX — Front lines as sectioned keyframes, cratering as rasterised history (world)
**Context.** The front must move with the date (campaign, AI, rendering, capture rules) and be queried per frame.
**Decision.** Each historical keyframe is six named sections (Yser, Ypres, French Flanders, Artois, Arras–Cambrai, Somme) sharing joints; dates between keyframes interpolate section by section after arc-length resampling, and quiet periods repeat a keyframe. Queries use a bucketed segment index with pseudo-normal signing. Shell cratering is the max over every line held up to the date (sampled every 10 days through offensives) rasterised once per date into a 250 m grid.
**Consequences.** Offensives move only their sector; ground stays scarred after the front moves on (Somme 1917, Passchendaele 1918). First crater query per date costs ~0.5 s (done in the terrain workers too).

## D-XXX — Terrain: authored relief grid + analytic features, worker-built quadtree LOD (render)
**Decision.** Height is a pure function (coarse hand-authored 0.125° grid, named ridges/hills, carved river valleys with monotonic floors, coast, fBm with no wavelengths under ~500 m, flattened aerodromes) so physics and the mesh agree. Chunks (33×33 + skirts) are generated in a Web Worker pool with per-vertex land-use attributes; a procedural shader draws fields/woods/war zone; a canvas-rasterised mask carries rivers and roads, with true-width ribbons near the camera. Depth uses a reversed-Z buffer (log-depth fallback) for 0.2 m–130 km clip range.
**Consequences.** No texture assets; consistent heights for landing. Visual detail below ~1 m is procedural noise only.

## D-XXX — Clouds as lit billboard puffs, not ray-marching (render)
**Decision.** Cumulus are clusters of soft, sphere-lit billboards on a drifting 3 km grid (nearest-first with distance LOD, back-to-front sorted), plus a noise deck for overcast; entering a cloud raises fog density (white-out) while nearby puffs fade out.
**Consequences.** Cheap and flyable-through at 60 fps; clouds read as soft cotton rather than volumetric towers. A ray-marched layer could replace it later behind the same `CloudLayer` API.

## D-XXX — Flak colour by ground side (render)
**Decision.** `flak-burst` events carry no side; the effects system colours bursts by the side holding the ground beneath (black German "archie" over central ground, white-grey British/French over allied ground).
**Consequences.** Historically plausible with no contract change; a burst fired across the lines would be mis-coloured (rare).
