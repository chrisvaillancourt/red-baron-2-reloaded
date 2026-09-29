# Aircraft models, liveries and key art

All aircraft geometry and menu art are generated — no third-party assets
(DECISIONS.md D-003). Blender 5.2 runs headless; nothing needs a GUI.

## Regenerating

```sh
node --experimental-strip-types tools/export-aircraft-json.ts          # src/data -> tools/blender/out/*.json
blender --background --factory-startup --python-exit-code 1 \
  --python tools/blender/build_models.py -- [--only camel_id,...] [--preview]
zsh tools/blender/contact_sheet.sh                                      # previews -> out/sheet_N.png
zsh tools/blender/render_art.sh [samples] [title aerodrome desk debrief] # public/art/*.jpg (Cycles, Metal)
```

* `tools/blender/aircraft_gen.py` — the parametric generator (one `Aircraft` class, driven by
  `AircraftGeometry` + a few per-type detail tables at the top of the file: tip shapes, spinners,
  radiators, axle wings, bay counts, the Camel hump, the Bristol's low-slung lower wing...).
* **Crew layouts** follow `spec.guns`: a flexible gun with body z < 0 puts the observer *ahead*
  of the pilot (B.E.2c front seat under the upper wing; F.E.2b/Farman F.40 nose). Two-seat
  pushers get a longer nacelle (nose 2.4 m ahead of the upper LE), an inline engine block at the
  back (`Engine`, not a spinning `RotaryEngine`), and tail booms rooted outside the propeller disc
  (`prop_R() + 0.5`) with `BOOM_TAIL_X` setting where they meet the tail. `NOSE_WHEEL` adds the
  F.E.2b's anti-noseover wheel; `EXHAUST_STACKS` the RAF V-8's stacks over the upper wing.
* **Crew stations and bombers** (docs/bombers.md, D-086). `plan_stations()` lays out every
  station's flexible guns from `crewStations(spec)` (exported with the specs): a **ring**
  (Scarff ring and post, fuselage opening), a **pillar** (a tube over the coaming, or the
  Voisin's tripod) or a **ventral** hatch (the Gotha tunnel, the O/400 floor hatch). Guns
  closer than 0.3 m share one pivot (twin Lewis). The older two-seaters keep their first
  flexible gun on the cockpit-relative ring (`gunY`, 1.05 m behind the pilot); every flexible
  gun of the twins and the Voisin, and every later gun elsewhere (the F.E.2b's pillar Lewis,
  the D.H.9's and Breguet's second Lewis), goes where `GunMount.position` says. The build log
  prints `station <id>.<station>: <kind> at body z …, gun y …, fuselage top … bottom …` for
  those, to tune positions against the modelled fuselage (keep a ring gun about 0.32 m over
  the fuselage top, where a standing gunner's hands are).
* **Twins** (`engineCount` 2): `build_nacelles()` makes two nacelles at `±nacelleOffsetX` on
  bearers between the wings (`NACELLE` sets their gap fraction, length and radius), tractor or
  pusher (`PUSHER_NACELLES`: the Gotha), with radiators, Mercedes heads or Eagle exhausts, and
  paired main wheels (`build_twin_gear`, `FOUR_WHEEL`). The nose ends 0.45 m ahead of the nose
  gunner's ring. Big spans take strut stations in metres (`BAYS_M`), and the O/400's upper-wing
  overhang gets its raked struts (`OVERHANG_STRUTS`). `PILOT_Y` places the pilot where the data
  can't say (Gotha, AEG, O/400, Voisin).
* **Bombs** hang as `Bombs` > `Bomb_<store>_<k>` on beam racks (`BOMB_RACKS`: under the
  fuselage or the lower wings), sized from the store (`BOMB_DIMS`, else from the mass). The
  O/400 carries its sixteen 112 lb bombs inside (`INTERNAL_BOMBS`), so it has no bomb nodes.
* `tools/blender/build_models.py` — builds and exports every type to `public/models/<id>.glb`
  (33 types, 9.0 MB total) and optionally renders EEVEE previews. `--stats` also prints the
  largest parts by triangle count. Budget: single-seaters 4.9–6.7k triangles (195–255 KB),
  two-seaters 6.9–7.7k (260–305 KB), the Voisin, D.H.9 and Breguet 7.5–9.3k, and the twins
  10.3–10.8k (≈420–460 KB): about 1.45× a Bristol F.2b (7.3k), for two nacelles, two propellers,
  paired wheels, three gun positions and a bomb load.
* `tools/blender/art.py` — Cycles key-art scenes; reuses the generator and paints liveries with
  a NumPy port of the runtime painter.
* `dev/hangar.html` — in-engine inspection (any type × livery, turntable, cockpit view, RPM,
  control wiggle, firing, damage, wing break). `node tools/hangar-shots.mjs <url> <outDir> '<json>'`
  screenshots it with Playwright (uses the installed Chrome channel).
* `src/render/aircraft/models.test.ts` parses every GLB in Node and checks the contract below.

## Frame

Blender: nose +Y, top +Z, right wing +X. The glTF exporter's Y-up conversion yields the body frame
directly (forward −Z, up +Y, right +X; DECISIONS.md D-004). Origin = centre of gravity (≈30% of
the mean chord behind the wing leading edge). No node has a rotation; control-surface pivots are
translations only.

## Node contract (names in the GLB)

| Node | Purpose |
|---|---|
| `Aircraft_<id>` | Root. glTF extras (→ `userData`) carry the UV metadata below and `aircraft_id`. |
| `Exterior` | All external parts. |
| `Fuselage`, `Coaming`, `Wing_{Upper,Middle,Lower,Main}_{L,R}`, `Struts`, `Wires`, `Stabilizer_{L,R}`, `Fin`, `Cowling`, `Engine`, `Firewall`, `Undercarriage`, `Wheels`, `Guns` | Static parts (damage zones are inferred from these names). |
| `Aileron_L`, `Aileron_R`, `Elevator` | Rotate about local X (hinge line). E.III has no ailerons (wing warping). |
| `Rudder` | Rotates about local Y. |
| `Propeller` | Hub pivot; spin about local Z. Children `PropBlades` (+ `RotaryEngine` on rotaries — the cylinders turn with the prop). |
| `Propeller_L`, `Propeller_R` (`PropBlades_L/_R`), `Engine_L`, `Engine_R` | Twins, instead of `Propeller`/`Engine`: engine 0 is the left (`DamageState.engines[0]`), engine 1 the right. Four-bladed on the O/400 and Gotha. |
| `Gun_<station>` (`Gun_<station>_2`…) | Pivot of a crew station's flexible guns (`CrewStation.id`: `observer`, `nose`, `dorsal`, `ventral`); separate mounts of one station get `_2`, `_3`. At rest every gun points forward (+Y); the runtime swings it (`setStationAim`) and stows the aft-facing ones. Older GLBs' `Gun_Flexible` is still read as the first station's pivot. |
| `EyePoint_<station>` | A crew station's eye: over the ring centre (0.58 m above the coaming), or `CrewStation.eye` when the data gives one. Read into `stationEyes`. |
| `Bombs` > `Bomb_<store>_<k>` | The bomb load: bomb `k` of `spec.bombs[store]`. The runtime merges each store into one mesh and draws as many as are left. |
| `Pilot` (`Pilot_Figure`), `Gunner`, `Gunner_2`, `Gunner_3` | Crew: `Gunner` is crew member 1, `Gunner_2` crew 2, `Gunner_3` crew 3 (`CrewStation.crewIndex`). `Pilot` is hidden in cockpit view, and the figure of the station the camera is at by `setStationView`. |
| `Cockpit` | `CockpitInterior`, `Gauge_RPM`, `Gauge_Alt`, `Gauge_Speed`, `Gauge_Compass`, `Gauge_Fuel` (+ `_Bezel`). Gauge discs face the pilot with UV 0..1, canvas-top = gauge-top. |
| `EyePoint` | Pilot eye (cockpit camera): over the seat (cockpit centre − 0.2 m), 0.2 m above the coaming (kept under an overhead wing), so the gauges — just under the coaming — sit in the forward view. |
| `Contact_WheelL`, `Contact_WheelR`, `Contact_Skid` | Ground contact points (wheel bottoms, skid tip). The generator gives every type an ~11° tail-down ground angle. |
| `Muzzle_<i>` | Muzzle of `spec.guns[i]` (child of its station's `Gun_<station>` pivot for flexible guns). Visual positions can differ slightly from `GunMount.position`, which the sim uses for ballistics. |

Materials: `Livery_Fuselage`, `Livery_WingTop`, `Livery_WingBottom`, `Livery_Tail`, `Livery_Cowling`,
`Livery_Accent` (wheel covers, spinner) plus `Metal`, `Wood`, `Rubber`, `Pilot`, `Skin`, `Leather`,
`Glass`, `Gauge`, `Cloth`, `Bomb` and `BombRacks`. The runtime replaces all of them.

## UV atlas / canvas conventions

Canvas coordinates: u → right, v → **down** (v = 0 is the top row; textures use `flipY = false`).
Metadata keys (root `userData`) give the metres each atlas spans so insignia stay round.

* **Fuselage** (1024×512). u = 0 at the nose → 1 at the sternpost over `uv_fuselage_len` m.
  v is arc length over `uv_fuselage_perim` m: right side centred on v = 0.25, left side on 0.75
  (top seam at v ≈ 0 / 1, bottom at 0.5). The right side appears mirrored horizontally and the left
  side flipped vertically when viewed from outside — draw text with the matching flip.
* **WingTop / WingBottom** (1024×512). u = 0.5 + x / `uv_span_ref`. Two regions of chord
  `uv_chord_ref` m each: v ∈ [0, 0.5] is the *primary* surface (top of the top-most wing / bottom
  of the bottom-most wing — where national insignia go), v ∈ [0.5, 1] all other wing surfaces.
  v = region + 0.5 · (distance aft of the leading edge / chord_ref).
  `uv_top_wing_chord`, `uv_bottom_wing_chord`, `uv_bottom_wing_span` size the insignia.
* **Tail** (512×512). Top half: vertical tail, fin u ∈ [0, 0.4], rudder u ∈ [0.4, 1] (each normalised
  to its own chord, `uv_fin_chord`, `uv_rudder_chord`), v over `uv_vtail_height`. Bottom half:
  horizontal tail, u = 0.5 + x / `uv_tail_span`, v = 0.5 + 0.5 · (aft of stab LE / `uv_tail_chord`).
* **Cowling** (256×128). u around, v front → back.

## Runtime (`src/render/aircraft`)

```ts
import { createAircraftVisual, preloadAircraftModels, defaultLivery } from './render/aircraft';
await preloadAircraftModels(['sopwith_camel', 'fokker_dri']);
const v = await createAircraftVisual(spec, livery);   // AircraftVisualFactory + extras
scene.add(v.object);
v.update(entity, dt);            // transform, prop, surfaces, flashes, damage, gauges (10 Hz)
v.setCockpitView(true);          // hide pilot, live gauges, fainter prop disc
v.eyePoint;                      // body-frame eye for the cockpit camera
v.contactPoints;                 // {wheelL, wheelR, skid} body-frame, for ground alignment
v.aimFlexibleGun(worldPos|null); // optional: point the observer's gun
v.stationEyes;                   // Map<CrewStationId, Vector3>: body-frame eye per gun station
v.setStationAim('dorsal', dir);  // swing that station's guns along a body-frame unit vector
v.setStationView('dorsal');      // camera at that station: hide its gunner (null: none)
v.dispose();
```

* **Twins** spin both propellers from `state.engineRpm`; an engine whose
  `damage.engines[i]` reaches 1 windmills at `min(rpm, airspeed × 9)`.
* **Bombs** on the racks follow `AircraftEntity.bombs` (per store); without it, as outside a
  bombing sortie, none are drawn. Each store is one merged mesh (`setDrawRange`), so a load
  costs one draw call per store.
* `setStationAim` clamps the ventral guns to 0.15 … −1.5 rad of pitch and the others to
  1.45 … −0.6 rad. Guns that face aft at rest (rear rings, the tunnel) are stowed pointing aft.
* **Gun rings follow the sim:** every update the visual reads `getStationAim(ac, station)`
  (src/sim), the direction the AI gunner or the player at that station has laid the guns,
  and swings them there. An idle station returns to its rest pose. `aimFlexibleGun` and
  `setStationAim` only apply while the sim has no aim for that station.

* Liveries are painted once per (type, livery) and cached; insignia follow `Livery.insignia`
  (iron cross patée with white border, Balkenkreuz, RFC/French/US roundels with period rudder
  stripes — blue at the post for Britain/France, red for the US), squadron band, `marking` letters,
  `pattern` (`lozenge`, `streaked`, `stripes`, `disruptive`: the French five-colour
  camouflage of 1917–18 in irregular blotches), rib tapes, grain, exhaust/castor-oil staining.
* Damage: per-zone charring, bullet-hole decals parented to the hit part, and on
  `structuralFailure` the weakest wing (or the tail) detaches and tumbles away (it's re-parented to
  the visual's parent, so add the visual to the scene, not to a transient group).
* Muzzle flashes fire whenever a gun's `roundsLeft` drops — no dependency on control state.
* If a GLB fails to load, `buildFallbackModel(spec)` provides a boxy stand-in with the same names.

## Bomber specifications and sources

Figures for the bombers wave (D-XXX, "Bomber specifications"). The mass and performance are
**loaded, with the historical bomb load aboard**; `massLoaded` includes the bombs. Where the
sources disagree the table says which one it follows.

| Type | Loaded / empty kg | Wing m² | Power | Speed | Ceiling | Climb to 3000 m | Bombs (charge) |
|---|---|---|---|---|---|---|---|
| AEG G.IV | 3630 / 2400 | 67 | 2 × 260 hp Mercedes D.IVa | 165 km/h at 1000 m | 4500 m | 27 min | 8 × P.u.W. 50 kg (23 kg) |
| Gotha G.V | 3975 / 2740 | 89.5 | 2 × 260 hp Mercedes D.IVa | 140 km/h at sea level | 4650 m | 28 min | 6 × P.u.W. 50 kg (23 kg), 4 × P.u.W. 12.5 kg (1.5 kg) |
| Handley Page O/400 | 6060 / 3856 | 153.1 | 2 × 360 hp Rolls-Royce Eagle VIII | 157 km/h at sea level | 3960 m | 40 min | 16 × 112 lb R.L. HE (16 kg), internal |
| Voisin III | 1350 / 950 | 49.7 | 130 hp Salmson M.9 | 105 km/h at sea level | 3500 m | 45 min | 1 × Obus de 155 (7 kg), 4 × Obus de 90 (1 kg) |
| Breguet 14 B2 | 1769 / 1017 | 50.2 | 300 hp Renault 12Fcx | 175 km/h at 2000 m | 5550 m | 18 min | 32 × Michelin 115 mm 8 kg (2.5 kg, estimate) |
| Airco D.H.9 | 1719 / 1070 | 40.3 | 230 hp Siddeley Puma | 182 km/h at 3000 m | 4700 m | 18.5 min | 2 × 230 lb R.A.F. HE (50 kg) |
| Airco D.H.4 (charge fixed) | as before | | | | | | 4 × 112 lb R.L. HE (16 kg, was 20) |

Sources:
* Dimensions, masses and powers: the Wikipedia articles on each type (Gotha G.V, Handley Page
  Type O, AEG G.IV, Airco DH.9, Breguet 14, Voisin III), checked against the next sources.
* **Gotha G.V:** P. M. Grosz's figures via the "aergistal" IL-2 reference pages (with Gray &
  Thetford): 3000 m in 27 min 51 s with 350 kg of bombs, ceiling 4650 m with bombs. We use
  these loaded figures; Wikipedia's 6500 m ceiling doesn't state the load.
* **AEG G.IV:** an Allied test of a captured aircraft (Skytamer): 9,000 ft in 23.4 min.
* **O/400:** ceiling 13,000 ft from C. H. Barnes, *Handley Page Aircraft since 1907*; 10,000 ft
  in 40 min (aeropedia.com.au). Lists disagree on the ceiling; we follow Barnes.
* **Breguet 14 B2:** S.T.Aé. figures via the aergistal pages and *Windsock*: ceiling 5550 m with
  256 kg of bombs; 3000 m in 12 min without bombs. The 18 min loaded climb is our estimate.
* **Voisin III:** no loaded climb figure found. 3000 m is near its ceiling; the 45 min is an
  estimate. 52 min (our first guess) fails calibration: matching both it and the 3500 m
  ceiling needs a power lapse beyond the calibrator's 0.55 bound (D-XXX, "Bomber specifications").
* **Bombs:** Imperial War Museum descriptions of the P.u.W. bombs (the 50 kg is 46% explosive,
  1.70 × 0.18 m; the 12.5 kg 12%, 0.75 × 0.09 m); the Great War Aviation Society bomb table and
  the RFC/RAF "Details of Aerial Bombs" manual (the 112 lb R.L. carries 35 lb of amatol, the
  230 lb 110 lb); the Pages 14-18 forum for the French shell-bombs (Obus de 90 11.2 kg, Obus de
  155 40 kg with a 7.12 kg charge).

## Gotchas (Blender 5.2 headless, learned building this pipeline)

* **Long renders:** run `render_art.sh` / `build_models.py --preview` as a background job and wait
  for its completion notification — never `sleep`-poll. Finals (1920×1080, 160 samples) take
  ~5–15 min per scene on an M3 Max; iterate at `--res 960 --samples 48` (~1 min).
* **Mix node sockets:** `ShaderNodeMix` has float, vector and colour sockets that share names, so
  `inputs['A']` is the *float* A. For `data_type = 'RGBA'` use `inputs[0]` (factor), `inputs[6]`/`[7]`
  (A/B colour) and `outputs[2]` (result colour).
* **Physical sky** (`MULTIPLE_SCATTERING`): at background strength 1 the sun is ~4 stops too hot;
  use ≈0.07. It renders black below the horizon — `sky_world(ground_color=…)` fades to haze there.
  `sun_rotation` ≈ azimuth measured from +Y (camera-forward in these scenes), positive toward +X;
  `sun_direction` does not update in background mode, so render a quick equirectangular pano to
  check sun placement.
* **View transform:** AgX Punchy pushes saturated reds to orange at golden hour; outdoor scenes use
  `Khronos PBR Neutral`.
* **EEVEE engine id** is `BLENDER_EEVEE`. `World.use_nodes` is deprecated (still works).
* **Normals:** loft code must end with `bmesh.ops.recalc_face_normals` for closed parts; Blender
  previews hide inverted normals because they draw back faces.
* **Keyframes for prop motion blur:** set `preferences.edit.keyframe_new_interpolation_type =
  'LINEAR'` before `keyframe_insert` (5.x layered actions make editing fcurves awkward).
* **ImageMagick:** `montage`/`-annotate` need an explicit `-font` path on this Mac; contact sheets
  use `+append`/`-append` with `/System/Library/Fonts/Supplemental/Arial.ttf`.
