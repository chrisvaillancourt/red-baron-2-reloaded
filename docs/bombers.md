# Bombers and gunner seats: plan (wave 1 in progress)

This is the plan for the next big feature, agreed with the user on 2026-09-28. The lead's
`src/core` contracts landed as D-086; parallel agents now build against them (see "Tracks").

## Scope (user decisions, 2026-09-28)
- **New aircraft, all flyable:**
  - Heavy twins: Gotha G.V (Germany; three gunners, including the ventral "Gotha tunnel")
    and Handley Page O/400 (Britain).
  - A smaller German twin: AEG G.IV.
  - Day bombers: Breguet 14 B2 (France), Airco D.H.9 (Britain), and the existing Airco D.H.4,
    which becomes flyable.
  - Early war: Voisin III (French pusher, 1915).
- **Gunner seats in every multi-crew aircraft,** not only bombers. The Bristol F.2b and the
  AI-only two-seaters become flyable: R.E.8, D.H.4, Rumpler C.IV, Halberstadt CL.II,
  Albatros C.III, B.E.2c, F.E.2b and Farman F.40. They have specs and models already. The
  player can take any crew station; the AI flies or mans the rest.
- **Modes:**
  - Wave 1: a "Bombing raid" quick mission with targets, AA, interceptors and an optional
    escort.
  - Wave 2: career bomber squadrons, with raid missions, promotions and medals. Candidates:
    Kagohl/Bogohl 3 (Gotha), 207 and 216 Sqn (O/400), a Breguet escadrille, 55 Sqn (D.H.4)
    and a D.H.9 squadron.
- **Night bombing is deferred** to its own wave. It needs dark lighting, searchlights, target
  fires and navigation aids.

## What exists today (surveyed 2026-09-28)
- **Contracts:**
  - `AircraftRole` already has `'bomber'`, and `EngineType` has `'twin-inline'`, which is
    unused.
  - Only the D.H.4 is a bomber, and it is AI-only.
  - `MissionFlight.task` has `'bomb'`, and `missionGen.twoSeaterFlight` gives bomber flights
    that task. They only fly the route: **there are no bombs at all.** Nothing is released,
    aimed or exploded.
- **Guns:**
  - `GunMount.mount` is `'fixed-*'` or `'flexible'`.
  - The rear gunner's AI lives inside combat (`src/sim/combat.ts` `updateGunner`). It
    supports **one flexible gun per aircraft, and only for `geometry.crew === 2`**, which is
    why D-066 skipped the F.E.2b's second Lewis.
  - The field of fire is `flexibleArc()`, hard-coded as rear-facing, or nose-facing through
    `gunnerFacesForward(spec)` in `src/sim/hitboxes.ts`.
  - `setGunnerTarget` / `gunnerTargets` let the AI pick the gunner's target.
  - `GunState` is per mount (`mountIndex`).
- **Damage:** `DamageState` has one `'gunner'` zone.
- **Controls:** `ControlInputs` is pilot-only (pitch, roll, yaw, throttle, blip, fireGuns,
  clearJam). There are no gunner or bomb inputs.
- **Game layer:** there is no concept of a player crew station. The cameras are cockpit,
  chase, padlock, fly-by and target.
- **Wingman order keys are 1–5,** so crew-station keys need other bindings.

## Contracts (landed, D-086)
The shapes are in `src/core/types.ts` (search "Crew stations and bombs"), and D-086 gives the
reasons. In short:
- `CrewStation { id, label, crewIndex, guns, arcs, eye?, bombAimer? }`, read only through
  `crewStations(spec)` in `src/data/crew.ts`. Stations sharing a `crewIndex` are one man.
  `inFireArcs(arcs, x, y, z)` tests a body-frame direction, and `crewStationProblems(spec)`
  validates a spec (a test runs it over the whole roster).
- `AircraftEntity.stationInputs?` carries the player's aim, fire, bomb release and jam clearing
  at a non-pilot station. The player's aircraft keeps `controller: 'player'`.
- `AircraftSpec.bombs?` (included in `massLoaded`) and `AircraftEntity.bombs?` (left per store);
  `ControlInputs.releaseBomb?`; events `bomb-released` and `bomb-exploded`; `MissionResult`
  `bombsDropped?` and `bombHits?`; waypoint action `'bomb'`; mission and quick type
  `'bombing'`, with `escortCount?` and `escortAircraft?`.
- `performance.engineCount?`, `geometry.nacelleOffsetX?`, `DamageState.engines?` and
  `crewWounds?`; `geometry.crew` is `1 | 2 | 3 | 4` (check `crew >= 2`, never `=== 2`).
- `GunType` `'hotchkiss'`; `AircraftVisual.stationEyes?` and `setStationAim?`.
- The D.H.4 carries four 112 lb bombs as the reference load; it stays AI-only for now.
- **Left to the tracks:** the key bindings (game track: `stationNext` C, `stationPrev` V,
  `stationPilot` F, `releaseBomb` R, `viewBombsight` F6, added with the code that reads them),
  and new ground-target kinds (wave 1 raids use hangars, dumps, trains and batteries).

## Waves
1. **Lead: done** (D-086). The contracts, `src/data/crew.ts` with tests, the D.H.4 reference
   bomb load, and `crew >= 2` outside `src/ai`.
2. **Tracks** (worktree agents). Each owns the files listed and codes against the contracts
   for everything else; a contract it needs beyond D-086 stays additive and goes in its report.
   - **A. sim** (owns `src/sim/**`):
     - combat on crew stations: every flexible gun, per-station arcs through `inFireArcs`,
       an AI gunner per crew member (stations sharing a `crewIndex` fire one at a time), and
       `stationInputs` overriding the AI at the player's station. Keep `setGunnerTarget`
       working, with an optional station argument. Today's two-seaters must fight as before
       (the fairness and career soaks through `tools/dev/ab.mjs --base main`, within noise).
     - hit boxes and wounds per crew member (`crewWounds`), twin nacelle hit boxes.
     - multi-engine thrust split by `engineCount`, per-engine damage and asymmetric thrust
       (yaw), `nacelleOffsetX` for placement.
     - bombs: release from `controls.releaseBomb` or `stationInputs.releaseBomb`, the aircraft
       mass drops as bombs go, ballistics (drag, the aircraft's velocity at release), blast
       damage to ground targets by charge mass and distance, the two events, and the counts the
       mission result needs.
   - **B. data, models and effects** (owns `src/data/aircraft.ts`, `src/data/liveries.ts`,
     `tools/blender/**`, `public/models/**`, `src/render/**`, `src/audio/**`):
     - specs for the Gotha G.V, Handley Page O/400, AEG G.IV, Breguet 14 B2, D.H.9 and
       Voisin III, from references (speed, climb, ceiling, weights, engines, guns and bomb
       loads); calibrate them with the flight-model tests like the existing types.
     - `crewStations` for every multi-crew type whose derived stations are wrong or thin: twin
       Lewis on a Scarff ring, the Gotha's nose, dorsal and tunnel guns, the O/400's positions.
     - models: twin nacelles, big spans, gun rings, the ventral tunnel, bomb racks, and
       `EyePoint_<station>` empties; `stationEyes` and `setStationAim` in the visual.
       Liveries (Gotha lozenge, O/400 PC10). Check the hangar in-engine, not only in Blender.
     - falling bombs, bomb bursts and craters (render), the release clunk, bomb whistle and
       burst (audio), twin-engine sound.
     - set `flyable: true` only in the report's recommendation; the lead flips it when tracks
       A and C have merged.
   - **C. game and UI** (owns `src/game/**`, `src/ui/**`, `src/core/settings.ts` bindings):
     - seat switching (keys above, a seat indicator on the HUD); while the player works a gun,
       an AI controller flies his aircraft, and he gets the pilot's seat back with one key.
     - the gunner view: an eye at the station, mouse aim of the flexible gun with its arc
       shown, the ring sight, and fire, jam and drum controls. Build and test it on the Bristol
       F.2b, which is flyable today.
     - the bombsight view (looking down, with drift and a release cue) and bomb release.
     - the HUD and Flying Manual for gunners and bomb aimers; bomb counts in the debrief.
     - Quick Mission: the "Bombing raid" type and a seat picker, shown only once track D's
       builder exists. Until then, test with a hand-built mission in a `testing/` fixture.
   - **D. campaign and AI** (owns `src/campaign/**`, `src/ai/**`). **Starts after the defence
     track merges,** since both edit `src/ai/controller.ts`:
     - the quick "Bombing raid" builder: targets behind the lines, AA, interceptors, an
       optional escort, the bomb-run waypoint and a destroy-ground objective.
     - AI bombers: formation, the straight and level bomb run, release over the target, and
       the way home; AI escorts and interceptors that go for bombers; per-station gunner
       targeting; the three `crew === 2` checks in `src/ai`.
3. **Merge, re-baseline and playtest,** then career bomber squadrons (wave 2), then night
   bombing.
