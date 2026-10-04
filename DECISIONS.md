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

## D-013 — AI flies through the same controls as the player
**Context.** AI pilots could be kinematic (set position/velocity directly) or
fly the real flight model.
**Decision.** AI writes only `ControlInputs`; the same `stepFlight` flies AI and
player aircraft. A layered controller (autopilot → tactics → mission) sits on
top: a bank-to-turn autopilot with a PI loop on measured g, line-of-sight
feed-forward, and stall/terrain protection built only from `FlightState`.
**Consequences.** AI obeys the same performance, stalls, torque and damage as
the player (a D.VII really out-climbs a Camel; a damaged engine really forces
the AI home). Gains need retuning when the flight model changes; the point-mass
test model and robustness tests keep the controller tolerant of that.

## D-014 — Continuous skill scale and period tactics
**Decision.** Skill is a continuous 0..1 value (novice 0, regular 0.35,
veteran 0.7, ace 1) so `enemySkillBias` can shift it. Aircraft are tagged
turn fighters or energy fighters; energy fighters boom-and-zoom, turn fighters
stay in the turn. Aces gain height before engaging and approach two-seaters
from below the observer's gun. Threat assessment weighs aspect (enemy on our
tail vs a head-on pass) so experienced pilots don't break from every nose
pointed their way.

## D-015 — Flight model: calibrated lumped polar in an acceleration-form 6-DOF
**Context.** WWI types must feel distinct and match their history, but full
per-panel aerodynamics with real inertia tensors is hard to tune for 23
aircraft with sparse data.
**Decision.** Forces come from one lumped wing polar per type; moments use
stiffness/damping/authority per unit dynamic pressure derived from the spec's
`rollRate`/`pitchRate`, with physical couplings (torque, gyroscopic
precession, dihedral, adverse yaw) layered on. Three parameters per type
(`cd0`, propeller design speed, power-lapse exponent) are solved so max
speed, climb to 3000 m and ceiling reproduce `performance`; a Vitest suite
flies every aircraft to prove it. The stick commands angle of attack, which
gives natural speed stability, accelerated stalls and g-loads.
**Consequences.** Adding an aircraft needs only historical figures. Handling
is deterministic and cheap (~0.7 µs/step). Two data points were corrected
where the model could not reach them physically: Dr.I climb 7.5 → 8.5 min,
D.VIII max speed 204 → 190 km/h (the 204 km/h figure belongs to a more
powerful engine).

## D-016 — Spins are a latched mode, not emergent inertia coupling
**Decision.** A spin is entered from a stall with yaw rate (authentic: any
uncoordinated stall; standard: only with pro-spin rudder held; relaxed:
never) and holds deep-stall alpha and autorotation until recovery inputs are
held (forward stick + opposite rudder ~1.5 s on authentic).
**Consequences.** Spins are reliable, teachable and recoverable instead of
depending on fragile inertia-coupling tuning.

## D-017 — Combat conventions
**Decision.** Rounds pass through fabric and damage every zone on their path
until the engine stops them; kill credit goes to the last attacker when a loss
(including structural failure, crash or ditching) follows a hit within 30 s;
rear gunners on two-seaters auto-engage with skill-based error (AI may
override the target); archie is generated from the front line, enemy balloons
and AA-gun ground targets rather than placed batteries; `controls.clearJam` is
consumed by the combat system (one hammer blow per press).
**Consequences.** Forced-down victories count as in RB2; mission designers get
flak "for free" near the lines; the input layer only has to set the flag on key
press edges.

## D-018 — Single composition point for subsystems (game layer)
**Context.** Eight subsystems are built in parallel; the flight loop has to
run and be tested before any of them exists.
**Decision.** `src/game/modules.ts` is the only file that binds
implementations, typed by `GameModules` (`src/game/moduleTypes.ts`).
Placeholder implementations live in `src/game/stubs/`. Swapping in a real
module is an import change in one file.
**Consequences.** The loop, input, cameras and mission director are tested
today against stubs; integration is mechanical. Assumed factory shapes that
`src/core/interfaces.ts` does not pin (`createWorldRenderer(canvas, opts)`,
`createAIController(ac, AIControllerOptions)`, `HudHandle`) are documented in
docs/game.md.

## D-019 — Mouse-aim "instructor" is the default mouse mode
**Decision.** Mouse-aim (the player points a reticle; an autopilot banks and
pulls toward it) is the default, with direct-stick and keyboard/gamepad
available. Any key or pad input overrides the instructor instantly and
re-syncs the aim to the nose, so authentic stick flying is never locked out.
**Consequences.** WWI aircraft become approachable to new players while the
flight model underneath stays unchanged; the stub AI reuses the same steering.

## D-020 — Kill confirmation inputs and end-flight rules
**Decision.** The mission director marks a claim *witnessed* when it falls
over friendly lines or a live friendly aircraft is within 3 km, and *shared*
when another friendly also hit the victim; the campaign decides confirmation.
Enemy aircraft forced to land on our side count as victories. "End flight"
requires no enemy within 5 km and friendly ground below; "Abandon mission"
always works but counts as captured over enemy lines. Time compression drops
to ×1 when an enemy is within 4 km.
**Consequences.** Mirrors RB2's "end flight when safe" and period
confirmation practice without exploits (quitting mid-fight over enemy lines).

## D-021 — UI: framework-free DOM, generated period art (UI agent)
**Decision.** Menus and HUD are plain DOM + CSS with tiny helpers (`src/ui/dom.ts`), a
stack router and spatial keyboard/gamepad focus navigation. Visual identity is aged paper,
typewriter text, rubber stamps and brass plaques, all from CSS gradients and inline SVG
noise; insignia, medals/ribbons, squadron badges, pilot portraits and aircraft side
profiles (from `AircraftSpec.geometry`) are generated SVG. System font stacks only.
**Consequences.** No font or image downloads; screens work before Blender art exists.

## D-022 — UI display catalog decoupled from campaign data (UI agent)
**Decision.** The UI names/draws ranks, medals and aces from its own catalog keyed by
expected ids (`src/ui/catalog.ts`), falling back to prettified ids for unknown ones.
The integrator may call `setUiCatalog()` to feed campaign data in.
**Consequences.** UI and campaign could be built in parallel; any id mismatch degrades to
a readable label and a generic medal rather than breaking a screen.

## D-023 — Units follow the pilot's service (UI agent)
**Decision.** `units: 'auto'` shows mph and feet for British and American pilots and
km/h and metres for German and French pilots, as their instruments read.

## D-024 — The flight session builds the UI's HudView directly (UI integration)
**Context.** The game layer had its own `HudFrame` and a stub HUD; the UI
defined `HudView` and a full HUD with pause/end-flight/orders/map cards. An
adapter between two per-frame structs would be dead weight.
**Decision.** `src/game/hudView.ts` builds `HudView` directly; `HudFrame`, the
stub HUD/UI and the game-layer pause/map overlays are deleted. The HUD's
cards are the only in-flight menus; `hud.menuOpen` disables flight input.
"End flight" always asks: safe ends record a return, unsafe ends abandon
(captured over enemy lines). The HUD target box auto-selects the nearest
enemy within 2.5 km when nothing is padlocked or selected. Added optional
`HudView.mouseAim` and key action `wingmenMenu` (O).
**Consequences.** One HUD contract (`src/ui/hud/types.ts`); game-side logic
for targets/threats/waypoints lives in one file.

## D-025 — Campaign data is the source of display names; campaign owns hospital discharge
**Decision.** At boot `app.ts` calls `setUiCatalog(catalogFromCampaignData())`
so ranks, medals and aces display under their campaign ids (the UI's
defaults remain for the mock harness). `CampaignService.returnToDuty(p)`
(additive) discharges a hospitalised pilot; the UI no longer edits pilot
state, which previously advanced the date twice.

## D-026 — AI flies by inverting the sim's control laws
**Context.** The AI autopilot was built as a model-agnostic PID law on a
point-mass stand-in. On the real 6-DOF model (stick commands AoA, roll rate ∝ V)
fixed gains went unstable at high speed (no dive pull-outs, wings shed) and
porpoised when aiming (the nose leads the flight path by the AoA, which grows with
g).
**Decision.** `src/ai` reads `getCoefficients` and inverts the sim's pitch and
roll laws (with pitch-damping lag compensation and small PI trims), caps the aim
gain from dα/dn, and governs dives against the sim's Vne and gLimit. The generic
PID law is kept behind `controlLaw: 'generic'` for the point-mass tests. AI
traits (stall speed and AoA, Vne, gLimit, best-climb speed) come from the sim, not
from separate estimates.
**Consequences.** `src/ai` depends on `src/sim/coefficients` and `stickForAlpha`
(pure modules). Retuning the flight model retunes the AI automatically; changing
the stick laws in `flightModel.ts` requires updating `Autopilot.modelLaw`.
Combat outcomes and landing are tested on the real sim (`realsim.test.ts`).

## D-027 — AI take-off and field landings
**Decision.** Parked aircraft start in phase `takeoff` (level-attitude roll to
1.2 Vs, rotate, climb straight out; wingmen wait 6 s per slot). Landings use a
right-hand pattern when not lined up, a power-off flare that holds heavier types
level until 1.2 Vs, and an aileron/rudder rollout. Flight members land abreast in
lanes 40 m apart, since the fields are open grass.
**Consequences.** Missions can start on the ground (`startOnGround`). The flight
session only needs to set `landed-*` outcomes; `phase === 'landed'` or
`isStoppedOnGround` tells it when.

## D-028 — Front lines as sectioned keyframes, cratering as rasterised history (world)
**Context.** The front must move with the date (campaign, AI, rendering, capture rules) and be queried per frame.
**Decision.** Each historical keyframe is six named sections (Yser, Ypres, French Flanders, Artois, Arras–Cambrai, Somme) sharing joints; dates between keyframes interpolate section by section after arc-length resampling, and quiet periods repeat a keyframe. Queries use a bucketed segment index with pseudo-normal signing. Shell cratering is the max over every line held up to the date (sampled every 10 days through offensives) rasterised once per date into a 250 m grid.
**Consequences.** Offensives move only their sector; ground stays scarred after the front moves on (Somme 1917, Passchendaele 1918). First crater query per date costs ~0.5 s (done in the terrain workers too).

## D-029 — Terrain: authored relief grid + analytic features, worker-built quadtree LOD (render)
**Decision.** Height is a pure function (coarse hand-authored 0.125° grid, named ridges/hills, carved river valleys with monotonic floors, coast, fBm with no wavelengths under ~500 m, flattened aerodromes) so physics and the mesh agree. Chunks (33×33 + skirts) are generated in a Web Worker pool with per-vertex land-use attributes; a procedural shader draws fields/woods/war zone; a canvas-rasterised mask carries rivers and roads, with true-width ribbons near the camera. Depth uses a reversed-Z buffer (log-depth fallback) for 0.2 m–130 km clip range.
**Consequences.** No texture assets; consistent heights for landing. Visual detail below ~1 m is procedural noise only.

## D-030 — Clouds as lit billboard puffs, not ray-marching (render)
**Decision.** Cumulus are clusters of soft, sphere-lit billboards on a drifting 3 km grid (nearest-first with distance LOD, back-to-front sorted), plus a noise deck for overcast; entering a cloud raises fog density (white-out) while nearby puffs fade out.
**Consequences.** Cheap and flyable-through at 60 fps; clouds read as soft cotton rather than volumetric towers. A ray-marched layer could replace it later behind the same `CloudLayer` API.

## D-031 — Flak colour by ground side (render)
**Decision.** `flak-burst` events carry no side; the effects system colours bursts by the side holding the ground beneath (black German "archie" over central ground, white-grey British/French over allied ground).
**Consequences.** Historically plausible with no contract change; a burst fired across the lines would be mis-coloured (rare).

## D-032 — Aircraft model pipeline: one parametric generator, runtime-painted liveries
**Context.** 23 types are needed, each in many squadron and personal colours, and they must stay
in sync with `src/data/aircraft.ts`.
**Decision.** `tools/blender/aircraft_gen.py` builds every type from `AircraftGeometry` plus small
per-type detail tables (tips, spinners, radiators, axle wings, bay counts, Camel hump...). Models
are ~5–7k triangles, ~250 KB GLB, untextured; all fabric/ply/cowling surfaces use six `Livery_*`
materials whose UVs follow a fixed canvas atlas. The UV metres-per-atlas metadata travels as glTF
extras on the root node, so the runtime painter (`src/render/aircraft/livery.ts`) draws round
insignia without knowing the generator's internals. Full contract in `docs/models.md`.
**Consequences.** Any livery (squadron colours, Richthofen red, lozenge, streaked camouflage,
markings) costs no files. Changing geometry is `export-aircraft-json` + `build_models.py`; the
Vitest contract test catches frame/naming regressions. Detail is "good mid-poly", not hero-model.

## D-033 — Visual muzzles and eye points come from the model, ballistics from the spec
**Decision.** `Muzzle_<i>`, `EyePoint` and `Contact_*` nodes are placed by the generator so they
sit on the visible geometry; `GunMount.position` stays authoritative for the sim's bullet origin.
The two differ by at most a few tens of centimetres (the generator clamps muzzles behind the
propeller disc and onto the cowling).

## D-034 — Key art: Cycles with a physical sky at low strength
**Decision.** Menu art is rendered with Cycles (Metal) using the MULTIPLE_SCATTERING sky at
background strength ≈0.07 (the physical sun is otherwise ~4 stops too hot) and the Khronos PBR
Neutral view transform for outdoor scenes (AgX Punchy washes saturated reds to orange at golden
hour). Distance haze on the ground is faked in the terrain shader (camera-distance mix + small
emission) instead of a world volume, and the world shader fades to a haze colour below the horizon.

## D-035 — Browser QA uses the installed Chrome channel
**Context.** `@playwright/test` 1.63 wants Chromium revision 1243; only 1234 is cached locally.
**Decision.** QA scripts launch Playwright with `channel: 'chrome'` (override with `PW_CHANNEL`)
rather than downloading browsers. Tests that need Node built-ins declare minimal ambient types
locally (`src/render/aircraft/node-shim.d.ts`) instead of adding `@types/node`.

## D-036 — Menu screens are composed around the key art (polish-menus)
**Context.** The Blender key art arrived after the menus were designed against CSS
fallbacks. The title's centred-right menu covered the art's hero, the red Dr.I, and at
1280×720 the combat report overflowed and scrolled its header out of view.
**Decision.** The title uses a left column (logo, tagline, menu) over a left-hand scrim,
which leaves the right two-thirds of the art untouched. The debrief combat report is two
columns on landscape screens: claims, stats and objectives on the left, the CO's remarks
on the right. Ceremony and memorial pages get a soft dark pool behind their text.
`dev/walk-menus.mjs` screenshots every screen with real campaign data, for regression
checks.
**Consequences.** Future key art should keep its subject out of the left ~35% of the
frame, or the title layout needs revisiting.

## D-037 — First-run Flying School card instead of an interactive tutorial (polish-menus)
**Context.** RB2 shipped a manual; a modern player expects in-game onboarding, but a
scripted tutorial mission would cut across the game, sim and AI layers.
**Decision.** The first take-off on a browser, while tutorial hints are on, shows a
one-page primer built from the live key bindings. It covers mouse-aim, throttle and blip
switch, guns and jams, padlock, views, and coming home. It can be reopened from the
Flying Manual. The in-flight HUD hint line does the rest.
**Consequences.** It is cheap and always matches the rebinding. Automated flows must
acknowledge the card on a fresh profile (the e2e tests do).

## D-038 — UI sound levels are measured, not guessed (polish-menus)
**Decision.** `dev/measure-ui-audio.mjs` renders every UI sound and music cue through the
real engine into an OfflineAudioContext. The per-sound gains (`UI_GAIN`) keep UI sounds
8–12 dB below the menu music's peaks. At unity gain, confirm and back peaked about 2 dB
above the music on every button press.
**Consequences.** Re-run the script after changing a UI sound's synthesis.

## D-039 — Mouse-aim flies through the AI's model-inverse autopilot (polish-flight)
**Context.** The original mouse-aim instructor (a PD law on nose error) was written before the real
flight model existed. On it, an idealised mouse user crashed, pulled wings off and stalled, holding
the nose within 6° of the aim only 5–30% of the time.
**Decision.** In flight the instructor drives `src/ai`'s `Autopilot` in gun-aim mode, with per-realism
g/margin limits (`INSTRUCTOR` in `src/game/input.ts`), plus a tail-dragger ground mode and a
low-throttle landing mode. Only stick and rudder are taken; throttle and blip stay with the player.
**Consequences.** Real-sim soak across 10 types × 3 levels: no crashes or structural failures, kills in
28/30 duels. The player can't out-fly the instructor's stall protection with the mouse; keys or a
gamepad override it for raw control. The game layer now depends on `src/ai` for this one class.

## D-040 — Spotting dots for distant aircraft (polish-flight)
**Context.** A scout covers ~1 px at 4 km, so the GPU drops it; RB2 players spot dots at miles.
**Decision.** Every aircraft visual carries a fixed-pixel dot (`src/render/aircraft/spotDot.ts`) that
fades in as the model's projected span falls below ~3–7 px and fades out between 3.5 and 9 km.
**Consequences.** Enemies can be spotted and padlocked at RB2-like ranges. Visibility no longer
depends on haze/fog at those ranges; the fade-out stands in for it.

## D-041 — Render-state interpolation between sim steps (polish-flight)
**Decision.** Aircraft poses are blended between the last two 120 Hz steps for drawing
(`src/game/renderInterp.ts`), then restored before audio/HUD/sim run.
**Consequences.** Smooth motion on 120/144 Hz displays, at the cost of up to one sim step (8 ms) of
display latency.

## D-042 — Ground bounce on aircraft materials (polish-flight)
**Context.** The sky environment map is dim below the horizon, so wing undersides seen from the
cockpit rendered near-black.
**Decision.** Aircraft materials add a ground-bounce irradiance term for down-facing normals, driven by
the scene's sun (`patchGroundBounce` in `aircraftVisual.ts`), instead of changing the world renderer's
environment map.
**Consequences.** Undersides read as their doped colours. The fix only affects aircraft; other
down-facing surfaces (hangar eaves, balloons) are unchanged.

## D-043 — Headless SimCore, terrain height cache, and the autoplayer (polish-missions)
**Context.** Mission QA needs hundreds of full missions flown end to end; the browser loop
and any test harness must not drift apart. Profiling showed the analytic terrain
(`terrainHeightAt`, ~20 µs/call) queried by sim, AI look-ahead, bullets and wind on every
step made the flight loop run only ~5x real time — too slow for x8 time compression.
**Decision.** `src/game/simCore.ts` owns world/combat/AI/director and the fixed step; the
browser `FlightSession` and the Node autoplayer (`src/game/autoplay.ts`) both use it. All
flight ground queries go through a tiled bilinear cache (32 m cells, 1 km tiles, LRU),
giving ~200x real time headless with sub-metre error (tested). The autoplayer flies the
player's aircraft with an AI controller and "ends flight" when safe on the way home.
**Consequences.** Balance can be measured, not guessed (docs/game.md "Autoplayer"). Tiles
build lazily (~20 ms each); a renderer-side prefetch could hide the rare hitch.

## D-044 — Mission pacing and fightable odds (polish-missions)
**Context.** The first autoplay survey found first contact at a median 6–7 minutes (enemy
flights spawned 60–360 s late, 9+ km out, heading for a waypoint the player might not be
at), a 44% player death rate per career mission, and gangs of aces.
**Decision.** Enemy spawn delays are computed (`meetDelay`) so flights reach the player's
objective about when he does; the player starts 2–5 km short of the lines. Enemy fighter
numbers are capped at the player's flight size +1 (+2 on 'ace'); generic skill leans
novice/regular; named aces appear less often; flak splinters wound more than they kill;
soft ground targets take fewer hits; ground-attack objective = a third of the targets.
**Consequences.** Contact now comes in ~3–4 sim minutes (half a minute of real time at x8),
and success/death rates are in a playable band (see the table in the final polish report).

## D-045 — Abandoning is an aborted mission, never a safe return (polish-missions)
**Decision.** "Abandon mission" over our lines records `landed-elsewhere` with
`MissionResult.aborted` (always a failure, own CO remark); over enemy lines, capture. A
safe "End flight" (no enemy within 5 km, friendly ground below) remains a normal return.
Every ace lost in a fight is reported in `MissionResult.acesDown` so the campaign retires
him even when someone other than the player brought him down.

## D-046 — Tree and town placement runs in web workers (render)
**Context.** In real flights, building one forested tree cell (~20–45 ms) or one city tile (~100–220 ms) on the main thread caused visible stutters at low altitude.
**Decision.** Placement moved to pure modules (`src/render/treeCells.ts`, `townTiles.ts`) run by `treeWorker.ts`/`townWorker.ts`, the same pattern as terrain chunks. The worker returns packed instance matrices and colours, and results for a stale date or season are dropped. If `Worker` is unavailable, placement falls back to the main thread. `whenReady()` also waits for nearby tree cells and town tiles.
**Consequences.** No hitches over 25 ms in in-game strafing and dogfight runs (previously 180–230 ms spikes).

## D-047 — Patrols are judged on time on station or combat, and objectives resolve early (balance)
**Context.** Patrol success meant reaching the second patrol waypoint, which a fight usually prevented (48% success). Escorts whose charges were all shot down, and intercepts whose targets escaped, kept the flight loitering until the time limit.
**Decision.** New objective kind `patrol-area`: 150 s within 3 km of the patrol line, or the player's flight engaging the enemy (5 hits or a kill). The director fails objectives the moment they become impossible (`objective-failed` event). Escorts also complete early once the charges are back over our lines. When every primary objective is settled and no enemy is within 4 km, a flight whose job was tied to other aircraft or balloons is ordered home; patrols just fly out their route.
**Consequences.** Patrol success is 100% in the survey. Missions end cleanly instead of timing out. `ObjectiveKind` and `GameEvent` gained additive members.

## D-048 — Contact within about two minutes; attack defenders scramble instead of waiting above (balance)
**Context.** Median first contact was 200–460 s of sim time. In quick balloon and ground attacks the defenders were already circling above the targets, so every low-level attacker was bounced (100% player loss for the veteran autoplayer).
**Decision.**
- Career air starts sit 3.5 km behind the lines, lined up with the crossing point.
- Patrol lines are shorter (8 km), with their near end at the crossing point.
- Targets and enemy starts moved closer.
- Intercepts start 3 km behind the interception area.
- Balloon-attack and ground-attack defenders take off low (~500 m above ground). Balloon defenders arrive ~40 s after the attackers, ground-attack defenders ~2 min after (two or three strafing passes).
- The long ferry from the aerodrome remains available as `startOnGround`.

**Consequences.** Median contact is 1.5–2.5 min by mission type, and there's less empty flying.

## D-049 — Low-level attack runs keep their energy and avoid the envelope (balance)
**Context.** The autoplayer showed the attack runs themselves were killing the attackers, not the ground fire.
- A balloon run pulled out at 90 m and flew into the envelope in 3 of 8 missions.
- Each strafing re-attack climbed back to 320 m on the normal 90–160 m ground-margin rule. That, plus 180° pull-through reversals, stalled the aircraft at 12–18 m/s over the enemy's guns.
- Attackers ignored enemy scouts until they were 500 m away and firing.

**Decision.**
- Balloon runs fire from 480 m, break sideways at 160 m in a near-level turn, and every AI aircraft steers clear of envelopes.
- Attack approaches use low-level terrain rules, cap their climb by the airspeed margin, and cap g at 80% of the accelerated-stall load.
- Reversals onto the target are limited to 40° of heading demand per tick, so they become banked turns.
- Strafers break off to fight scouts within 1.5 km, unless already committed to a close run.

**Consequences.**
- Undefended balloon runs flame all three balloons, one pass each.
- Undefended strafes destroy all five targets.
- No balloon collisions in the survey.
- Flak and ground fire now cause a minority of losses: 2 of 40 quick missions.

## D-050 — Rear gunners are less accurate (balance)
**Context.** In career intercepts a single two-seater gunner put 28–40 hits into the veteran autoplayer per sortie. Intercepts succeeded 29% of the time and killed the player in 43%. The gunner aimed with a near-perfect relative-velocity lead and 1.3° of error, however hard either aircraft was manoeuvring.
**Decision.**
- Base error is up about 35% (regular 0.03 rad).
- Range is down 25 m.
- Error grows with the gunner's own aircraft's turn rate and with the target's crossing rate.

**Consequences.** A scout on a steady six still gets punished (the regression tests pass), but a manoeuvring attacker takes 1–5 gunner hits per sortie instead of 30+.

## D-051 — HUD declutter by priority, waypoint on the heading tape (hud-flight)
**Context.** At every mission start and in every fight, the waypoint diamond and its label, the mouse-aim ring, the nose cross, the gun reticle, the target box and threat triangles piled up at screen centre.
**Decision.** A pure rule set (`src/ui/hud/declutter.ts`) with priority target box > aim ring > reticle > nose > waypoint. The waypoint fades to 35% in combat, disappears under a target box, and drops its label near the aim cluster. Its number, name and distance ride a caret on the heading tape instead (pinned to the tape end beyond ±40°). The aim ring and nose cross (or reticle) merge into one hollow amber ring when aligned. It is hollow because your own tracers converge in its middle. The threat ring only shows enemies that are off-screen or dangerous. The target text flips left when the box is right of centre.
**Consequences.** One mark at centre when on target. Waypoint guidance is never lost, because the tape carries it. `HudThreat.onScreen` and `HudWaypoint.bearing` are new optional HUD fields.

## D-052 — Tracer streaks use eye persistence through the camera (hud-flight)
**Context.** From the shooter's cockpit, rounds converge on the aim point, so even a long world-space streak projects to one or two pixels. Tracers read as faint dots and vanished against bright cloud.
**Decision.** Each tracer's tail is where the round was seen about 0.09 s ago, re-projected through the current camera (`camNow · camThen⁻¹`, from a short pose history). Turning therefore smears rounds into a hosepipe curve, as the eye sees it. The tail is clamped to the distance flown, so young rounds trail back to the muzzle. Screen-space end caps give rounds flying straight away a minimum length. Blending is premultiplied "over" with an emissive lift, not additive, so the orange shows against bright sky. Camera cuts (>25 m or >26° in a frame) clear the history.
**Consequences.** In a turning fight, tracers from the cockpit measure 22–42 px long (previously 0–2 px). In level flight they are small glowing points, which is physically honest.

## D-053 — Fokker E.III handling left as is; benchmark made multi-start (hud-flight)
**Context.** Wave 3 reported the E.III at 1–5% on target against a D.H.2. `MOUSEAIM_SEEDS` averaged identical runs, because the sim and AI are deterministic, so single fights were being read as trends.
**Decision.** Seeds above 1 now vary the start geometry. `MOUSEAIM_PAIRS` narrows a soak to chosen matchups. Three changes were measured over 6 starts each and rejected: an instructor-side rudder fine-aim blend (E.III vs N.11 dropped from 5/6 kills to 1/6, and wing failures appeared), roll 0.55 / pitch 0.85 (no gain, time on target fell), and lower instructor `caution` (noise-level changes). The E.III data is unchanged.
**Consequences.** The E.III wins against a Nieuport 11 (5/6 kills at standard) and loses the turning fight to the D.H.2 (1–2 of 6), which is how the Fokker Scourge ended. The real remaining defect, roll dithering on slow rollers, belongs in the autopilot's aim mode (docs/STATUS.md).

## D-054 — Crater grids built in a worker and handed to the main thread (visuals wave 4)
**Context.** The dated crater/freshness history grid (~0.5 s to build) was built lazily on
first query. The terrain workers built their own copies, but on the main thread the first
query came from the effects system classifying a bullet impact, i.e. mid-combat.
**Decision.** `frontline.ts` exposes `craterGridsForDate` / `installCraterGrids` /
`hasCraterGrids`. The renderer's `CraterGridLoader` builds a date's grids in a dedicated
worker whenever it is given a date and installs them on the main thread; `whenReady()` waits
for them behind the loading screen. In Node (tests, autoplayer) there is no worker and the
lazy build still applies.
**Consequences.** No main-thread grid build during flight. Costs ~4 MB of transfer per date,
which is negligible.

## D-055 — Renderer teardown disposes every scene resource (robustness)
**Context.** A 20-flight soak showed every flight leaking its whole
`WebGLRenderer` (live GL context, programs, buffers). three.js registers a
`'dispose'` listener on each geometry/material/texture it uploads, and
`WebGLRenderer.dispose()` doesn't remove them. Resources that outlive a
flight (aircraft model cache, livery canvases, shared materials, three's
module-level DFG LUT) therefore held every past renderer.
**Decision.** `WorldRenderer.dispose()` calls `releaseGpuResources()`
(`src/render/releaseGpu.ts`), which disposes everything reachable from the
scene, including renderer-injected uniforms, and then force-loses the
context. The session disposes the renderer before removing aircraft visuals.
Module caches stay; disposing only drops GPU copies, which three re-uploads
on demand. The livery cache becomes a 48-entry LRU.
**Consequences.** Contexts after N flights: N → 0. Heap levels at ~26 MB.
The next flight pays a re-upload of the shared models, which is negligible.
Any new module-level GPU cache is covered automatically, as long as its
objects are in the scene when the flight ends.

## D-056 — Flight code is a lazily loaded chunk (robustness; amends D-018)
**Context.** The boot bundle was 1.25 MB (370 kB gzip) because menus
statically pulled in the renderer, sim and AI.
**Decision.** The composition point is split. `src/game/modules.ts` binds
the menu half (audio, campaign, UI). `src/game/flightModules.ts` binds the
flight half and is loaded by `createLazyFlightLauncher` on the first flight,
prefetched when the browser goes idle. The flight-in-progress registry lives
in `activeFlight.ts` so error recovery doesn't import the flight chunk.
**Consequences.** Boot bundle 580 kB (180 kB gzip); the flight chunk is
670 kB. D-018's "one file binds everything" becomes two files with a
typed split (`MenuModules` / `FlightOnlyModules`). A static import of
flight-only code from `modules.ts` or `app.ts` would quietly undo the split.

## D-057 — Errors end the flight, never the app (robustness)
**Decision.**
- A frame or setup exception tears the flight down and shows "Flight
  interrupted". Nothing is recorded, and the UI is back.
- Audio exceptions only mute that flight.
- WebGL context loss pauses and resumes on restore. After 8 s without a
  restore, the flight ends as an error.
- Uncaught errors elsewhere get a fatal overlay with "Return to menu", which
  aborts any flight and remounts the UI.

**Consequences.** Recovery never touches saves: a career changes only in
`applyMissionResult`, so an error can't corrupt or double-advance it.

## D-058 — Career saves are read-modify-write with quarantine (robustness)
**Context.** The store rewrote the whole document from memory. A second tab
erased the first tab's new pilots, a record failing validation vanished at
the next save, and a newer build's save would have been downgraded.
**Decision.** Every mutation re-reads storage and changes only its own
pilot. Invalid records are kept verbatim under `quarantined`. A document
whose version is newer than the game's is never written. `migrate()` is the
one place schema upgrades go.
**Consequences.** Safe across tabs and versions. Reads parse storage only
when its text has changed, so repeated `get()` calls stay cheap.

## D-059 — Controllers invert the pitch law through the tail's slipstream (ai-sim wave 5)
**Context.** Low-level AI fights spent 11–12% of engage time in stall recovery, and 19 of 160 aircraft in the low-level survey flew into the ground. Stall onsets showed the autopilot already limiting g to 0.5 with the stick forward, at 1.3–1.6 Vs. The sim's pitch law settles where the *tail* AoA meets the command, and the propeller slipstream lowers the tail AoA under power at low speed. The wing therefore settled 10–30% above the AoA the model-inverse stick asked for, and the "safe" command sat past the stall. The sim's own relaxed stall cap had the same flaw.
**Decision.** `tailPressureRatio(ac, env)` in src/sim (qTail/q̄ for current power and speed). The AI autopilot divides its desired wing AoA by it. The sim scales its relaxed/standard g cap and the relaxed stall cap by the same ratio.
**Consequences.** Seconds stalled in the low-level survey fell from 1,880 s to about 600 s, and ground impacts from 19 to 5–6 (16 seeds, 5 matchups). Nothing is re-tuned: it removes a systematic model mismatch. Any future controller that inverts `stickForAlpha` must divide by the ratio too.

## D-060 — Low-level defence: energy-aware g, faster recovery, level breaks; scissors rejected (ai-sim wave 5)
**Context.** Defended ground attacks killed the veteran autoplayer ~88% of the time: the strafers lose the low, slow fight that follows.
**Decision.**
- **Energy-aware g:** usable g tapers toward 1 as true airspeed approaches ~1.12 Vs, so a scout flies out of a bleeding turn instead of stalling.
- **Recovery:** exits at 1.15 Vs below 400 m (1.25 Vs higher, was 1.35) once the AoA is back inside the margin. It holds up to 1 g near the ground instead of a sinking 0.7 g, and above 600 m it lets the nose drop to regain speed.
- **Level manoeuvres below 350 m AGL:** breaks are flown level, jinks keep little vertical wander, and there are no climbing turns. Energy fighters with a lead extend along the deck toward friendly lines. Flat scissors were implemented and measured worse: the low flight lost 60/160 aircraft with them against 43/160 without, because reversing at low speed hands a better-turning attacker the shot. They were removed.
**Consequences.** Recovery share of engage time is ~4–5% (was ~11.5%). In the survey the low flight loses 40/160 (was 46) and the attackers 59/160 (was 84; mostly fewer attackers flying into the ground).

## D-061 — Wounds before deaths; fewer splinter fires; dodge falling wrecks (ai-sim wave 5)
**Context.** Veteran career deaths ran 25–50%, often an early one-bullet pilot kill. Diagnosis of 17 career missions also found 3 of 7 deaths were mid-air collisions, typically flying into a tumbling wreck the AI no longer "saw".
**Decision.**
- **Pilot hits:** each accumulates 0.22 wound (was 0.34). A hit kills with probability (0.07 + 0.25 × wounds) × severity (was 0.18, then 0.35), and the fifth is certain.
- **Wound effects:** a wounded pilot pulls (−35%) and rolls (−25%) less in the flight model and aims worse as AI. `pilotGTolerance(ac)` (5.5 g → 2.5 g with wounds) is exported for a wound-aware grey-out; the game wires it into the overlay (game wave 6, `src/game/gEffect.ts`).
- **Fires:** flak and ground-fire splinters start fires in proportion to their size.
- **Target spreading:** the AI's penalty for choosing an enemy a flight-mate is already on rose from 0.15 to 0.35.
- **Collision avoidance:** it now covers airborne wrecks, looking ~4 s / 450 m ahead with a wider radius for wrecks.
**Consequences.** Instant kills are rare, and wounded pilots fly home degraded (fate: wounded, hospital). A straight-flying target lasts ~31 s against an ace (was ~24 s).

## D-062 — Mouse-aim fine aiming and a separate instructor stall margin (ai-sim wave 5)
**Context.** Slow rollers (E.III) rocked their wings while tracking a near solution: a 5° error asked for ~35° of bank, and the fine-aim rudder saturated at a 1° error (bang-bang). The instructor passed `caution` as the autopilot's `diveCaution`, which also set the stall margin, so 'relaxed' got the narrowest margin (1.0°).
**Decision.**
- **Fine aim:** within 10° of the aim, the lateral part of the proportional turn demand is softened by 35–60% (more for slower rollers), leaving the line-of-sight feed-forward untouched. The rudder takes up the rest: proportional over ~3° with yaw-rate damping, and sideslip nulling is relaxed so the skid holds.
- **Deadlock fix:** a demand that cancels gravity at large errors ("behind and below") now rolls into a hard descending turn, instead of sitting wings-level.
- **Separate stall margin:** `Autopilot.stallMarginDeg` is separate from `diveCaution`. Instructor presets are relaxed 3.2°, standard 1.8°, authentic 1.3°; AI pilots keep the skill-derived margin.
**Consequences.** E.III bank-rate activity near the aim fell from ~20 to ~14°/s at standard. On relaxed the instructor never stalls a Camel or Albatros in a maximum turn. Standard gives up a little peak turn for a real margin.

## D-063 — Strafers leave early and keep ammunition; RTB flights fight back (ai-sim wave 5)
**Context.** In quick ground attacks against veteran SPADs the autoplayer died or was captured ~88–92% of the time. Traces showed strafers at 23–38 m/s and low, zooming up for another pass, when defenders dived in from ~400 m above. Some had also shot themselves dry before the scouts arrived.
**Decision.**
- **Pass limits:** an attack ends after 3 ground / 4 balloon passes, or when fixed-gun ammunition falls below 45% / 20%.
- **Scouts end it:** between runs, after at least one pass, an enemy scout within 3.5 km ends the attack and the flight heads home at speed.
- **Energy floors:** strafing holds 1.6–1.7 Vs through approach and pull-out and sets up 250 m above the target (was 320 m).
- **Fighting back:** during a voluntary RTB (ordered home, mission or escort complete), a fit fighter engages a scout within 1.2 km that is attacking it or its leader, then resumes the RTB.
**Consequences.** Quick ground attack (12 missions): 25% returned (was 13%), 67% killed + 8% captured, and success fell from 75% to 58%. That is the right trade for a strafer. The mission stays the deadliest quick type: the defenders' height advantage is structural, and softening it belongs to mission balance rather than AI.

## D-064 — Mouse-aim cockpit view leads the aim a little, not all the way (game wave 6)
**Context.** PLAYTEST #4: in mouse-aim mode the cockpit head turned to 0.9× the aim offset, so in hard turns and pulls (aim 40–95° off the nose) the view filled with the upper-wing underside and lost the horizon and airframe. RB2 had a fixed forward cockpit view plus padlock.
**Decision.**
- **Head lead:** toward the aim by about 0.9× a small offset, saturating smoothly (tanh) at an ellipse of ±25° yaw, +12° up and −10° down. Upward lead is smallest because the upper wing fills the view above the nose.
- **Easing:** the lead eases at 4/s (was 30/s), so the view doesn't twitch with the mouse.
- **Unchanged:** free-look (right mouse), snap views and padlock keep the full neck range and their old rates.
- **Aim ring off-screen:** the HUD ring is pinned to the screen edge in its direction (below the heading tape), so the player still sees where the instructor is steering.
- **No setting:** an option for the old full follow was not added. It would need an Options control in src/ui, and nothing asked for the old view.
**Consequences.** In a hard pull (aim 45–49° up) the head sits at 12° up with the nose, struts and horizon in view (was 42° up, all wing). In a 94°-off hard turn it sits at about 12° yaw and 11° pitch (was −103° yaw, 72° pitch). Screenshots are `docs/screenshots/aimlead-*.jpg`, made with `tools/playtest/aim-turn-shots.mjs`.

## D-065 — Time compression also drops low over enemy ground and under fire (game wave 6)
**Context.** Compression only cut out for enemy aircraft within 4 km, so at x4 players dropped to 60–200 m over the trenches under ground fire (PLAYTEST, other observations).
**Decision.** `compressionBlock` (`src/game/timeCompression.ts`) refuses compression, or drops it to x1 with a reason, when:
- an enemy aircraft is within 4 km;
- the player was threatened in the last 8 s: hit, silently damaged by trench fire, a flak burst within 200 m, or an enemy round within 40 m;
- the player is below 300 m AGL over enemy ground, or within 2.5 km of a live enemy ground target (4 km for AA).
**Consequences.** Low strafing runs and balloon attacks fly at x1 automatically. High transit over the lines is still compressible until flak bursts close.

## D-066 — Early-war two-seaters: B.E.2c, F.E.2b, Farman F.40, Albatros C.III (models wave 6; amends D-010)
**Context.** The roster had no two-seater before the Rumpler C.IV (Jan 1917) and R.E.8 (Nov 1916), so 1915–16 escorts and intercepts flew those types a year early (PLAYTEST #15).
**Decision.**
- **Four AI types, historically specified:** the B.E.2c (Apr 1915 – Jun 1917), the F.E.2b (Jan 1916 – Aug 1917, day operations), the Farman F.40 (Sep 1915 – Mar 1917) and the Albatros C.III (Dec 1915 – Jun 1917). The Farman was chosen over the Caudron G.4 because it is single-engined, like everything else the flight model and generator handle.
- **Crew positions:**
  - The B.E.2c observer sits in front, under the upper wing.
  - The pusher observers ride in the nose.
  - The C.III observer sits behind the pilot, with a fixed Spandau for the pilot as on later machines.
  - The British and French types carry an early 47-round Lewis drum.
- **Pusher nose gunner:** a new field of fire, open ahead and below and blanked aft by the engine and propeller except high over the top wing. It is `gunnerFacesForward`/`observerForward` in `src/sim/hitboxes.ts`. The AI's gunner watches that cone instead of the tail, and crew hit boxes follow each seat.
- **Escorts guard their own nation:** a French career escorts Farmans and a British one escorts B.E.2cs or F.E.2bs.
- **The one remaining stand-in:** German two-seaters before December 1915 use the C.III, and briefings then name it generically ("observation two-seaters", `chargeNames`).
**Consequences.** All 1916 escorts and intercepts now fly types that were in service. The Farman keeps a single fin and rudder, and its booms converge less than the F.E.2b's; it is not an exact copy of any one sub-type.

## D-067 — Trenches drawn as energy-conserving lines; woods mottled, not ink (render wave 6)
**Context.** PLAYTEST #3: from 1.5–3 km the trench line read as a thick black sawtooth ribbon and woods as flat black blots. The shader widened each trench's anti-aliasing band with the pixel footprint (`smoothstep(1.3 ± 0.6·px)`) and kept a 30% floor, so a 2 m cut with a ±3.5 m zig-zag filled 5–8 pixels at ~1 km. Far woods were a flat, dark palette colour with the near-field noise averaged away. Thresholded single-octave value noise also drew lattice-aligned squares (chalk splashes, Flanders wet ground).
**Decision.**
- **Box-filtered coverage:** cuts, spoil and wire use `bandCov`/`ringCov`, the exact box filter of a band against the pixel footprint. Sub-pixel features get fainter, never wider, with no floor, and every feature fades out together before the 40 m/px cutoff.
- **Recon-photo look:** thin dark cuts (shadowed earth at 0.36× the local ground, not near-black), pale chalk spoil in Artois/Somme, dun breastworks in Flanders, and a faint grey band for wire from altitude.
- **Trench traces:** fire and support lines are crenellated (bays and traverses) with irregular bay lengths, and the reserve zig-zags. The pattern fades to a straight line once a bay is a few pixels long, widening the cut by the path-length ratio so its tone is conserved. Communication trenches wander and about a third of lanes have none.
- **No-man's-land:** a ragged, mottled brown-grey tint over the existing crater shading, not a replacement colour (a flat replacement read as a paved strip).
- **Woods:** multi-scale canopy tone (stand, clump, crown), each fading to its mean, over lighter seasonal forest colours. Autumn tree tints are less orange.
- **`tblob`:** two rotated value-noise octaves for thresholded patches.
**Consequences.** From 1–3 km the network reads as fine pale lines, from 2 km straight down as parallel chalk lines with communication trenches, and at 50–300 m as dark crenellated cuts edged with spoil. The wave-4 low-level crater look is unchanged. Cost: +0.16 ms p50 on 'high' in big16 (A/B mean of five, 3.64 against 3.48 ms), within noise in the `frontShots` views. The trench trace direction is still a fixed world axis (`along`), so lines running east–west show stretched bays; an arc-length parameter would need a per-vertex attribute.

## D-068 — Quick ground attack: defenders scramble low in two staggered elements; flak is not a strafing target (balance wave 6)
**Context.** Quick ground attacks killed or captured the autoplayer in most runs. The defenders were one flight arriving together at 500 m AGL, about two minutes in. Traces also showed strafers spending passes on the AA gun sited next to the target waypoint (never an objective), so they failed the 3-target objective and left with the job undone.
**Decision.** `buildQuickMission` splits the defenders into two elements (ceil(n/2), then the rest). They scramble 7 and 8.5 km beyond the target at 350 m AGL, and arrive ~150 s and ~240 s after the player reaches the target. Strafers add 4 km to an AA gun's distance when choosing a target, so they attack flak only when nothing else is left. A closure-based "scouts coming" exit and different pass caps were measured and gave no gain, so they were dropped.
**Consequences.** Quick ground attacks, 24 seeds per setup:
- Screen default (Camel and wingman v 2 regular D.Vs): success 38% → 100%, killed or captured 21% → 13%.
- Camel v 3 Dr.I: success 42% → 92%, killed or captured 46% → 29%.
- D.VII v 2 veteran SPADs: success 88% → 96%, killed or captured 71% → 63%. Veteran defenders stay deadly.

## D-069 — Collision avoidance: early committed head-on break, wider berth for the player (balance wave 6)
**Context.** The career survey had 8.5 collisions per 100 missions, 2.5% of them fatal to the player. The worst case is a pilot who holds his line (the human never dodges for the AI). In a 4v4 soak with the allied leader flown without avoidance, 21 fights in 100 had a collision and the leader was lost in 35 of 150. Most were head-on, against a wreck-to-be. The old break came at 55 m, half a second from impact at head-on closure.
**Decision.** An attacker breaks a closing pass at max(55 m, 1.8 s × closure). For 0.8 s it flies a committed escape: away from the closest-approach point, or up the lift line when dead ahead, split by id and always up against the player. It then extends. Avoidance gives the player and a flight-mate chasing the same target a 45 m radius (32 m otherwise). A real conflict (weight > 0.25) lifts the manoeuvre's g cap. `AIControllerOptions.avoidCollisions: false` lets tests stand in for a human.
**Consequences.**
- Soak (150 runs): human-leader collisions fell from 21 to 4 per 100 runs, and leader losses from 35 to 6. Kills per run held (2.77 → 2.69).
- Career survey: collisions fell from 8.5 to 3.5 per 100 missions, and player collision losses from 2.5% to 1.0%. The overall career killed-or-captured rate is unchanged at 25%.
- Tests: `collision.realsim.test.ts` fails on the old controller (3 human collisions in 20 runs) and passes on the new one.

## D-070 — Drag-aware lead; out-turned tactics measured and rejected (gunnery wave 7)
**Context.** The Quick Mission default dogfight (veteran autoplayer Camel and a regular wingman against 2 regular D.Vs) put the player down in 0–8% of runs, against a 35–55% target. `leadSolution` computed time of flight as range / muzzle velocity, but rounds lose speed under the sim's quadratic drag (`k = 0.0007 /m`): a 400 m Vickers shot takes ~0.62 s, not 0.5 s, so every AI gunner under-led by 10–20% at 200–400 m. A `gundiag` soak (per side: nose-on time, solution and firing time, hits by geometry) showed the D.Vs spent ~10% of close-range time with the nose within 30° of a Camel (Camels ~45%), and scored 23 of 25 hits head-on, none reliably from the tail.
**Decision.**
- `leadSolution` inverts the drag law: it solves for the drag-free flight time g the aim vector needs, then converts to real time t = (e^(kVg) − 1)/(kV). Gravity drop uses 0.5·G·t·g. The sim exports `BULLET_DRAG_K` so the AI and combat share one constant.
- Tested against a sim-integrated round and a target in a 35°/s turn (`src/ai/gunnery.test.ts`).
- Three tactics for a pilot out-turned by its target (wing loading 25%+ higher) were built and measured, then dropped: a high yo-yo when the lead can't be pulled, a diving extension instead of a flat break, and a "joust" (extend and re-attack on the pass). None moved the default fight (0–6% player down in all variants). Mutual-support targeting (prefer the enemy on a friend's tail) favoured the veteran player's side and pushed mirror fights further from even, so it was dropped.
- Skill profiles were not changed.
**Consequences.** Better AI gunnery at range for every type (against a human too). The default dogfight stays lopsided because the Albatros can't turn with a Camel (44 against 31 kg/m² at equal speed and climb); the D.Vs die to tail shots that shoot their tails away. Fixing it is a choice of default enemy on the Quick Mission screen (src/ui), recorded in docs/STATUS.md with measured candidates. Mirror fights, career death rates and quick ground attack were re-measured (docs/ai.md).

## D-071 — Quick Mission default dogfight stays Camel against regular D.Vs (lead, wave 7)
**Context.** Waves 6–7 measured the default quick dogfight (Camel and a wingman against 2 regular Albatros D.Vs) as lopsided for the *veteran autoplayer*: player down 0–8%. The cause is the airframe matchup (D.V wing loading 44 against the Camel's 31 kg/m²), not AI gunnery (D-070). The candidates were 2 regular Dr.I (~70% player down), a regular D.VII (17%), or keeping the D.V.
**Decision.** Keep the D.V default. It is the default a first-time player meets straight from the title screen, and the veteran autoplayer flies far better than a new human with a mouse: the wave-5 playtest's scripted pilot scored no confirmed kills. Camel against Albatros is also the period's classic 1917–18 matchup. Harder fights stay one click away: enemy type, count and skill are all on the Quick Mission screen.
**Consequences.** Quick dogfights are gentle by default and fair or hard when the player chooses. Revisit if human playtesters report the default fight is too easy.

## D-072 — Hosting: GitHub Pages, deployed by Actions from main (lead, deploy)
**Context.** The user wants a public URL to share. The game is fully static: a Vite build with `base: './'`, the flight code in a lazy chunk (D-056), GLB models and art under `public/`, and procedural audio. There is no server-side code. The fan-project naming and no-original-assets rule (D-008) holds, and the user confirmed publishing under the "Red Baron II: Reloaded" title.
**Decision.**
- **Repo:** public, `chrisvaillancourt/red-baron-2-reloaded`. Pages from a private repo would need a paid plan.
- **Host:** GitHub Pages at https://chrisvaillancourt.github.io/red-baron-2-reloaded/, with the source set to "GitHub Actions". It is free, the deploy sits next to the code, and the relative base means no subpath configuration is needed.
- **Workflow:** `.github/workflows/deploy.yml` runs on every push to `main` (and on demand). It installs with `pnpm install --frozen-lockfile`, then runs typecheck, unit tests and the build, uploads `dist`, and deploys. Actions are pinned by commit SHA, with the tag in a comment. Only one deploy runs at a time.
- **Out of CI:** Playwright e2e stays out, because it needs a real GPU (Metal) and the installed Chrome. `pnpm prodcheck <url>` is the post-deploy check, run by hand against the live site.
**Consequences.** Every push to `main` is a release, so a red test blocks the deploy. The first deploy passed prodcheck on a cold cache: the menus loaded in ~1.1 s, the flight chunk was prefetched, GLBs and all four workers loaded, and there were no failed requests or console errors. Rolling back means reverting on `main`. `ubuntu-latest` moves to Ubuntu 26 from 19 October 2026; pin the runner if that breaks the build.

## D-073 — Perception: sun glare, cloud and memory; the player's HUD plays by the same rules (perception, AI depth)
**Context.** The AI saw every enemy within its spotting range except in a rear blind cone, whatever the sun and clouds, and remembered only *when* it last saw one, then used its true position. Attacks out of the sun and escapes into cloud, central to WWI air fighting and RB2, meant nothing. The player's HUD threat triangles and automatic target box were just as omniscient within 3 km.
**Decision.**
- **Shared sky:** perception reads `WorldQuery.sunDirection` and `cloudTransmittance`, from src/world/sun.ts and src/world/clouds.ts, the sources the renderer draws. A pilot can only hide in a cloud that is on screen.
- **Sun glare:** a target within 15° of the sun is spotted at a reduced range. The penalty is full inside 5°, where the range drops to 12% (novice) to 30% (ace), with a smoothstep between. It ramps in as the sun climbs from 2° to 6° (haze at the horizon) and is scaled by how much cloud hides the sun from the observer (one 3 km ray per sweep, only when a target is near the sun). The blind-cone range and check-six glances are cut the same way.
- **Cloud:** the spotting range (or blind-spot range) is multiplied by the line of sight's cloud transmittance: Beer–Lambert over the density, with ~80 m of full density as one optical depth. Rays that don't cross the cloud band cost nothing.
- **Memory:** a contact stores last-seen position, velocity and `visible` (seen on the latest sweep). `knownEnemies` still returns remembered entities, so existing tactics are unchanged. A target lost in cloud is forgotten after `SkillProfile.memory` (3–12 s). `likelySpottedBy` lets a stalker judge whether it is still unseen.
- **Player fairness:** threat triangles and the automatic target box show only enemies the player could know about: seen by human eyes (a veteran's 4 km, the same glare and cloud model), shooting at the player within 900 m, or hitting the player, within the last 8 s. Padlock and a T-selected target are **not** filtered. RB2's padlock worked through cloud, and a deliberate lock is a player skill, not a free warning.
- **Human glare:** the HUD draws a sun-glare wash-out, 15° in radius and near-opaque in the core, faded by sun elevation and cloud. On screen too, a D.V at 350 m straight out of the sun is washed out (docs/screenshots/sunglare-in-sun-vs-side.jpg). It is a DOM overlay, so it ignores occlusion by the player's own wing; that was accepted for its cost.
**Consequences.**
- Real sim, 6 seeds: a regular spots a D.V diving straight out of the sun at ~600 m, against ~3.4 km with the sun behind the observer.
- Cost: a full 16-aircraft sweep round with everyone inside the cumulus band takes ~0.42 ms. Each aircraft sweeps every 0.2–0.9 s, so that is ≤ 2 ms per second of flight at worst.
- Tactics can now use the sun and cloud (the tactics work builds on `contact()`, `sunAngle` and `likelySpottedBy`). Humans get the same cover from the sun, and the HUD no longer warns of a bounce the player couldn't see.

## D-074 — Tactics: stalking out of the sun, ace signatures, cloud refuge, memory pursuit (tactics, AI depth)
**Context.** With perception able to lose a target in glare or cloud (D-073), the AI still attacked from wherever it happened to be: in `gundiag` (8 runs) regular D.Vs entered 0% of attack passes from above and 5% up-sun, and almost no pass was unseen. Hurt pilots flew straight home with a scout on their tail, a pursuer who lost sight of a target still read its true position, and every ace fought alike.
**Decision.**
- **Tactics profile** (`src/ai/tactics.ts`): patience (seconds he will spend setting up), preferred height advantage, sun use, straggler and two-seater bias, burst and fire-range scale, commitment and a damage level at which he disengages. It comes from skill (novices and regulars have no patience; veterans and aces climb for 150–350 m and, above t = 0.5, use the sun), then from an optional ace signature.
- **Ace signatures:** `Ace.tactics` in `src/data/aces.ts`, one of `stalker | lone-hunter | leader | brawler | two-seater-hunter | calculated`, sourced from each pilot's documented habits (the Dicta Boelcke; Richthofen's dives with the sun behind; McCudden's stalking of two-seaters from below; Mannock's "always above, seldom on the same level, never underneath"; Rickenbacker's "never attack unless there is at least a fifty-fifty chance"; Fonck's short bursts from height; Ball, Bishop, Guynemer and Luke as lone hunters; Voss and Lothar von Richthofen as brawlers). The ace id reaches the controller through one adapter, `src/game/aiOptions.ts`, used by both the flight session and the autoplayer.
- **Stalking:** a pilot with patience whose target has not spotted him (`likelySpottedBy`) works round to the sun's bearing from the target at a standoff of 1.5–3 km, closes level at his preferred height once on the bearing, then comes down the sun line on a constant-bearing course: the target's velocity plus a closing speed along target→sun (solved at powered-dive speed, `|v_t − c·sun| = 0.9·vMax`), plus a gentle correction back onto the line. The lead's first version steered for a point on the moving line from the stalker's current speed. In-game against a crossing target it found no closing speed, flew alongside, and slid from 7° to 23° off the sun. He gives up when spotted, when patience runs out, inside 500 m, or once hit.
- **Meeting a bounce:** veterans and aces in a single-seater turn up into an attacker diving on them from 150 m+ above within 1 km (Dicta Boelcke rule 6), instead of the usual break.
- **Cloud refuge:** a pilot heading home hurt (not a voluntary RTB) with an enemy scout within 1.8 km makes for the nearest cloud within 3 km whose centre is not far above him, enters it at his own height, and wanders inside for 12–20 s before resuming the trip home.
- **Memory pursuit:** a pursuer whose target is out of sight more than 350 m away flies to where it was last seen, advanced along its last velocity (up to 8 s), instead of reading its true position. Closer in, ordinary pursuit and its collision care run.
- **Not kept:** holding fire at an unseen target within gun range. Glare within 5° of the sun makes a target at 100 m "unseen", and the gate cut gunner exchanges and tipped the collision test.
- All of these sit behind `TACTICS_FLAGS` (env `AI_TACTICS=flag=0,...` in the soaks), so each can be A/B measured.
**Consequences.**
- **Stalk test** (real sim, 5 seeds, `stalk.realsim.test.ts`): a stalker ace against an unaware patrolling Nieuport under a low November sun. It enters inside 600 m 2–4° off the sun, unseen in all 5 runs. With stalking off, it enters 17–46° off the sun and is seen every time.
- **Ambush soak** (`AI_SOAK=ambush`, 14 reps per skill, the same geometry), share of first passes from above or up-sun, tactics on / off:
  - novice and regular: 0% / 0%
  - veteran: 57% / 43%
  - ace: 62% / 38%
  - stalker ace: 100% / 38%, and 100% unseen / 0%.
- **In-game** (`tools/playtest/ai-depth-shots.mjs sun`, seed 3): Fonck holds 3–4° off the sun from 2.3 km to 800 m against a crossing D.V, and the victim's HUD first boxes him at 540 m (docs/screenshots/ai-out-of-the-sun.jpg). Cloud escape, 6 seeds (`cloudEscape.realsim.test.ts`): the wounded pilot spends 126 s in cloud against 46 s and his pursuer is without sight of him for 151 s against 57 s, but he takes about as many hits (227 against 213), because close-range cloud visibility is lenient and he leaves cloud after 12–20 s. Soak results are in docs/ai.md ("Wave 8").

## D-075 — Boom-and-zoom by matchup measured and rejected (tactics, AI depth)
**Context.** The wave-8 brief asked for boom-and-zoom for out-turned pilots (the D.V at 44 kg/m² against the Camel's 31), expecting it to bring the default quick fight's player-down rate toward 20–40% with no flight-model changes.
**Decision.** Built: a position → attack → zoom stage machine that climbs to a setup point above (and up-sun), dives on the target with lead pursuit, fires one pass and zooms for 7 s, repeating. Three variants were measured at 24 reps (player down, veteran autoplayer, same seeds):

| Setup | Off | Out-turned B&Z |
|---|---|---|
| Default (Camel+1 v 2 regular D.V) | 8% | 4% |
| D.VII player v Camel | 79% | 88% |
| SPAD XIII player v Dr.I | 83% | 96% |
| S.E.5a player v Dr.I | 92% | 96% |
| Camel player v D.VII | 29% | 4% |

"Only while above" was worse still (D.VII v Camel 100%), and "every energy type" was no better. It lost more fights in every matchup, so it is off by default (`TACTICS_FLAGS.boomZoomOutTurned = false`); the code stays behind its flags for re-measurement. The reason is the airframe: an `AI_SOAK=energy` dive-and-zoom probe shows the D.V is dive-limited. Its structural strength of 0.55 sets a low sim `vne` (src/sim/coefficients.ts), and the AI's dive governor (`traits.maxSafeDiveSpeed`) keeps about 13% under it. From the same height it reaches 74 m/s in a dive against the Camel's 80, and the Dr.I 69 against the SPAD's 93. The heavy type can't dive away from, or zoom back above, its lighter enemy, so the extension hands him the tail shot.
**Consequences.** The 20–40% target for the default fight is not reachable with AI tactics alone. It needs a flight-model change (D.V dive limit, drag) or a different default enemy (D-071). The high yo-yo was not rebuilt; D-070 measured it with no effect.

## D-076 — D-071 revisited: keep the Camel v D.V default (tactics, AI depth)
**Context.** D-071 kept the default quick dogfight at Camel against regular D.Vs, pending AI work that might make the D.V a real threat. The wave-8 brief set a target of 20–40% player down, from D.V boom-and-zoom, with no flight-model changes.
**Decision.** Keep D-071. With the wave-8 tactics the default fight is unchanged: player down 4% on and 4% off (24 runs each). Boom-and-zoom, the lever the target assumed, lost more fights in every matchup (DECISIONS "Boom-and-zoom measured and rejected"). The energy probe explains why: the D.V can't out-turn, out-dive or out-zoom a Camel in this flight model. The acceptance target is reset in docs/ai.md. A harder default needs either a flight-model change to the D.V (dive limit or drag, owned by src/sim) or a different default enemy. D-071's candidates still stand: regular D.VII ~17%, 2 regular Dr.I ~70%.
**Consequences.** The default stays gentle for a first-time human, as D-071 intended. Revisit when human playtest data exists, or if the sim's D.V figures change.

## D-077 — Pin the CI runner to ubuntu-24.04 (lead, deploy; amends D-072)
**Context.** D-072 deployed on `ubuntu-latest` and planned to pin only if the move to Ubuntu 26 on 2026-10-19 broke the build. Every push to `main` is a release, so a runner-image change would first show up as a failed or bad deploy.
**Decision.** Both jobs in `.github/workflows/deploy.yml` run on `ubuntu-24.04`. Upgrading is a planned task, not a side effect: docs/STATUS.md "Next up" carries it, with a target of 2027-01-31 and the steps (branch, `workflow_dispatch`, prodcheck).
**Consequences.** The 2026-10-19 image change can't reach deploys. The pin stays until the upgrade task moves it; update this entry when it does.

## D-078 — Quick Mission default: 2 veteran Fokker D.VIIs (lead, wave 9; supersedes D-076)
**Context.** D-071 and D-076 kept the default quick dogfight (a Camel and a regular wingman against 2 regular Albatros D.Vs) as a gentle first fight, at 4% player down for the veteran autoplayer against a 20–40% target, and left the change to the user. The D.V can't out-turn, out-dive or out-zoom a Camel in this flight model (D-075), so AI work alone can't make it dangerous. The user chose to change the default enemy to the D.VII.
**Decision.**
- The defaults are 2 **veteran** D.VIIs; the player's side (a Camel and one regular wingman, head-on at 2,500 m) is unchanged. Measured over 96 runs (docs/ai.md "Wave 9"): regular D.VIIs put the player down 7% of the time, veterans 28%, and regulars with a novice wingman 19%. Flying alone against regulars, 89%; 3 regulars, 75% (48 runs). Only the veteran pair lands inside the target.
- The defaults live in one place, `src/data/quickDefaults.ts` (`QUICK_DEFAULTS`). The screen and the fairness, autoplay, gundiag and quickdiag soaks all import it (docs/FRICTION.md F-1).
- The defaults apply to every quick type, and a veteran pair makes all of them harder than the D.V default was (player down over 48 runs, old → new): balloon attack 13 → 46% (killed 4 → 31%), escort 0 → 35%, intercept 4 → 13%, ground attack 35 → 29%. This was accepted: a quick-mission death ends only that flight, and every setting is one click away on the screen.
- Returning players keep their saved setup (`rb2r.quick.v1`); only first visits see the new defaults.
**Consequences.** A new player's first quick fight is a real fight. The veteran autoplayer flies far better than a new human (D-071), so humans will go down more often than 28%. If playtests find the default dogfight too hard, drop the enemy skill to Regular with a novice wingman (19%). If balloon attacks feel punishing, make the first-visit enemy skill depend on the mission type. The README's first-flight walkthrough describes the new fight.

## D-079 — Ace standings: 'away' between service spells (polish, wave 9)
**Context.** HQ's Ace Standings called every living ace with victories "Flying", including one in hospital (Lothar von Richthofen on 1 June 1917; PLAYTEST wave 7 #10). `src/data/aces.ts` records service as dated spells, but a gap between spells has no recorded cause: for Lothar it is hospital, for Boelcke in summer 1916 a grounded tour of the Balkans.
**Decision.** `AceStanding.status` gains an additive `'away'` (src/core/campaignTypes.ts): alive, still in the war, not at the front on that date (`aceServiceOn` returns nothing). The player in hospital is `'away'` too. HQ labels it "Off the front", not "In hospital", because the data doesn't say why an ace was away.
**Consequences.** Readers that only know the old union can treat `'away'` as `'active'`. If the data later gains a reason per gap, the label can get more specific without changing the status.

## D-080 — Lafayette mates carry French ranks (polish, wave 9)
**Context.** Squadron mates take their rank ladder from the career's nation, so Americans in Escadrille N.124 "Lafayette" came out as "1st Lt." and "2nd Lt." (PLAYTEST wave 7 #11). The volunteers were enlisted in the French service and held French ranks until the unit became the 103rd Aero Squadron, USAS, on 18 February 1918.
**Decision.** Rosters pick ranks from a squadron's rank service when it differs from its nation (`RANK_SERVICE` in `src/campaign/names.ts`, only `n124 → france`). Names stay American. The player's own rank is unchanged: it still uses the US ladder, because moving a pilot between ladders at the 103rd Aero changeover touches promotions and saves.
**Consequences.** Lafayette briefings, HUD rosters and CO remarks read "Sgt.", "Adj.", "S/Lt." and so on. A Lafayette player is still a "2nd Lt." among French-ranked mates; revisit if Lafayette careers get attention.

## D-081 — Cloud blinds at close range; no blind pursuit or fire; refuge circles the core (cloud, AI depth)
**Context.** Cloud refuge (D-074) hid a wounded pilot but didn't save him: in `cloudEscape.realsim.test.ts` (6 seeds) he took 196 hits with refuge against 213 without (re-measured on `main`; the wave-8 table says 227). Instrumenting the hits showed why: 162 of the 196 landed while he was inside cloud, and the pursuer had him in sight for every one. Three things let that happen:
- Sight was `range × transmittance`, and a 4 km spotting range × 0.25 (about 110 m of cumulus core) still reaches a man 110 m ahead.
- Within 350 m the pursuer steered at the target's true position even when he had lost sight of him (memory pursuit only applied beyond 350 m), so he stayed glued at 40–80 m.
- The gun gate aimed at the current target's true position whether he could see him or not.
- Separately, the refuge ended on a 12–20 s timer, and the weave inside (±0.6 rad) carried him out of the side of a ~350 m core.
**Decision.**
- **Contrast limit** (`CLOUD_SIGHT_MIN = 0.3` in `src/ai/perception.ts`): below that transmittance (optical depth ~1.2, about 100 m of core) an aircraft can't be made out at any range. It applies to AI sweeps, `humanSees` (the player's HUD cues) and `likelySpottedBy`. The renderer's in-cloud fog is ~3/4 opaque at that depth, so the AI and the HUD now match what the player sees. At 30–80 m inside a core he is still seen, as he is on screen.
- **No blind pursuit in cloud:** memory pursuit also applies inside 350 m when cloud hides the target (`cloudHides`). The head-on break still uses the true geometry, so it can't fly him into a ram. Losing sight under the nose or in glare still keeps the close pursuit.
- **No blind fire in cloud:** the gun gate skips a remembered target that cloud hides. Glare alone still doesn't stop a burst (D-074 "Not kept").
- **Refuge:** a wounded pilot circles the core at up to 250 m (0.45 of the cloud's radius), keeping the turn he entered with, for 25–40 s.
**Consequences.**
- `cloudEscape.realsim` (6 seeds), refuge on / off: hits taken 28 / 195 (was 196 / 213), time in cloud 273 / 79 s, time out of the pursuer's sight 350 / 124 s, and no hit landed while the pursuer couldn't see him. The test now asserts on < 0.5 × off and zero unseen hits. One seed still takes 27 hits: he reaches cloud with the pursuer already on him and is inside only 8 s.
- Default quick fight (Camel+1 v 2 regular D.V, 24): player down 4%, unchanged. The collision, stalk and perception-cost tests pass unchanged.
- Veteran career survey, three seed sets (`AUTOPLAY_SEED_BASE` 0 / 1000 / 2000) against the previous `main` code: killed or captured 22.4% (53 of 237 missions) against 19.7% (52 of 264), and collisions 5.5 against 3.4 per 100 missions (13 against 9). Neither difference is significant at these counts. Collision avoidance reads true positions, so blindness in cloud doesn't weaken it directly, and none of the new collisions was in a chase into cloud. Re-measure if a later survey keeps drifting the same way.
- The player's HUD drops threat triangles and the automatic target box for an enemy ~100 m+ deep in a cloud core, unless he is shooting at or hitting the player (D-073). Padlock is unchanged. A player who hides in cloud is lost by AI pursuers the same way.

## D-082 — Head-on quick dogfights start with a clear line of sight (lead, wave 9)
**Context.** The playtest-kit agent noticed that in one default quick fight (seed 5000) nobody fired for about 262 s. A probe showed a cumulus on the line between the flights at the start (transmittance 0.00 at 2.6 km). The flights passed within ~900 m of each other inside it, neither saw the other, and they flew apart. Over the fairness soak's 96 seeds, 17 default starts had cloud on the line (transmittance below the 0.3 contrast limit, D-081). In 9 of them neither side had a clear sight within 30 s, and in 8 not within 2 minutes. The old `range × transmittance` model was just as blind at these depths, so this predates D-081. A new player could meet it in the first fight.
**Decision.** `buildQuickMission` checks the line between the two flights' starts for head-on dogfights, using the mission's own `CloudField` at t = 0. If it lets through less than half the light, the builder moves the fight along the front in 2 km steps (±1, ±2, ±3, ±4) and uses the first clear placement; both flights stay on their own side of the lines. The search uses no random draws, so every start that was already clear is unchanged, and so are the soak seeds that were never blocked. The contrast limit moved to `src/world/clouds.ts` (`SIGHT_MIN_TRANSMITTANCE`), and perception's `CLOUD_SIGHT_MIN` refers to it. Other start positions and mission types are unchanged: their run-ins are long, and the flights turn toward each other.
**Consequences.** All 96 default starts are clear, and every fight has a clear sight within 30 s (`quickMission.test.ts`). The default fight's player-down rate is 30% over 96 runs, against 28% before, within noise. Under a solid overcast at the flights' height the start can't be cleared and stays blocked; that is the weather the player picked.

## D-083 — Flight reports: versioned JSON from the debrief, carrying the whole mission (playtest kit)
**Context.** Every open balance question (the D.VII default, balloon attacks, sun attacks, cloud escapes) waits on human playtests, and a playtest gave impressions, not something that could be flown again or counted.
**Decision.**
- **What:** the debrief's "Copy flight report" writes one flight as JSON: `kind: "rb2r-flight-report"`, `schema: 1` (`src/core/flightReport.ts`). It holds the build (git short SHA, "-dirty" with local changes, injected by `vite.config.ts` `define`; `define` is read at config load, so under `pnpm dev` the SHA is the server-start one and the report is marked `build.dev`, which was chosen over re-reading git per request), the settings that change a fight (realism, mouse mode, graphics, career difficulty), the **full `MissionDefinition`** (not the quick options plus a seed: career missions come from the campaign generator and a quick mission's seed isn't kept, so only the mission itself reproduces both), the quick options when there were any, the outcome, the flight recorder's telemetry, and an optional rating (too easy / fair / too hard) and note.
- **Telemetry:** `MissionResult.telemetry?: FlightTelemetry` (additive in src/core), filled by `FlightRecorder` (src/game). The game layer records and the UI reports, because the UI can't import the lazily loaded flight chunk (D-056).
- **Schema rule:** optional fields may be added under `schema: 1`. Any other change bumps it, and `parseFlightReport` learns to read the old version.
- **Privacy:** the pilot's name (career) is the only personal field. The mission's other names are generated.
- **Transport:** the clipboard, with a selectable textarea when the clipboard refuses. No network: the game is a static site (D-072).
- **Where reports live:** tracked in `playtests/reports/` (README there: naming and commit style), outside `docs/` because they are data, not prose. `tools/playtest/replay-report.mjs` flies one again, headless (8 autoplayer runs: run 0 on the game's seeds, the rest reseeded) or in the real app with `--browser`.
**Consequences.** A playtester pastes the report back. A headless flight is deterministic, so the report's mission flies the same fight again for the autoplayer (`src/core/flightReport.test.ts` checks this). Anything added to `MissionDefinition` has to stay plain JSON.

## D-084 — The dev server saves flight reports by itself (lead, playtest kit)
**Context.** After the first human playtest the user asked not to have to paste reports after every flight. D-083 put a Copy button on the debrief, which leaves the playtester to copy, paste and name a file each time. The user plays on the local dev server (the report said `build.dev: true`). The live site is static GitHub Pages and can't receive anything without a backend.
**Decision.**
- Under `pnpm dev`, a Vite plugin (`vite.config.ts`, `apply: 'serve'`) accepts POSTs at `/__rb2r/flight-report`. It validates the body with `parseFlightReport`, rejecting anything that isn't a flight report and anything over 2 MB. It writes the report to `playtests/inbox/`, which is git-ignored, or to `$RB2R_REPORTS_DIR`; e2e uses `test-results/flight-reports`.
- The file name comes from the report's timestamp and mission (`YYYY-MM-DD-HHMMSS-<type>-<player>-v-<n>-<enemy>.json`) and keeps to `[a-z0-9.-]`. The validation and name are pure (`src/core/reportSink.ts`). The config loads that module through `ssrLoadModule`, so it imports nothing from src.
- The debrief sends the report when the combat report opens, on a rating, on blur of the note field, and 0.7 s after typing stops. It uses one timestamp per flight, so every send overwrites the same file, and shows "Saved to <path>".
- The sink is off in production builds (`import.meta.env.DEV`, so the code is removed from the bundle) and under browser automation (`navigator.webdriver`), so e2e runs and replay screenshots don't pose as human flights. A test turns it on with `?reportSink=1`.
- Not done: sending from the live site. It needs a backend, an endpoint with a secret, and a spam and privacy policy. Revisit if playtesters other than the user play only on the live build.
- **Committing (amended the same day, with the user):** raw reports stay local in the git-ignored inbox. The repo is public, most auto-saved flights are unrated noise, and the lead reads the inbox from the working copy. A report is promoted to the tracked `playtests/reports/` only when a decision, test or STATUS item cites it, and it is committed with that change. Worktree agents see only committed files, so give them an absolute path to an inbox report.
**Consequences.** On `pnpm dev` every flight leaves a report with no clicks. Unrated flights are saved too, since outcome data is useful without a rating. "Copy flight report" stays as the live-build path.

## D-085 — Escalating defence: keep turning, brake-turn, reverse on a lagging pursuer (defence, wave 9)
**Context.** The first human playtest report (5 ace D.VIIs at 300 m, rated too easy) said enemies "just fly in circles when you get into position behind them". `AI_SOAK=tailhold` confirmed it: with an enemy on his tail a defender spends 43–61% of that time circling. Every turning manoeuvre turns toward the attacker, and a pursuer inside the turn stays on that side, so re-picking a manoeuvre every 3–5 s chains into one circle. The brief proposed changing plane after a failed break: scissors, a dive and zoom, a climbing spiral or a split-S, chosen by airframe. The first round was measured against the veteran autoplayer only, whose computed lead punishes any change of direction (FRICTION F-23), so the second round measured every design against the human-like pursuer too (D-087 "Human-like pursuer").
**Decision.**
- **The ladder was built, measured and rejected, against both pursuers.** Real sim, 24 seeds, D.VII with a Camel 200 m behind at 2,000 m: 441 → 647 hits and 7 → 14 of 24 shot down against the veteran; 172 → 399 hits and 0 → 6 down against the human-like pursuer. At 300 m against a Bristol: 0 → 8 and 1 → 5 down. The climbing turn never shakes him and the jink is the worst state (0.34–2.65 hits/s); anything that stops turning hands the pursuer the shot. It stays behind `TACTICS_FLAGS.defenceLadder` (off) for A/B runs.
- **What shipped, behind `TACTICS_FLAGS.escalateDefence` (on):**
  - Once the same attacker has survived a manoeuvre (the next one within 8 s), a veteran or ace above 500 m AGL, with the attacker inside 300 m and closing, flies a **brake turn**: the break with the throttle back (target 1.45× stall; the autopilot's speed floor still applies) and the nose a touch high. The attacker overshoots or can't hold the turn, and the existing counter-attack turns onto him once he is in front.
  - From the second manoeuvre that hasn't shaken him, a pilot **reverses** (a 2.5 s break the other way) when the attacker is lagging: his nose more than 10° off the defender and behind him, so no shot is on (`TACTICS_FLAGS.defenceReversal`, on). Reversing whatever the attacker did doubled the hits per second of tail-hold in the default fight against the human-like player (0.106 against 0.051); gated on lag it measured no worse than the old circle.
  - Otherwise pilots above novice escalate to a **spiral** (only above 1,500 m, and never two in a row), else the **break**.
  - Pilots above novice don't **jink** with an enemy inside 400 m. Novices and two-seaters are unchanged, and so are D-060's low-level rules (the reversal applies low down too; the brake turn doesn't).
  - **Not on the way home.** A pilot heading home keeps the old choices. With escalation there, a hurt pilot's spiral dropped him out of the bottom of his refuge cloud: `cloudEscape.realsim` went from 28 against 195 hits to 103 against 115, until RTB was excluded. (A review later found RTB re-picking a manoeuvre every tick, in every design; it now flies each to its end.)
- **The spiral gate is measured.** The first version spiralled from 700 m and repeated spirals. Fights went down ~2.6 km a run, and quick-survey flak, ground and self-crash losses rose from 29 to 47. With the 1,500 m, no-repeat gate they are 31.
**Consequences** (off → shipped, same seeds, after the round-3 review fixes; the round-2 (a)–(d) tables and the before/after are in docs/ai.md "Wave 9: defence"):
- **Real sim, 96 seeds** (24 seeds swing by a third with the noise stream alone). At 2,000 m: 645 → 432 hits against the human-like pursuer (0 and 1 down) and 1,842 → 995 hits, 33 → 10 down against the veteran. At 300 m: 662 → 709 hits (fixed guns 211 → 275) against the human-like pursuer and 632 → 641 against the veteran, 1–3 down either way. The share of tail-hold time out of a constant-direction turn goes 41 → 53% and 52 → 62% (human-like), 43 → 45% and 54 → 62% (veteran). In round 2 the brake turn alone took the fewest hits at 2,000 m but left the circle as it was.
- **Tail-hold soak, tail-holds by a human-like player** (36 runs): default fight 11.0 → 9.7 hits a run, 27 → 39% out of the turn; the report's setup 8.9 → 8.8 hits, 50 → 58%, longest single tail-hold 86 → 37 s. Against the veteran player: 31.6 → 27.1 and 15.9 → 11.7 hits. The distinct manoeuvres per tail-hold barely move (about 2).
- **Fairness** (96 runs, default fight, `ab.mjs`): player down 25 → 33% (veteran player), 48 → 47% (human-like player), both within noise. Mirrors and the energy set (48 each): all within noise; the SPAD XIII mirror 33 → 25%, below the 30–70% band (29% in round 2; the brake turn alone had taken it to 10–17%).
- **Quick survey** (360 missions, `ab.mjs`): killed or captured 30.8 → 36.4%, collisions 3.6 → 5.3 per 100 missions, both within noise. Player collisions 3 → 8, of which four are one fight that repeats identically in four reps (3 → 5 distinct); the rest are mostly both aircraft in the attack extension after a pass, a pre-existing weakness left open (the collision soak doesn't reproduce it, and its own furball has the leader rammed 1 time in 80 seeds against 4 before the review fixes).
- **Career** (3 seed sets, `ab.mjs`): killed or captured 22.6 → 20.9%, collisions 5.7 → 7.4 per 100 missions, both within noise; the player's 2 → 5.
- **Low down there is no new manoeuvre beyond the reversal.** What the human in the report lacked was threat from the aces nobody was chasing; that is attack-side work (mutual support), not defence.

## D-086 — Crew stations, bombs and twin engines: the bomber contracts (lead, bombers wave 1)
**Context.** The user asked for flyable bombers (Gotha G.V, Handley Page O/400, AEG G.IV, Breguet 14 B2, D.H.9, D.H.4, Voisin III), with the player able to take any gun position in every multi-crew type, including today's AI-only two-seaters (docs/bombers.md). The contracts had one rear gunner per aircraft (`geometry.crew === 2`, a hard-coded field of fire in `src/sim/combat.ts`), no bombs and one engine. Four agents build this in parallel, so the lead fixed the shared shapes first. (D-085 is taken by the defence track, still in its worktree.)
**Decision.** Additive changes in `src/core`:
- **Crew stations.** `CrewStation { id, label, crewIndex, guns, arcs, eye?, bombAimer? }` with `CrewStationId = 'pilot' | 'observer' | 'nose' | 'dorsal' | 'ventral' | 'rear'` and `AircraftSpec.crewStations?`. A station is a place to work from, not a person: stations that share a `crewIndex` are one man moving between guns (the Gotha's rear gunner works the dorsal gun and the ventral tunnel), so they fire one at a time and one wound silences them all. A gun belongs to exactly one station. Fields of fire are `FireArc` boxes (azimuth clockwise from the nose, wrapping through astern; elevation from the wings), unioned. Boxes were chosen over the old per-type exclusion tests because data can state them and the HUD can draw them.
- **One reader.** `crewStations(spec)` in `src/data/crew.ts` returns a spec's own stations or derives them: the pilot with the fixed guns, plus an observer with the flexible guns. The derived arcs agree with the old rear-gunner field of fire over 99.9% (Bristol) and 100% (F.E.2b) of the sphere by solid angle (`crew.test.ts`), so moving combat onto stations needn't change today's two-seaters. `crewStationProblems(spec)` checks a spec, and a test runs it over the whole roster.
- **The player at a station.** `AircraftEntity.stationInputs?: StationInputs { station, aim, fire, releaseBomb, clearJam }`. The player's aircraft keeps `controller: 'player'` (which five call sites use to find him); the AI flies it through `controls` while he works the guns, and his inputs override the AI gunner at that one station. The quick options and the player's flight member carry a starting `station?`.
- **Bombs.** `AircraftSpec.bombs?: BombStore[]` (name, mass, charge, count), and `AircraftEntity.bombs?: number[]`, the rounds left per store. `performance.massLoaded` includes the full load, as the historical loaded weights do, and the flight model subtracts bombs released or not carried. Pilots and AI bomb aimers release with `ControlInputs.releaseBomb?`; events `bomb-released` and `bomb-exploded`; `MissionResult.bombsDropped?` and `bombHits?`; waypoint action `'bomb'`; mission type `'bombing'` and quick type `'bombing'` with `escortCount?` and `escortAircraft?`.
- **Twins.** `performance.engineCount?` (`enginePowerHp` stays the total), `geometry.nacelleOffsetX?`, `DamageState.engines?` per engine and `crewWounds?` per crew member (absent: the old `gunner` zone). `geometry.crew` widens to `1 | 2 | 3 | 4`, and non-AI checks moved from `crew === 2` to `crew >= 2` (no change for any current type). The three in `src/ai` wait for the AI track, which starts after the defence merge.
- **Hotchkiss.** `GunType` gains `'hotchkiss'` (Voisin III), strip-fed, with its own sound.
- **Renderer.** `AircraftVisual.stationEyes?` from the models' `EyePoint_<id>` empties, and `setStationAim?` to swing a gun ring.
- **The D.H.4** carries four 112 lb bombs as the reference load (charge approximate; the data track calibrates it). It stays AI-only until the gunner seat and bomb release exist.
- **Not in the contracts:** new key bindings (the game track adds `stationNext` C, `stationPrev` V, `stationPilot` F, `releaseBomb` R, `viewBombsight` F6 with the code that reads them, so Options never lists a key that does nothing), and new ground-target kinds (raids use hangars, dumps, trains and batteries in wave 1).
**Consequences.** Nothing a player can reach changed: every aircraft fights as before, and no screen offers a bombing raid yet. Four tracks now build against these shapes (docs/bombers.md). Any contract they need beyond this goes in their final report, stays additive, and the lead reconciles at merge.

## D-087 — Human-like pursuer for the autoplayer; gunnery telemetry in flight reports (defence, wave 9)
**Context.** Every tactic was judged against the veteran autoplayer, which aims with a computed lead and near-instant reactions (FRICTION F-23). Tactics aimed at players need a pursuer closer to a mouse-aim human. The flight reports' `outcome.hits` counts a two-seater's AI-aimed rear gun with the pilot's guns, so a human's own accuracy couldn't be read from them.
**Decision.**
- `AIControllerOptions.human` (`src/ai/humanAim.ts`, parameters in `HUMAN_PILOT`) keeps the AI's tactics but aims like a human: the target's motion read 0.35 s late, 85% of the lead, a drifting bias (0.42°, 3 s) and jitter (0.21°, 0.25 s), a 0.3 s first-order aim lag, and fire on the believed lead inside 380 m in long bursts, with no snap shots. The autoplayer takes `pilot: 'human'`, and `AUTOPLAY_PILOT=human` switches it on for every soak, the replay and `defence.realsim`; `AUTOPLAY_HUMAN` overrides fields for sweeps. Off by default, so existing soaks are unchanged.
- **Fitted to one scene.** The tracked report's pilot hit with 10–14% of his fixed-gun rounds once the observer's are taken out (the Vickers holds 500 rounds, so at least 535 of the 1,035 were the Lewis's). The shipped values gave 12% in the same geometry (a Bristol behind an ace D.VII at 300 m) on the 24 seeds they were fitted on, as did the veteran; over 96 seeds both get 9%, the low edge of the human's range. Replays of the reports don't fit (5% and 1%, from a tenth of the human's fixed rounds), because the autoplayer's tactics never give it the human's firing geometry; nor do the balloon flights (2 hits of 97 against 49–56%). The fit is loose and documented as such (docs/ai.md "Human-like pursuer").
- **Telemetry for refits** (additive under schema 1): `bullet-hit` carries `mountIndex` (`src/core/types.ts`), and `FlightTelemetry.aim` / `FlightReport.aim` (`AimTelemetry`, `src/game/aimStats.ts`) hold rounds and hits split into the player's (guns of the station he works, `stationInputs.station`) and the AI crew's, seconds with his guns firing by angle from the gun line to the true lead (an enemy inside 400 m and 30°) and by range, and the time from a target entering the 10° cone to the first shot. The autoplayer records the same, and the replay prints them.
**Consequences.** Player-facing tactics can be measured against both pursuers; D-085 was. Against the human-like pilot the default fight goes about 47% player down (the veteran: 25–33%), so fairness targets stay on the veteran and the human-like pilot is for relative comparisons. The next human reports carry what is needed to refit the aim, including firing range for the balloon mismatch.

## D-088 — Sim on crew stations: gunner switching, twin thrust, bomb release and blast scaling (sim track, bombers wave 1)
**Context.** D-086 fixed the shapes for crew stations, bombs and twins. The sim had one rear gunner with a hard-coded field of fire, one engine and no bombs. Today's two-seaters had to fight as before (docs/bombers.md, track A).
**Decision.**
- **Arcs.** A flexible gun's field of fire is its station's `FireArc` boxes (`inFireArcs`, body frame), tested on the drop-compensated aim. They replace `flexibleArc`. `aimFlexibleGun` keeps its signature.
- **Gunners.** There is one AI gunner per crew member who isn't the pilot. A man with several stations fires from one at a time. He stays where he has the shot, else he moves to the station with the most guns that bears, and that takes 1 s with no fire. His hit box is only at the station he's working.
  - With one gunner aboard (every current two-seater), targeting is unchanged: the assigned target or the nearest enemy, holding fire while it is out of arc.
  - With several gunners, each prefers the nearest enemy his own stations bear on, and falls back to it when the aircraft-wide target is out of his arcs.
  - `setGunnerTarget(ac, id)` assigns every gunner and clears station overrides. `setGunnerTarget(ac, id, station)` binds that station's man strictly.
- **Wounds.** Explicit-station types track `crewWounds`: the old gunner rule per man (+0.34, killed at 1 or with 25% chance), with the `gunner` zone holding the least-wounded gunner's wound, so `zones.gunner >= 1` still means "no gunner left" (src/ai relies on it; per-man logic reads `crewWounds`). A wounded man keeps firing with more aim error (× 1 + wound); a killed one stops. Types without explicit stations keep the single `gunner` zone.
- **The player at a gun.** His aim and trigger fire continuously, inside the arcs, with the gun's own dispersion and no aim error. His other stations are silent, and the rest of the crew stays AI.
- **Engine stops a round.** On twins the first engine along the path stops a round. Single-engined types keep the old zone-list cut, which in tractors lets the engine shield everything else on the path, the pilot included; changing it waits for a lead decision.
- **Twins.** The power split is exact: healthy, a twin flies as a single-engined aircraft of the same power, and one propeller per engine sizes the disc. Thrust and windmill drag act at each nacelle, which gives the yaw toward a dead engine. `engineDead` means every engine is dead.
- **Bomb release.** Both release inputs are held inputs (lead decision): one bomb per false-to-true change, never consumed, so a held key or an AI flag held for several steps releases one. The station release needs the bomb aimer alive. The controls release needs the pilot alive, and, unless the player is in the pilot's seat, the aimer too. There is no release on the ground or below 5 m. The heaviest store goes first: the big bomb gets the first, best-aimed run, and the most weight comes off soonest. Bombs leave the CG with the aircraft's world velocity.
- **Ballistics.** Quadratic drag relative to the air: C_d 0.25, and a 0.2 m body for 50 kg scaling with mass^⅓. `predictBombImpact` shares the integrator, so the bombsight and the fall agree.
- **Blast scaling.** Hopkinson-Cranz: damage depends on Z = r / W^⅓, with r to the target's nearest face. A target is destroyed inside Z_kill, and damage falls as the square of the way out to Z_zero. Soft targets are 3.5 / 10, a trench MG 3 / 8, buildings and trains 2.5 / 7, and a battery 2 / 6. A 20 kg charge destroys a lorry within 9.5 m and a hangar within 7 m. This is plausible, not calibrated. Kill credit goes through the strafing path. A bomb hit (`getBombStats`) is a bomb that damaged an enemy target.
- **Mass.** Bombs not aboard come off `massLoaded` (translational mass and weight; inertias unchanged) through `effectiveMass` / `effectiveWeight`: the integrator, the ground contact, the sim autopilot and the trim of a new state. The coefficients stay calibrated at the loaded weight. An aircraft whose `bombs` is unset carries none, so the AI D.H.4 now flies 204 kg lighter than its loaded figure until the game layer loads it for a bomb sortie.
**Consequences.**
- Measured with `tools/dev/ab.mjs --base a3a830e` (career seeds 0/1000/2000; the tool's verdicts):
  - After the gunner change: killed or captured 20.1% (15.7–25.4, n=259) against 19.8% (15.5–24.9, n=278), and collisions 3.1 against 5.4 per 100 missions. Both within noise.
  - After all of it, the D.H.4's lighter weight included: 25.2% (20.0–31.3, n=222) against 26.0% (20.7–32.1, n=227), and collisions 3.6 against 5.7. Both within noise.
  - Fairness (default, 48 reps): 25.0% both times, identical, since that set has no two-seaters.
  - After the review fixes, pinned on both sides (`--base main --head HEAD`): killed or captured 23.2% (18.2–29.0, n=233) against 22.6% (17.8–28.2, n=248), and collisions 3.4 against 3.6 per 100 missions. Both within noise.
- Track B draws `combat.bombs` (`BombView`) and aims gun rings from `getStationAim`. Track C calls `loadBombs`, `predictBombImpact` and `getBombStats`. Track D sets targets per station.

## D-089 — The engine block in path order: measured, not shipped; the default stays off pending the user (sim)
**Context.** In `hitAircraft` a round damages every zone box on its path, cut at the engine. Twins cut at the first engine along the path (D-088). Single-engined types cut by zone-list order, and a tractor lists the engine first, so a round that crosses the engine box damages only the engine: a burst from astern through the cockpit into the engine spares the pilot, the fuel tank and the guns. The user's playtest (Bristol against 5 ace D.VIIs) counted 104 hits for one kill.
**Decision.**
- `traceRound` (hitboxes.ts) holds the trace and both cuts. `SIM_FLAGS.damagePath` (src/sim/flags.ts; env `SIM_DAMAGE_PATH`, read at load in Node, so `ab.mjs --a/--b` switches it) applies the path-order cut to every type: a round damages the zones it passes through in order along its path, and the engine stops it. Under the flag the `bullet-hit` zone is chosen from the zones damaged, not from every box crossed.
- **The default stays off.** The user decides whether it ships.
- `HIT_PRIORITY` only picks the `bullet-hit` event's zone; it never removes damage. With the zone-list cut it names the pilot for every round through his box, including the ones the engine stopped.
**Consequences (measured 2026-09-28).**
- Geometry (`SIM_SOAK=zones`, rounds aimed with a 0.6 m spread about the CG). From dead astern (within 30° of the tail) path order raises the share of hits reaching the pilot from 20–26% to about 32%, the fuel tank from about 3% to 17–21%, and the guns and tail a little. The rear quarter barely changes, the beam doesn't, and head-on the engine stops the round under both rules. Weighted by where hits come from in fights (22% astern, 41% rear quarter, 18% beam, 7% front quarter, 11% head-on), the pilot's share goes from about 30% to 33% and the fuel tank's roughly doubles (2–6% to 6–13%). The D.H.2 pusher reverses: its engine sits behind the pilot, so from astern path order spares him (17% to 4%).
- `ab.mjs`, flag off against on, both sides pinned to one commit. Every verdict "within noise":
  - Fairness (default, mirror, dvii, dviitypes, energy; 48 reps): 26 of 26 setups within noise. Pooled, player down was 32.9% against 32.1% (n=1248 each).
  - Quick survey (24 reps): killed or captured 35.0% (30.3–40.1) against 36.7% (31.9–41.8), n=360. Collisions 5.6 against 3.9 per 100 missions.
  - Career (seeds 0/1000/2000): killed or captured 22.5% (17.6–28.2, n=236) against 23.2% (18.2–29.1, n=228). Collisions 4.2 against 5.7 per 100 missions.
- Hits to kill (`SIM_SOAK=kills`, five quick setups, 40 reps each way, the same seeds). The verdicts come from the soak's interval overlap, and all are within noise:
  - Veteran autoplayer: a victim took 37.5 (35.9–39.1) hits before going down, against 38.4 (36.8–39.9). The pilot-kill share of victories was 10.7% (8–14) against 7.9% (5–11). The player's hits per kill were 44.5 against 42.9.
  - Human-like pursuer (`AUTOPLAY_PILOT=human`): 38.9 (37.2–40.6) against 36.4 (34.7–38.1) hits. The pilot-kill share was 9.6% against 9.7%, and the player's hits per kill 70.5 against 60.3.
  - The playtest's fight (Bristol with 3 novices against 5 ace D.VIIs at 300 m, 30 reps): 39.9 against 36.6 hits to kill (veteran), 40.9 against 40.6 (human-like).
- **Why it barely matters:** only about a fifth of hits arrive from dead astern, and most victories are structural failures under either rule: the tail in 54–58%, a wing in 17–23%, the pilot in 8–11%. Victims go down with the tail zone at about 0.8 on average, because rounds that lag a turning target fall in the large tail box. The number of hits to kill, about 38, is set mostly by the tail's 0.06 a hit and by the g limit that wing damage lowers, not by the engine block. The playtest's 104 hits to one kill fits that: about 40 hits to each victim, spread over several D.VIIs, with kills claimed by others.
- If it ships, `combat.test.ts` "bullets damage the target and a kill is credited to the shooter" needs its "more than 5 hits" floor lowered. With the flag on, the kill there comes after 2 hits.

## D-090 — The AI flies while the player works a gun (game track, bombers wave 1)
**Context.** The player can take any crew station (D-086). Someone has to fly the aircraft while he guns or aims bombs, and he must get the controls back with one key and no jolt.
**Decision.** At any station but the pilot's, `SimCore.setPlayerStation` gives his aircraft an ordinary AI controller on the flight's own task (the autoplayer's options), created when he leaves the seat and dropped when he returns. It sees the route from the player's next waypoint on, through a `WorldQuery` view whose `getFlight` returns the trimmed route, because a fresh controller starts at waypoint 0 and would turn back; it never skips a bomb or attack waypoint whose work isn't done (the HUD's next waypoint moves on within 1.5 km, so on the run-in it can lie past the target). A recalled flight's new pilot is ordered home. The aircraft keeps `controller: 'player'` (combat's invulnerability, the AI's collision rules for the human, the HUD and director all key on it), and the session simply stops copying input into `controls`. On the way back `InputManager.syncTo` takes the throttle and mouse stick from where the AI left them and re-centres mouse-aim on the nose, and that frame's input (built at the gun) isn't copied into the controls; the gunner's target goes back to automatic, and src/ai forgets the controller (`releaseAIPilot`). The same hand-back happens when the aircraft is lost or the mission ends at a station. The seat keys are C/V/F (1–5 are the wingman orders), F6 for the bombsight and R to release.
**Consequences.** Any AI pilot behaviour (engaging, going home damaged) applies while the player guns: in a Bristol dogfight the pilot fights with the Vickers. The autoplayer is unchanged: it ignores the mission's starting station.

## D-091 — Gunner aim: body frame, clamped to the arcs by nearest point (game track, bombers wave 1)
**Context.** The player aims a flexible gun with the mouse, and the gun can't point outside its station's fields of fire (`FireArc` boxes, D-086).
**Decision.** The aim is an azimuth and elevation in the body frame, so the gun turns with the airframe as the view does. Mouse (0.0022 rad per pixel, the mouse-aim scale), flight keys and left stick (60°/s) swing it. An aim outside the arcs goes to the nearest point of the union of boxes by angle on the sphere (each box: elevation clamped, azimuth to the nearer end), a hair inside the edge; pushing past an edge slides along it. The gunner view looks along the gun with a ring-and-bead sight at the centre, and the arcs' outer edge (seams between boxes removed) is drawn dashed, red while the aim is held at it.
**Consequences.** A world-stabilised aim was the alternative; it would hold a target through the pilot's manoeuvres, which a real gunner couldn't do without swinging the ring. Keyboard and gamepad aim work in every mouse mode, and snap-look keys turn the head off the gun while held.

## D-092 — The bombsight: stabilised, down the sight line to the impact (game track, bombers wave 1)
**Context.** The bomb aimer needs to see the target, where a bomb would fall now, the drift, and when to release. The plan said to look straight down.
**Decision.** Straight down from the D.H.4 observer's eye showed the fuselage and lower wing, and from typical heights the impact point was near the top edge or off the view. The sight view is wings-level and heading-up, looks down the sight line to the predicted impact (as a course-setting sight was set for height and speed), and hides the player's own aircraft. The impact is the sim's own prediction (src/sim `predictBombImpact`: quadratic drag relative to the air, wind, the aircraft's velocity at release). The drift wire is the ground track projected into the view, and the cue picks the enemy target nearest the track ahead: run-in with seconds and a steer call, release when the impact lies within the target's release radius, overshot once it is past. The radius is where the sim's `blastDamage` for that target type falls to 0.25 under the next store's charge, plus the half-width of the target's narrower side (about 19 m for a lorry, 12 m for a battery, with 20 kg). A release key held across a seat change is ignored until released. Pilot-aimed types release through `controls.releaseBomb`, others through `stationInputs.releaseBomb` at the aimer's station, both held while R is down (the lead's call: the sim drops one bomb per rising edge, and the game never pulses or clears the flag); F6 takes that station. The Quick Mission "Bombing raid" was first offered only on a dev server with `?bombing`, with a stand-in builder; track D's builder replaced both (D-098).
**Consequences.** The target runs down the wire to the mark, which is easy to read. The cue follows any change to the sim's blast table without an edit here.

## D-093 — Bomber specifications: loaded figures, and which source wins (track B, bombers wave 1)
**Context.** The six new types (AEG G.IV, Gotha G.V, Handley Page O/400, Voisin III, Breguet 14 B2, D.H.9) need specs the flight model can be calibrated to. Published figures mix loaded and empty performance, and several disagree by thousands of metres of ceiling.
**Decision.**
- **Loaded figures.** Every bomber's speed, climb and ceiling are with its historical bomb load, and `massLoaded` includes it (D-086), so a bomber that drops its load outperforms its card, as the real ones did. Where a loaded figure exists it wins over a higher empty one: the Gotha's 4650 m ceiling and 3000 m in 28 min with bombs (Grosz), not 6500 m; the Breguet's 5550 m with 256 kg of bombs; the AEG from an Allied test of a captured aircraft.
- **O/400:** ceiling 3960 m (13,000 ft, Barnes), climb to 3000 m in 40 min (aeropedia).
- **Estimates, marked in the data:** the Breguet's loaded climb (18 min) and the Michelin bomb's 2.5 kg charge; the Voisin's climb, 45 min. The first guess of 52 min fails calibration because it needs a power lapse beyond the 0.55 bound.
- **Twins:** `enginePowerHp` is the total (2 × 260 hp Mercedes D.IVa, 2 × 360 hp Eagle VIII), and `nacelleOffsetX` puts each propeller clear of the fuselage (`aircraft.test.ts` and `models.test.ts` check it).
- **The Gotha keeps `pusher: false`.** Its nacelles push, but the fuselage is an ordinary tractor-style one with the tail on it, and `pusher` means the boom layout to the generator and the sim.
- **D.H.4 charge:** 16 kg, not 20: the 112 lb R.L. bomb carried 35 lb of amatol (GWAS table, "Details of Aerial Bombs").
- Sources and the full table are in docs/models.md, "Bomber specifications and sources".
**Consequences.** Every new type passes `coefficients.test.ts` and the 6-DOF `performance.test.ts` inside the existing tolerances, with no change to `src/sim`. The O/400's rate of climb at 1.12 × its ceiling is 0.69 m/s against the test's 1.0 limit, the closest of the roster.

## D-094 — Crew stations for the bombers, and three two-seaters corrected (track B, bombers wave 1)
**Context.** D-086 derives a pilot and one observer for any type without its own stations. That is wrong for the multi-gun bombers, and thin for three existing types.
**Decision.**
- **Gotha G.V:** nose (bomb aimer), dorsal and ventral ("Tunnel gun"). The dorsal and ventral share crew member 2: one gunner worked both, firing down through the tunnel. **O/400:** nose (twin Lewis, bomb aimer), dorsal (two pillar Lewis), ventral (a fourth crew member at the floor hatch). **AEG G.IV:** nose (bomb aimer) and dorsal.
- **Arcs** for the bomber positions are read from photographs of what wings, propellers and tail leave open. The nose is open ahead, to the sides and below. The dorsal is open high and to the sides, and level astern. The ventral fires down and aft. No arc passes through a propeller disc, measured from each gun mount on the models (`models.test.ts` "fields of fire"). So the AEG's nose, just ahead of its tractor propellers (discs about 104–140° either side), stops at 100° below 35°. The Gotha's dorsal, between its pushers (discs 64–83°, up to 27° high), keeps the sides forward of the beam above 32°. The Gotha and O/400 noses are far enough forward that their discs lie beyond 120°.
- **D.H.9 and Breguet 14 B2** list their stations so the observer's eye sits over the ring between his twin Lewis guns, not beside the first one. Their arcs copy `REAR_OBSERVER_ARCS` (`REAR_RING_ARCS`, tested equal).
- **Voisin III:** the observer stands behind the pilot, fires a strip-fed Hotchkiss over the pilot's head from a tripod, and drops the shells.
- **F.E.2b** gains its second Lewis, on the telescopic pillar between the cockpits, fired back over the top wing (arc 80° to −80° through astern, 8° to 80° up). The observer works both guns; D-066 left this gun out.
- **B.E.2c:** the observer sits in the front seat under the centre section. His arcs are now the sides (from 35° off the nose, clear of the propeller disc) and back over the pilot's head, not ahead or straight up. The derived arcs had treated him as an aft-facing observer.
- Every bomber marks exactly one bomb aimer (`aircraft.test.ts`), and `crewStationProblems` stays empty.
**Consequences.** Fights involving the F.E.2b (a second gun) and the B.E.2c (a different field of fire) change once track A's combat reads stations. The D.H.4 and Bristol keep one Lewis each, although some carried twin Lewis; adding a second gun there is a balance change and was not done.

## D-095 — Models for stations, twins and bombs; the triangle budget (track B, bombers wave 1)
**Context.** The station views, twin engines and visible bomb loads all need things the one-observer GLB contract didn't have.
**Decision.**
- **Node contract** (docs/models.md):
  - `Gun_<station>` pivots, with `_2` and up for separate mounts, and `EyePoint_<station>` empties.
  - `Propeller_L/_R` and `Engine_L/_R` for twins, with engine 0 on the left.
  - `Bombs` > `Bomb_<store>_<k>`.
  - `Gunner_2` and `Gunner_3` for crew members 2 and 3.
  - The older `Gun_Flexible` is still read.
- **Runtime:** each bomb store merges into one mesh, and `setDrawRange` shows the bombs left (`AircraftEntity.bombs`). A store costs one draw call, and without `bombs` nothing is drawn.
- **Additive contract:** `AircraftVisual.setStationView?(station | null)` hides the figure of the crew member at the camera's station, as `setCockpitView` hides the pilot. From the dorsal eye the camera would otherwise sit inside the gunner's head.
- **`Livery.pattern` gains `'disruptive'`:** the French five-colour camouflage of 1917–18, used by the Breguet.
- **Triangle budget:** a twin is 10.3–10.8k triangles, about 1.45× a Bristol F.2b (7.3k), for two nacelles and propellers, paired wheels (12-sided), three gun positions and a bomb load. The Breguet is 9.2k, most of it its 32 bombs; the D.H.9 and Voisin are 7.5k and 8.0k. In the hangar with shadows, a Gotha draws 134 calls and 21.6k triangles, against a Bristol's 108 and 14.5k.
**Consequences.** The GLBs grew from 6.6 MB (27 types) to 9.0 MB (33 types). Track C reads `stationEyes` for the gunner camera and calls `setStationAim` and `setStationView`.

## D-096 — Falling bombs drawn from the sim; bursts sized by the charge (track B, bombers wave 1)
**Context.** Combat simulates bombs (D-086, D-088) and exposes them as `CombatSystem.bombs` (`BombView`), with `predictBombImpact` for where one will land and `getStationAim` for where each station's guns are laid.
**Decision.**
- **Falling bombs:** the renderer draws the sim's bombs, not a copy of its own, so wind drift and drag match. `WorldRenderer.update` takes them as an optional fifth argument, `bombs?: readonly BombView[]` (additive). Without it none are drawn. The game layer passes `this.combat.bombs`. A falling bomb is drawn at the size of its store on the rack: one table, `bombDimensions()` in `src/data/aircraft.ts`, which the aircraft JSON export hands to the Blender generator.
- **Gun rings:** the aircraft visual reads `getStationAim(ac, station)` every update, for AI gunners and the player alike. An idle station returns to its rest pose, and `aimFlexibleGun` / `setStationAim` apply only while the sim has no aim there.
- **Bursts:** the flash, fireball and earth fountain scale with 1.2 · kg^⅓ of charge.
- **Craters:** a crater decal is draped over the terrain. All the mission's craters are one merged mesh, reused as a ring of 128.
- **Audio:**
  - The release clunk.
  - A whistle heard only within 700 m of the sim's predicted impact (`predictBombImpact`), timed to end at it.
  - A burst whose loudness, reach and pitch follow the charge.
  - Twin engines: two voices, the second 1.3% fast so the pair beats, each with its own `damage.engines[i]`.
**Consequences.** Until the game layer passes `combat.bombs`, bursts and craters still appear, but no bomb is drawn falling. The crater texture is created with the effects system, so the first burst doesn't recompile a shader (a 150 ms frame before).

## D-097 — AI pools apart from flyable (campaign and AI track, bombers wave 1)
**Context.** `aircraftPool` (`src/campaign/squadronUtil.ts`) kept only non-flyable two-seaters in AI recon and bomber flights (`!a.flyable`), which in practice left out the one flyable two-seater, the Bristol F.2b. The bombers wave makes the R.E.8, D.H.4, Rumpler and the other two-seaters flyable, and that rule would have emptied the pools.
**Decision.** "The player may fly it" (`flyable`) and "the AI flies it in recon and bomber flights" are separate. The pools no longer read `flyable`; recon and bomber pools leave out only `AI_FIGHTER_TWO_SEATERS` (the Bristol F.2b), which the AI flies as a fighter. A test flips every two-seater and bomber to flyable and checks every pool (both sides, four roles, eight dates) is unchanged. Bombers stay in the bomber pool, so track B's new types join career bomb-task flights as soon as they are in service.
**Consequences.** Today's pools are identical. The list lives in campaign rather than as a spec field, since it is a campaign choice and the data file is track B's; a later spec field (for instance `aiRoles`) could replace it.

## D-098 — AI bombers: a straight and level run, release on the leader, a formation that holds together (campaign and AI track, bombers wave 1)
**Context.** AI bomb-task flights only flew their route (docs/bombers.md). Track A gave the sim bombs, a held release input and `predictBombImpact`; the AI had to fly a bomb run, release, and fly the formation the way day-bomber crews did.
**Decision.**
- **Release rule.** The leader (or a bomber alone) aims at the target whose stick puts the most of his formation's tracks within blast reach of a target, and from 5 km out flies straight and level, correcting the heading by at most about 11° to lay `predictBombImpact` onto it. He starts his stick (all his bombs, 0.25 s apart) when the predicted impact is half a stick short, so it straddles the target. More than 35 m off to one side he goes round, out beyond the run's start; on the third run he releases anyway. The run begins only with the target within 30° of his track, so a bomber who takes the waypoint close in and facing away turns in, or goes out and comes round, first.
- **The formation releases on the leader.** A bomber keeping station waits for the leader's first bomb (`getBombStats`, so it works for a human leader too), then starts his own stick when his own predicted impact comes abreast of the leader's first (at most 4 s). A fixed delay (distance behind at his speed) put the wingmen's bombs 30-50 m long: a wingman catching up flies faster and throws further. The quick raid lays its targets out at the formation's spacing, so each track passes over one.
- **Formation behaviour under attack.** A bomber with a flight-mate within 600 m holds formation: no defensive manoeuvres, and hurt but flying ('wounded', 'airframe damaged') he keeps his place instead of going home alone. The gunners fight. Nobody jinks on the run. A bomber alone defends as a two-seater does, and engine trouble, fire or fuel still send a man home. The leader flies at 0.72 of top speed so the formation can keep station (a lone D.H.4 at 0.8 outruns a D.V and was never caught in testing). Nobody follows a leader who turns for home hurt before bombing (judged by his bombs, still aboard, not the follower's); the next man leads, from the old leader's place on the route, and the formation doesn't take him back once it has bombed. Behind `TACTICS_FLAGS.bomberFormation` (on).
**Consequences.** `bombers.realsim.test.ts`: three D.H.4s put at least 7 of 12 bombs within blast range of a depot (9 in the reference run, the leader's stick centred within 2 m), and hold formation under attack. In the raid survey (24 raids a setup) every bomb goes and 44-51% burst on a target, for 25-43% of the bombers lost; with the flag off only 19-71% of the bombs are dropped (docs/ai.md "Bombers").

## D-099 — Interceptors go for bombers from their blind spots; escorts stay with the bombers (campaign and AI track, bombers wave 1)
**Context.** The quick raid needs interceptors that attack the bombers, not the escort, and escorts that protect them. Fighters treated a D.H.4 like any two-seater: a +0.5 target score for `defend` flights, and "approach two-seaters from below" as a small nudge. Escorts engaged anything within 1.8 km of their charges and chased it.
**Decision.**
- **Target choice.** `defend` fighters score bombers +0.9 (other two-seaters keep +0.5), and a bombers' escort not attacking them or their flight −0.3. An escort that attacks is fought. Escorts of recon two-seaters (the player in most career and quick escort missions) are scored as before.
- **Interceptor approach.** Above novice, against a bomber from 250 m to 1.8 km, a fighter first flies to the direction (from the bomber) covered by the fewest of its live gunners' arcs, among below-and-behind, below-the-beam and ahead-and-below candidates, nearest his bearing with ahead of the beam penalised 150°. That puts him below and behind every type whose tail is open; a Gotha's tunnel gun would move him to below the beam. Inside a 25° cone of it, or 250 m, the ordinary pursuit takes over. `TACTICS_FLAGS.blindSpot` (on). The D-085 defence and fighter-on-fighter pursuit are untouched: the approach applies only to bomber targets.
- **Escorts.** A bombers' escort engages only scouts coming at a bomber (within 1.5 km) or at itself (700 m), and drops a target that goes more than 1.2 km from the bombers. Recon escorts keep the old rule.
**Consequences.** Against a pair of D.H.4s (8 seeds) a veteran D.VII spends 87% of its time within 700 m out of the gunners' arcs, against 57%, and takes 5 hits instead of 33, for the same hits on the bombers. Career escort missions of bomb-task flights change for the autoplayer and its enemies alike (career A/B in docs/ai.md "Bombers").

## D-100 — Shared instructions and ownership across agent harnesses
**Context.** D-007 isolates parallel module work, but the project instructions mixed shared
rules with Claude Code tool parameters and sandbox observations. omp already discovers
`CLAUDE.md`; a second independent rulebook would drift, and a native `.omp/AGENTS.md` could
shadow the shared instructions. Concurrent top-level sessions also compete for Git state,
dev-server ports, flight-report output and the machine's GPU.
**Decision.** Root `AGENTS.md` holds shared project policy and task-triggered pointers to
`docs/HARNESSES.md` for harness mechanics and context-discovery details. A single source of
truth does not require a single always-loaded file: the reference is read on demand, not
imported. `CLAUDE.md` contains only `@AGENTS.md`, so either root entry point yields the same
shared rules and pointers. Changes to discovery/imports require fresh-session verification
in both harnesses and their isolated workspaces. Future friction lessons are classified as
shared outcomes or harness-specific observations before promotion to the appropriate file.

Extend D-007's ownership model to top-level sessions from every harness: each concurrent
editing session owns a branch/workspace and names an integration owner in its brief.
The main checkout remains for human play and the designated integrator. Without that
designation, an agent hands off a committed task branch; it does not merge or push `main`
(which triggers deployment). Parents integrate retained child patches and verify the
integrated behaviour. Temporary scaffolding is not completed user-visible behaviour.

`AGENTS.md` defines the operating contract for explicit strict ports, separate automated
flight-report output, task-local scratch artifacts, coordinated GPU verification, managed
jobs and browser evidence. Harness mechanics stay labelled and defer to the active tool
schema; no cross-harness messaging or common isolation layout is assumed.
**Consequences.** No new runtime dependencies, harness settings, port registry or GPU lock
service. Existing Claude worktrees and historical friction records are preserved. Manually
managed worktrees preferably live outside the checkout; nested workspaces need a context
check rather than an assumption about ancestor discovery. The integration owner separately
checks and obtains approval for removal of existing worktrees. Browser QA can respect each
harness's policy while retaining the existing Playwright regression suite.

**Verification (2026-09-29).** Fresh no-tools omp 18.4.4 and Claude Code 2.1.285 sessions
quoted the migrated rules from the task worktree and a disposable nested worktree; both
nested probes reported the workspace marker and no conflicting rulebook version. Claude's
probe required project settings-source discovery; the consultation bridge's empty source
selection did not load project instructions. A real Vite server served the game and saved
a report POST under task scratch while both inbox snapshots stayed unchanged. A second
server on the same strict port failed with "Port 5267 is already in use". Typecheck passed;
Vitest passed 623 tests (30 skipped) in 86 passing files (15 skipped). No game behaviour,
runtime configuration or persistent harness settings changed.

**Progressive-disclosure verification.** After extracting the harness reference, fresh
Claude (low effort) and omp sessions reported shared policy and pointers in their initial
project context, then fetched the applicable reference section for a background-job task.
Claude read only its section. omp requested its exact section range, but the read/search
tools included adjacent previews; section-only exposure is therefore a tool limitation,
not guaranteed by the pointer. The harness reference is not eagerly imported. Typecheck and the
623-test passing unit suite remained green after the extraction.

## D-101 — Share bomber support geometry, nacelle placement and crew posture
**Context.** The shipped Gotha, AEG and O/400 models have wheel contacts 0.52–0.96 m
below the simulation's generic −1.2 m datum. Their nacelles are positioned by private
Blender tables, while damage uses wing-edge heuristics. Floor gunners receive the same
standing body offset as ring gunners. Flipping the Gotha's `geometry.pusher` would corrupt
its fuselage layout rather than describe its nacelles.

**Decision.** Add optional `AircraftGeometry.gearContacts` (right main support and central
skid, body-frame metres), `AircraftGeometry.nacelle` (body Y/Z centre, length, radius and
independent pusher orientation), and `CrewStation.posture` (standing by default, prone for
the two floor stations). The three twin specs own values recovered from the shipped
generator and checked against GLB geometry. These are model-alignment data, not a claim
of measured historical airframe dimensions. The existing JSON exporter carries geometry
into Blender; the generator and simulation consume the same data rather than duplicate
aircraft-ID tables. Single-engine types keep their existing derivation.

**Consequences.** Contracts are additive; no public signature or aircraft availability
changes. Specs remain immutable after caching. Ground attitude must follow the support
points, and engine damage must follow cowling volume, not its decorative bearers.
Independent shipped-model measurements, ground/roll simulation, and hit rays are the
verification seams. Numbered during the authorized PR #4 integration into main.

**Implementation and verification (2026-10-04 UTC).** The simulator and Blender now
consume this metadata; baseline/candidate Blender meshes are identical for all three
twins. Ground support pitch follows the actual support line. Remove the 0.7 rad/s roll
floor, retaining the fighter calibration and relative `rollRate` semantics. Propeller
discs already use per-engine power; protect that invariant instead of changing it.
Prone boxes extend forward of the eye, retain floor-hatch exposure and fit the full
fuselage envelope, not every tapered skin section. Engine boxes cover cowling bodies,
not decorative bearers or the Gotha's 8 cm front cap. Shared scene-free GLB measurements,
loaded ground/takeoff regressions and round traces cover the consumers; real Chrome/Metal
ground/takeoff and overlay evidence is recorded in `docs/bombers.md`. Independent review
found no defects in this slice. Aircraft availability and AI balance remain unchanged.

## D-102 — Compare exact observations in isolated Vite SSR processes
**Context.** Ad-hoc review probes attempted to call TypeScript compiler APIs that TS7
does not expose. A second probe differed only because one side had initialized lazy
crater grids and the other had not. Repeated bespoke loaders and asymmetric setup
make equivalence evidence unreliable.

**Decision.** `tools/dev/differential-probe.mjs` accepts explicit existing baseline and
candidate roots, one native `.mjs` scenario, and one input. It runs that scenario in
sequential fresh processes with configless Vite SSR for root-relative TypeScript imports.
There are no side-specific setup hooks, project config/plugins/environment files,
browser launches, installs or automatic worktree management. The loader uses the tool
checkout's existing Vite dependency, not TypeScript runtime compiler APIs.

**Evidence contract.** Return plain data; compare numbers with `Object.is`, including
nonfinite values and signed zero. IPC preserves them and CLI JSON uses reserved
`$number` tags. Reject unsupported observations instead of erasing them. Exit codes are
0 equal, 1 different, 2 failed; late nonzero exits, missing results, exceptions and
timeouts cannot pass. Reports carry complete observations, scenario/input identity,
canonical roots, revision/dirty-tree fingerprints, runtime versions and diagnostics.
The parent cleans temporary loader caches even after timeout termination.

**Limits.** Equality is evidence for the selected inputs, not universal equivalence.
Roots are live and must stay fixed; detected Git-visible changes fail. Ignored files,
dependency contents and native scenario helper imports are not fingerprinted. Keep those
fixed, seed scenarios, avoid external clocks/I/O, and snapshot reusable scratch values
before another call. Statistical AI outcomes still belong to `ab.mjs`, not this tool.

**Implementation and verification (2026-10-04 UTC).** Real geo/world graphs and lazy
initialization histories run through the public API and CLI. Baseline `66518dd` and the
integrated tree have exactly equal world observations and three representative fighter
flight/damage snapshots; the intended bomber changes report different. Independent
review identified Array subclasses losing inherited information across IPC: the CLI
reproduced false acceptance before the fix and now rejects them with exit 2. Eight Node
regression tests pass, covering isolation, error exits/timeouts and numeric identity.
`pnpm test` includes `pnpm test:tools`, so the existing CI gate runs them too. No runtime
dependency or game configuration changed.

## D-103 — Expose the verified bomber and two-seater roster to players
**Context.** D-101 resolves the simulation-readiness blockers and D-097 already separates
AI role pools from player availability. The original bomber scope calls for all shipped
multi-crew aircraft to be player-accessible; keeping them gated now only hides working
aircraft and forces a bomber/seat reset when leaving a raid.

**Decision.** Set `flyable` for the 14 remaining gated aircraft. Keep one selection
policy in `quickPlayerAircraft`: every mission requires player availability, and bombing
raids also require bombs. Preserve valid aircraft and station choices across mission
changes and saved-option reloads. Retain existing fallback/seat-sanitization behavior for
incompatible choices rather than adding a parallel aircraft list or save migration.

**Scope and verification (2026-10-04 UTC).** No aircraft physics, AI role composition,
career squadron content, shared contracts or dependencies change. The actual UI offers
33 aircraft, seven of them for raids. All 14 new choices were exercised; real Gotha tunnel
and pilot handoff plus F.E.2b nose-gunner flights rendered successfully. The updated D.H.4
raid/debrief/mission-transition browser regression passes. Fresh-process baseline
comparison shows equal AI pools and career equipment selections at five service dates.
Availability regression fixtures invert and restore original flags rather than pinning
the old release gate. Commands and evidence are recorded in `docs/bombers.md`.
Number assigned during the authorized PR #5 integration into main.

## D-104 — Spend high-quality scenery detail on nearby tree silhouettes
**Context.** The selected graphics target is high-end visuals at 60 FPS, with
cheaper low/medium presets retained. Broadleaf crowns were two overlapping masses,
even at close range; adding density would multiply that repetition.

**Decision.** High/ultra use four asymmetric crown lobes and two branch segments
for nearby broadleaf trees (384 triangles instead of 184). Keep the same instanced
draw call, placement, near/far switching and distant geometry. Low/medium retain
their exact prior near-tree geometry through an explicit renderer quality setting.
No shared core contract, simulation or dependency changes.

**Evidence and limits.** In a Ypres forest view with 7,295 near broadleaf instances,
Chrome/Metal on Apple M3 Max measured baseline GPU p50 4.86 ms versus 5.49–5.52 ms
with clustered crowns; ultra measured p50 11.80 ms, p95 12.63 ms in that view.
These are short scene-specific GPU samples, not whole-game or cross-hardware
60-FPS guarantees. Low/medium geometry attributes were compared with the baseline
and matched exactly. Number assigned during the authorized PR #7 integration into main.

## D-105 — Scale aircraft surface shaders and refine existing cockpit shapes
**Context.** Detailed finishes previously applied at every quality level. Close
cockpit silhouettes still exposed square gun receivers, angular padding and flat
panel construction.

**Decision.** Low keeps base colours/livery/wood grain; medium adds roughness detail;
high/ultra retain relief and varnish. Cache immutable materials by finish and share
textures lazily. Pass the session quality explicitly through the aircraft factory;
its shared contract gains only an optional third graphics-quality argument.
Refine the generator's existing pilot padding, panel and fixed gun shapes across
the roster, preserving node/transform contracts, primitive count and the 12,000
triangle ceiling. Do not invent aircraft-specific historical instrumentation.

**Evidence and limits.** Pinned in-engine before/after captures and GPU samples are
documented in `docs/models.md`. Real flights exercised all four presets; simultaneous
mixed-quality construction and low-instance disposal preserved high-quality finishes.
Measurements are scene-specific. The largest regenerated model is Gotha at 11,844
triangles. No simulation, dependency or instrument-reading changes. Decision number
assigned during the authorized PR #8 integration into main.

## D-106 — Separate validation from publication and centralize browser setup
**Context.** Backlog execution found manual branch CI could reach Pages deployment,
and browser specs duplicated controller stubs and incompatible cold-flight waits.
Historical task dispositions obscured already-completed work.

**Decision.** PR and manual events use the same read-only validation pipeline;
only a successful main push can upload/configure/deploy Pages. Publication owns
its permissions and concurrency group. Keep the runner pinned until its dated upgrade.
Browser automation shares context-level gamepad isolation and one session-frame
readiness policy; GPU specs use one worker. Real game input remains unchanged.
STATUS owns the rolling queue; BACKLOG records execution, measurements and debt.

**Consequences.** Branch checks cannot publish, including manual main validation.
Number assigned by the integration owner during the user-authorized PR #9 merge.
Full browser runs still need an exclusive machine GPU slot. Refactors consolidate
existing behavior, without runtime dependencies or shared game-contract changes.
Verification and measurement limitations are recorded in `docs/BACKLOG.md`.

## D-107 — Compare real survey outputs without manufacturing precision
**Context.** Tailhold, defence and raid had reporters but no A/B adapters. Their
rounded aggregates do not contain the counts needed for new statistical verdicts.
Comma-separated environment assignments also conflicted with comma-valued tactics.

**Decision.** Drive the existing reporters with matched inputs and preserve raw
output, relevant environment (including damage mode), resolved revisions and exits.
Keep existing career/quick/fairness intervals; new adapters are descriptive only.
Repeat `--env`/`--a`/`--b KEY=VALUE`, splitting only the first equals sign; remove the
ambiguous grouped-variable syntax. Defence compares explicit survey modes because
the reporter overrides defence flags. Repeated identical fairness cohorts count once.

**Consequences.** CLI users must repeat options for multiple environment variables.
Valid zero-denominator and two-aircraft crash reports remain comparable, without
inventing percentages or sample counts. Invalid or failed reports retain diagnostic
evidence but emit no comparison. No runtime dependencies or gameplay-policy change.
Number assigned by the integration owner for the user-authorized PR #11 integration.

## D-108 — Add touch intent without a second flight-control system
**Context.** Browser menus already use native controls, but a phone could not fly
without a keyboard, mouse or controller. iPhone performance and lifecycle behavior
cannot be inferred from a desktop GPU or emulated viewport.

**Decision.** A pointer-owning UI overlay sends normalized intent through InputManager
and the existing crew/command path. Keep throttle authoritative, bypass the mouse
instructor while touch owns the stick, and treat bomb/jam/menu presses as edges.
Separate the sheet's simulation hold from external modal input capture; retain a
Menu escape when the HUD or gesture controls are hidden. Cancel transient intent
on seat/ownership/lifecycle transitions without erasing desktop AI handback.
Use capability detection and an explicit toggle, not user-agent sniffing.

**Consequences.** Responsive safe-area menus and touch-only browser flights can be
verified locally without changing physics, shared core contracts or dependencies.
Physical recent-iPhone Safari acceptance, repeated save/reload/app-switch checks and
a sustained 15-minute frame-time/thermal measurement remain required before claiming
on-device playability or selecting a mobile graphics preset.
Number assigned by the integration owner for the authorized touch-control release.
