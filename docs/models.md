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
* `tools/blender/build_models.py` — builds and exports every type to `public/models/<id>.glb`
  (~230–275 KB, 5–7.3k triangles each; 5.5 MB total) and optionally renders EEVEE previews.
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
| `Gun_Flexible` | Two-seaters: observer's gun on the Scarff ring, pivot at the ring. |
| `Pilot` (`Pilot_Figure`), `Gunner` | Crew. `Pilot` is hidden in cockpit view. |
| `Cockpit` | `CockpitInterior`, `Gauge_RPM`, `Gauge_Alt`, `Gauge_Speed`, `Gauge_Compass`, `Gauge_Fuel` (+ `_Bezel`). Gauge discs face the pilot with UV 0..1, canvas-top = gauge-top. |
| `EyePoint` | Pilot eye (cockpit camera): over the seat (cockpit centre − 0.2 m), 0.2 m above the coaming (kept under an overhead wing), so the gauges — just under the coaming — sit in the forward view. |
| `Contact_WheelL`, `Contact_WheelR`, `Contact_Skid` | Ground contact points (wheel bottoms, skid tip). The generator gives every type an ~11° tail-down ground angle. |
| `Muzzle_<i>` | Muzzle of `spec.guns[i]` (child of `Gun_Flexible` for flexible guns). Visual positions can differ slightly from `GunMount.position`, which the sim uses for ballistics. |

Materials: `Livery_Fuselage`, `Livery_WingTop`, `Livery_WingBottom`, `Livery_Tail`, `Livery_Cowling`,
`Livery_Accent` (wheel covers, spinner) plus `Metal`, `Wood`, `Rubber`, `Pilot`, `Skin`, `Leather`,
`Glass`, `Gauge`, `Cloth`. The runtime replaces all of them.

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
v.dispose();
```

* Liveries are painted once per (type, livery) and cached; insignia follow `Livery.insignia`
  (iron cross patée with white border, Balkenkreuz, RFC/French/US roundels with period rudder
  stripes — blue at the post for Britain/France, red for the US), squadron band, `marking` letters,
  `pattern` (`lozenge`, `streaked`, `stripes`), rib tapes, grain, exhaust/castor-oil staining.
* Damage: per-zone charring, bullet-hole decals parented to the hit part, and on
  `structuralFailure` the weakest wing (or the tail) detaches and tumbles away (it's re-parented to
  the visual's parent, so add the visual to the scene, not to a transient group).
* Muzzle flashes fire whenever a gun's `roundsLeft` drops — no dependency on control state.
* If a GLB fails to load, `buildFallbackModel(spec)` provides a boxy stand-in with the same names.

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
