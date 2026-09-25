# World & renderer

## Pure world module (`src/world`, Node-safe)

| Export | Notes |
|---|---|
| `terrainHeightAt(x, z)` | Metres ASL (sea floor < 0). Authored 0.125° relief grid + named features (Vimy/Artois escarpment, Passchendaele–Messines ridge, Flemish hills) + carved river valleys + coast + smooth fBm (shortest wavelength ~500 m) + flattened aerodromes. ~1–2 µs/call. |
| `terrainNormalAt(x, z)` | Central-difference normal. |
| `frontLineAt(date)` / `signedDistanceToFront(x, z, date)` / `sideOfFrontAt(x, z, date)` | Historical lines 1915-07 → 1918-11-11 as six-section keyframes interpolated per section (quiet sectors don't drift). Negative distance = allied (west). Cached per date; bucketed segment index, ~µs per query. |
| `craterIntensityAt(x, z, date)` | 0..1. Every line held up to the date (incl. ground swept by offensives, sampled every 10 days) is rasterised into a 250 m grid on first use per date (~0.5 s), then bilinear lookups. |
| `craterGridsForDate` / `installCraterGrids` / `hasCraterGrids` | Hand a date's grids between threads. The renderer builds them in `terrain/craterWorker.ts` at load (`CraterGridLoader`, awaited by `whenReady`), so main-thread queries (effects' `landUseAt` on bullet impacts) never build synchronously. |
| `landUseAt(x, z, date)` | `'field' \| 'pasture' \| 'forest' \| 'town' \| 'water' \| 'trench-zone' \| 'shell-cratered' \| 'beach' \| 'sea'`. |
| `forestDensityAt`, `townDensityAt`, `aerodromeClearance`, `nearestTown`, `TOWNS_WORLD` | Land-use helpers (towns bucketed). |
| `riverQuery`, `riverPolylines`, `coastDistance`, `roadNetwork` | Water/coast/roads for placement and rendering. |

## Renderer (`src/render`)

```ts
const world = createWorldRenderer(canvas, { quality: settings.graphics, date: mission.date });
const camera = new PerspectiveCamera(fov, aspect, world.near, world.far); // reversed-Z (log-depth fallback)
world.setEnvironment(mission.date, mission.timeOfDay, mission.weather);
bus.onAny((e) => world.handleEvent(e));
// per frame (after sim):
world.update(dt, camera, worldQuery, combat.bullets);
world.render(camera);
```

* Add aircraft visuals etc. to `world.scene`. Sun shadows follow the camera (±220 m), so only nearby casters matter; set `castShadow` on aircraft.
* Loading screen: keep calling `update()` with the start camera and `await world.whenReady()` (resolves when no terrain chunks are pending).
* Balloons: `scene.add(world.createBalloonVisual(b))`; `update()` syncs position, tether length and burning state for every visual it created (keyed by balloon id).
* Ground targets: `o = world.createGroundTargetVisual(type, side)`; set `o.position` and `o.rotation.y = -heading` (models face −Z). On death call `setGroundTargetDestroyed(o)` from `src/render/objects/groundTargets`.
* Flak colour follows the ground under the burst: black over central ground (German archie), white-grey over allied.
* `world.sunDirection`, `world.stats()` (fps, draw calls, triangles, terrain chunks, per-subsystem CPU ms), `world.effects` (direct calls: `explosion`, `flak`, `sparks`...).
* Quality presets: `src/render/quality.ts` (terrain LOD, mask resolution, shadows, tree radius/density, cloud puff budget, building distance, far plane, particle cap).

### Components
Sky (`sky.ts`, Preetham with a CPU port for matching haze), terrain (`terrain/`: quadtree LOD built in a worker pool, land-use shader, feature mask for water/roads), sea, river & road ribbons (near camera), towns/farms/ruins (`towns.ts`, instanced per 8 km tile), trees (`trees.ts`, streamed 500 m cells), aerodromes, clouds (billboard cumulus + overcast deck, in-cloud whiteout), effects (`effects/`: particles, tracers, event handling).

## QA harness

`pnpm dev`, open `/dev/world.html?town=Arras&alt=800&date=1917-06-01&tod=dawn&cover=0.4` (params: `q, date, tod, cover, base, vis, town|x&z, back, alt, yaw, pitch, demo=1, ds, fx=flak|boom, hide=layer,...`). `node src/render/dev/shootWorld.mjs <outDir> [port] [shot...]` screenshots a fixed set of viewpoints; `probe.mjs` evaluates expressions in the page.

`node src/render/dev/frontShots.mjs <outDir> [port] [croisilles|somme|ypres ...]` launches a real flight and parks a spectator camera over the trench line at 300 m, 1,000 m and 2,500 m (oblique) and 2,000 m (straight down), for judging the front at the distances players see it. `UNCAPPED=1 NOSHOT=1` prints a frame-interval p50 per view instead (use it for shader A/B timing).

### Front line and woods from altitude
The target is a period reconnaissance photograph, not a map (DECISIONS "Trenches drawn as energy-conserving lines").
* Trench cuts, spoil banks and wire belts use box-filtered coverage (`bandCov`/`ringCov` in `terrainMaterial.ts`): a feature narrower than a pixel gets fainter, never wider. From 2 km the network is thin pale chalk lines with a faint dark core, not a black ribbon.
* Fire and support trenches are crenellated (bays and traverses, `crenelDist`) with irregular bay lengths; the reserve line zig-zags. The pattern fades to a straight line once a bay is a few pixels long, and the cut widens by the path-length ratio so its tone is conserved.
* Communication trenches wander (sine wiggle on a signed lane distance) and about a third of lanes have none.
* No-man's-land is a ragged-edged, mottled brown-grey tint over the crater shading, so the pocking stays visible.
* Woods: canopy tone varies at stand (~200 m), clump (~15 m) and crown (~5 m) scales, each fading to its mean when sub-pixel, over lighter seasonal palettes. Thresholded patches (chalk splashes, Flanders wet ground) use `tblob`, rotated noise octaves, so they are ragged rather than lattice-aligned squares.

## Performance (M3 Max, 1280×720, high, headless Chrome, steady state)

~2–3 ms/frame uncapped for typical views (arras 800 m, Somme battlefield 150 m, aerodrome 250 m), 250–450 draw calls, 0.8–1.5 M triangles. Streaming (tree cells, town tiles) is time-sliced; first seconds after a teleport show brief hitches while a city tile builds (~10 ms).

**In-game, 16-aircraft furball** (`playShots.mjs big16`, `UNCAPPED=1`, frame interval ms over 75 s of combat):

| Preset | p50 | p95 | max* |
|---|---|---|---|
| low | 1.6–2.5 | 2.3–3.7 | ~20 |
| high | 3.0–4.0 | 4.3–5.2 | ~23 |
| ultra | 3.4–4.6 | 4.4–6.4 | ~40 |

*Uncapped maxima are GPU-queue pacing stalls (renderer CPU was 2 ms on those frames, with no new shader programs). With vsync (how players run), all three presets hold 16.7 ms with zero frames over 25 ms.

The wave-6 front-line shader measured +0.16 ms p50 on 'high' in big16 (A/B, 3.64 against 3.48 ms mean of five samples) and +0.0–0.3 ms in the `frontShots` views.

The QA rig logs per-subsystem CPU (`WorldRendererImpl.lastCpu`) and the program count on every frame over 25 ms, which separates CPU, shader-compile and GPU stalls.

## Known gaps
* Front-line trench network is drawn in the shader around the *current* line only; abandoned trench systems appear as craters.
* Rivers narrower than the mask texel are drawn as partial-coverage water beyond ribbon range (~2.6 km), so they read slightly wide but no longer bead.
* No snow cover or wet-weather ground darkening.
