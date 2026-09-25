# World & renderer

## Pure world module (`src/world`, Node-safe)

| Export | Notes |
|---|---|
| `terrainHeightAt(x, z)` | Metres ASL (sea floor < 0). Authored 0.125° relief grid + named features (Vimy/Artois escarpment, Passchendaele–Messines ridge, Flemish hills) + carved river valleys + coast + smooth fBm (shortest wavelength ~500 m) + flattened aerodromes. ~1–2 µs/call. |
| `terrainNormalAt(x, z)` | Central-difference normal. |
| `frontLineAt(date)` / `signedDistanceToFront(x, z, date)` / `sideOfFrontAt(x, z, date)` | Historical lines 1915-07 → 1918-11-11 as six-section keyframes interpolated per section (quiet sectors don't drift). Negative distance = allied (west). Cached per date; bucketed segment index, ~µs per query. |
| `craterIntensityAt(x, z, date)` | 0..1. Every line held up to the date (incl. ground swept by offensives, sampled every 10 days) is rasterised into a 250 m grid on first use per date (~0.5 s), then bilinear lookups. |
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

## Performance (M3 Max, 1280×720, high, headless Chrome, steady state)

~2–3 ms/frame uncapped for typical views (arras 800 m, Somme battlefield 150 m, aerodrome 250 m), 250–450 draw calls, 0.8–1.5 M triangles. Streaming (tree cells, town tiles) is time-sliced; first seconds after a teleport show brief hitches while a city tile builds (~10 ms).

## Known gaps
* Front-line trench network is drawn in the shader around the *current* line only; abandoned trench systems appear as craters.
* Rivers narrower than the mask texel are drawn as partial-coverage water beyond ribbon range (~2.6 km), so they read slightly wide but no longer bead.
* No snow cover or wet-weather ground darkening.
