# Bombers and gunner seats: plan (not started)

This is the plan for the next big feature, agreed with the user on 2026-09-28. No code has been
written yet. The lead writes the `src/core` contracts first, and parallel agents then build
against them.

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

## Proposed contracts (additive; lead to finalise before the wave)
- `AircraftPerformance.engineCount?: number` (default 1). The power is split across the
  engines, so engines can be damaged one at a time, with asymmetric thrust.
- `CrewStationId = 'pilot' | 'observer' | 'nose' | 'dorsal' | 'ventral' | 'rear'`.
- `CrewStation`:
  - `id`, `label` and `eye` (body frame)
  - `guns: number[]` (indices into `spec.guns`)
  - `arc?: { azimuthDeg: [from, to]; elevationDeg: [min, max] }` (0° = ahead, positive =
    right, the range may wrap)
  - `bombAimer?: boolean`
- `AircraftSpec.crewStations?: CrewStation[]`, with a derivation helper for existing types:
  the pilot, plus an observer when the aircraft has a flexible gun. `GunMount.station?`
  names the station that works the gun.
- `AircraftSpec.bombs?: { name, massKg, explosiveKg, count }[]`, the historical loads. The
  entity gets `bombs?: { loadIndex, remaining }[]`.
- `ControlInputs`:
  - `releaseBomb?: boolean` (edge-triggered)
  - `stations?: Partial<Record<CrewStationId, { aim: world direction; fire: boolean }>>`. A
    station the player controls overrides the AI gunner.
- `MissionType` and the quick types gain `'bombing'`. Ground targets gain depot, railhead
  and hangar kinds.
- `GameEvent` gains `bomb-released` and `bomb-exploded`.
- `MissionResult` gains optional `bombsDropped` and `bombHits`.
- The damage model gets one gunner zone per station.
- New key actions: next or previous station, jump to the pilot, release bomb, and
  bombsight view.

## Waves
1. **Lead:** the contracts above, with the derivation helper and tests, still green. Then
   update `docs/ARCHITECTURE.md` and add a DECISIONS entry.
2. **Parallel agents** (worktrees), after the contracts:
   - **sim + combat:**
     - multi-engine thrust and damage
     - bomb mass and a centre-of-gravity change on release
     - bomb ballistics and blast damage to ground targets
     - multi-station flexible guns with per-station arcs and a per-station gunner AI (the
       refactor of `updateGunner`)
     - player-controlled stations
   - **data + models:**
     - specs for the seven new types, calibrated to historical speed, climb and ceiling
     - crew stations and arcs for every multi-crew type
     - the Blender generator: twin nacelles, big spans, gun rings, the ventral tunnel,
       bomb racks
     - liveries (Gotha lozenge, O/400 PC10), and a hangar check in-engine (not only in
       Blender: see CLAUDE.md)
   - **game + UI:**
     - seat switching, with the AI flying while the player guns
     - a gunner camera with mouse aim on a flexible gun
     - a bombsight view and bomb release
     - the HUD for gunner and bomb aimer
     - Quick Mission: a "Bombing raid" type, and a choice of station
     - Flying Manual and key-binding updates
   - **campaign + AI:**
     - bombing-raid mission generation (quick in wave 1, career in wave 2)
     - AI bomber formations and bomb runs
     - AI gunners at every station
     - escorts and interceptors
     This track **waits for the defence track to merge**, because both touch
     `src/ai/controller.ts`.
3. **Merge, re-baseline and playtest,** then career bomber squadrons (wave 2), then night
   bombing.
