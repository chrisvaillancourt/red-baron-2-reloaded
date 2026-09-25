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
- **Wound effects:** a wounded pilot pulls (−35%) and rolls (−25%) less in the flight model and aims worse as AI. `pilotGTolerance(ac)` (5.5 g → 2.5 g with wounds) is exported for a wound-aware grey-out; it is not yet wired into the game's overlay.
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

## D-XXX — Trenches drawn as energy-conserving lines; woods mottled, not ink (render wave 6)
**Context.** PLAYTEST #3: from 1.5–3 km the trench line read as a thick black sawtooth ribbon and woods as flat black blots. The shader widened each trench's anti-aliasing band with the pixel footprint (`smoothstep(1.3 ± 0.6·px)`) and kept a 30% floor, so a 2 m cut with a ±3.5 m zig-zag filled 5–8 pixels at ~1 km. Far woods were a flat, dark palette colour with the near-field noise averaged away. Thresholded single-octave value noise also drew lattice-aligned squares (chalk splashes, Flanders wet ground).
**Decision.**
- **Box-filtered coverage:** cuts, spoil and wire use `bandCov`/`ringCov`, the exact box filter of a band against the pixel footprint. Sub-pixel features get fainter, never wider, with no floor, and every feature fades out together before the 40 m/px cutoff.
- **Recon-photo look:** thin dark cuts (shadowed earth at 0.36× the local ground, not near-black), pale chalk spoil in Artois/Somme, dun breastworks in Flanders, and a faint grey band for wire from altitude.
- **Trench traces:** fire and support lines are crenellated (bays and traverses) with irregular bay lengths, and the reserve zig-zags. The pattern fades to a straight line once a bay is a few pixels long, widening the cut by the path-length ratio so its tone is conserved. Communication trenches wander and about a third of lanes have none.
- **No-man's-land:** a ragged, mottled brown-grey tint over the existing crater shading, not a replacement colour (a flat replacement read as a paved strip).
- **Woods:** multi-scale canopy tone (stand, clump, crown), each fading to its mean, over lighter seasonal forest colours. Autumn tree tints are less orange.
- **`tblob`:** two rotated value-noise octaves for thresholded patches.
**Consequences.** From 1–3 km the network reads as fine pale lines, from 2 km straight down as parallel chalk lines with communication trenches, and at 50–300 m as dark crenellated cuts edged with spoil. The wave-4 low-level crater look is unchanged. Cost: +0.16 ms p50 on 'high' in big16 (A/B mean of five, 3.64 against 3.48 ms), within noise in the `frontShots` views. The trench trace direction is still a fixed world axis (`along`), so lines running east–west show stretched bays; an arc-length parameter would need a per-vertex attribute.
