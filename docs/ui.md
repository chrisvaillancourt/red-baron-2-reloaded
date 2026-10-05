# UI (`src/ui`)

Plain DOM + CSS, no framework. System font stacks only (Iowan Old Style /
Palatino / Georgia for display, American Typewriter / Courier for typed text).
All art is SVG/canvas generated in code; Blender art in `public/art/` is used
when present (`title.jpg`, `menu-aerodrome.jpg`, `briefing-desk.jpg`,
`debrief-sky.jpg`) with CSS fallbacks when missing.

## Integrator API

```ts
import { createUi, createHud, setUiCatalog, catalogFromCampaignData } from './ui';

// Menus: mounts into root, drives everything through GameServices.
const ui = createUi(document.getElementById('app')!, services, { flightHost?: HTMLElement });

// Display names from the campaign data (ranks/medals/aces by campaign id).
// src/game/app.ts does this at boot; the dev harness keeps the UI defaults.
setUiCatalog(catalogFromCampaignData());

// In flight (inside FlightLauncher.fly's container):
const hud = createHud(container, settings);
hud.update(view);        // every frame, HudView from src/ui/hud/types.ts
if (hud.menuOpen) { /* suspend flight input; HUD owns the keyboard */ }
```

Flying: briefing's "Take off" calls `services.launcher.fly(mission, settings, host)`.
The UI hides its layer, appends a full-screen `.rb-flight-host` div to `flightHost`
(default `document.body`), and restores itself when the promise resolves. Career
results go through `campaign.applyMissionResult` and into the debrief.
The hospital "Return to duty" button calls `campaign.returnToDuty(p)` (the
debrief has already advanced the date past the stay).

Defense: `ctx.defend(options)` calls optional `services.defense.defend` in its own
full-screen `.rb-defense-host`. The same flight/defense session guard suppresses
competing launches. Navigation/music/focus restore after completion; disposal
aborts loading or active defense and does not reactivate a dead menu. Battery
results route directly to `defense-report`, never to campaign debrief/save logic.

`catalogFromCampaignData()` (`src/ui/campaignCatalog.ts`) takes names,
precedence and ids from `src/data/{ranks,medals,aces}.ts` and maps campaign
medal ids onto the UI's hand-drawn medal visuals (`ek2` → Iron Cross, `plm` →
Pour le Mérite, …); unmapped medals get ribbons from the campaign data.

`HudView.mouseAim` (optional `{ aim, nose }`) draws the mouse-aim circle and
nose cross. Key action `wingmenMenu` (default O) toggles the orders card.

## Screen map

```
title ─┬─ roster ─┬─ create-pilot ─→ hq
       │          └─ hq ─┬─ briefing ─→ [flight] ─→ debrief ─→ hq
       │                 └─ options
       ├─ quick ─→ briefing ─→ [flight] ─→ debrief ─→ quick
       ├─ defense-briefing ─→ [battery] ─→ defense-report
       │        ├─ gunner-guide             ├─ replay same attack → [battery]
       │        └─ options                  ├─ new defense → defense-briefing
       │                                    └─ main menu → title
       ├─ aces (Hall of Fame)
       ├─ options (Realism / Graphics / Sound / Controls / Keys)
       ├─ controls (Flying Manual)
       └─ credits
```

### Airfield Defense

`defense-briefing` holds transient `{ seed, difficulty, aimAssist }`; visits to
Gunner’s Guide/Options retain the draft. Realism's unlimited flight ammunition
does not disable battery mechanics. Shared settings supply graphics/audio,
mouse sensitivity/inversion, and fire/pause bindings; gun/aim/reload/fuze keys
are battery-specific. This mode supports mouse, keyboard or a standard-mapped
controller, not touch flight intent. Custom seed entry and Options sliders still
need keyboard/mouse; see Navigation for the controller-only coverage boundary.

The historical field/date host an authored arcade exercise, not a reenactment
claim. Briefing and guide explain five raids, the three guns, bomb interception,
asset benefits and untimed purchases. `defense-report` distinguishes Won, Lost
and Aborted and shows raids, asset health, aerial kills, interceptions, score,
combat time and attack options. Replay uses the exact options immediately;
New defense guarantees a different seed and reopens choices. Neither flow writes
settings, career results or flight reports.

Browser selectors use `[data-action=defense-launch/defense-replay/defense-new/
defense-main-menu]`, `#defense-seed`, and
`.defense-report-paper[data-outcome]`. As with debrief transitions, target
`[data-screen=defense-report]:not(.leaving)` while old screens fade out.


### Debrief

Params: `{ mission, result, report?, pilotId?, quick?, quickOptions? }`. The
briefing passes `quickOptions` through from the Quick Mission screen, for the
flight report.

Debrief pages, in order, as the report warrants:
1. telegram (career only: wounded, captured or killed)
2. combat report: claims stamped CONFIRMED/UNCONFIRMED, and the playtest strip
3. newspaper
4. promotion
5. one page per medal
6. memorial / prisoner-of-war record when the career ends

A quick mission has only the combat report. A sortie that carried bombs adds "Bombs dropped"
and "Bomb hits" to its stats (`MissionResult.bombsDropped` / `bombHits`). Each page has one `data-autofocus`
button (Continue, or Done / Return to the squadron on the last page), so
Enter steps through them. Esc skips to the next page, too. A script waiting for
a later page should press Enter and wait for its selector (`.telegram`,
`.report`, `.newspaper`, `.ceremony`, `.memorial`), not count pages:
the set varies with the outcome. `tests/e2e/ui-flow.spec.ts` `leaveDebrief`
presses Enter until the screen changes.

The playtest strip, under the combat report, has an optional "Too easy / Fair /
Too hard" rating, a short note, and **Copy flight report**. The button builds
the versioned JSON report (`src/core/flightReport.ts`; docs/PLAYTEST.md "Human
playtests") and writes it to the clipboard. If the clipboard refuses (browser
permissions, or an origin that isn't secure), the report opens in a modal
textarea, selected for copying by hand. A toast says which happened.

Under `pnpm dev` the strip also saves the report through the dev server's sink (D-084):
it POSTs to `/__rb2r/flight-report` (`src/core/reportSink.ts`, and the plugin in
`vite.config.ts`) when the page opens, on a rating, on blur of the note field, and 0.7 s
after typing stops. Every save uses one timestamp, so they all overwrite one file, and the
strip shows "Saved to <path>". The sink is off in production builds and under browser
automation (`navigator.webdriver`), unless the URL has `?reportSink=1`.
`tests/e2e/flight-report.spec.ts` covers the clipboard, the fallback box and the sink.

## Navigation

Arrow keys / D-pad / left stick move focus spatially; Enter/A activates;
Esc/Backspace/B goes back; `[` `]` / PageUp/PageDown / LB/RB switch tabs. The
router keeps a stack; `back()` re-creates the previous screen.
Button groups (`segmented`, the Quick Mission ace list) are one Tab stop each:
only the chosen button is in the Tab order (`roveTabStop` in `components.ts`),
and left/right step through a group in order even where it wraps onto two rows.
Quick Mission takes 12 Tabs from the aircraft list to "To the briefing"
(`tests/e2e/quick-keyboard.spec.ts`).

Controller activation is edge-only; direction/tab holds still repeat. A new scope,
activation generation or controller owner must observe neutral input before its
buttons can act. `focusFirst(preferred)` accepts a restoration target only inside
the current scope, never a caller-selected scope. Foreground error cards own focus
above the obscured menu. Navigation uses the existing `.nav-focus` ring after
programmatic focus, including mouse-to-controller handoffs, and clears it on focus
loss, mouse input, deactivation and disposal.
Disconnect and connect events forget that pad's activation state and invalidate
the current poll generation even if the same index/id returns between RAF samples.

Airfield Defense supplies contextual standard-pad ownership and enablement without
changing legacy parent-menu mappings. Its keyboard Escape remains pause-only while
controller B closes pause; B cannot skip resupply. The battery's guide, difficulty,
lead choice, pause, purchases, next raid and report/replay work with the pad.
Numeric custom seeds and Options sliders still require keyboard/mouse; this is not
a claim of controller-only operation across every application screen.

### Quick Mission crew options

- **Your seat**: for a multi-crew type (the Bristol F.2b, the D.H.4), a button per crew station
  (`crewStations(spec)`), saved as `playerStation`; hidden, and no Tab stop, for a
  single-seater. `buildQuickMission` puts the player at that station.
- **Bombing raid** is in the mission list, with an "Escort fighters" count (0–4). It builds
  through `buildQuickMission` (`type: 'bombing'`, docs/campaign.md). The aircraft list follows
  the mission type (`quickPlayerAircraft`, `src/ui/quickCrew.ts`): every type requires
  player availability, and raids additionally require a bomb load. All 33 shipped aircraft
  are player-accessible; the seven bomb carriers are offered for raids. Switching mission
  type keeps the chosen aircraft and valid seat when still offered. Otherwise a raid picks
  a suitable bomb carrier, or another mission falls back to the default fighter.
  `sanitizeQuickOptions` applies the same rule to saved options and clears missing seats.

The Options key list and the Flying Manual pick up the Crew key group from
`src/ui/bindings.ts`; the Manual also has an "At a gun or the bombsight" table (which
mirrors `InputManager.stationMode`) and gunner and bomb-aimer notes.

## Touch flight controls

`src/ui/touchControls.ts` owns pointer capture and a scrollable action sheet;
`src/game/touchInput.ts` is the intent-only seam. `InputManager` converts normalized
stick/rudder/look rates using existing settings and emits the same input frame and
edge commands as desktop controls. Neutral touch stick still owns the aircraft;
the mouse instructor must not take over at its centre.

Touch-capable browsers enable the overlay automatically; its toggle also allows
manual selection. Stick down pulls back at the pilot seat, while up raises the gun
at a crew station. Fire/Blip/rudder/look support independent simultaneous pointers.
Throttle uses the authoritative game value. Menu exposes views, targeting, map,
time, crew, bombs, jam clearing, wingman orders, HUD visibility and end flight.
The Menu stays available when touch gestures or the decorative HUD are hidden.

`TouchControlView.active` means the flight host exists, not the selected input
preference. The UI owns that preference and calls `sink.active`. The action sheet
owns a separate simulation/input capture; close it before enqueueing its command.
External modals block the overlay, but a silent simulation freeze is not an input
capture. Crew changes discard stale held/queued actions without erasing AI-to-player
throttle/direct-stick handback. Pointer cancellation, rotation, blur, backgrounding
and context loss release transient intent; touch-device focus loss pauses for an
explicit resume. Resume gestures unlock audio synchronously.

Menus/cards scroll on narrow or short screens, interactive targets are at least
44px in coarse-pointer layouts, and `viewport-fit=cover` pairs with safe-area padding.
Projected world markers retain full-canvas coordinates. Chromium touch emulation
exercises these paths; physical iPhone Safari audio, saves, lifecycle and sustained
frame time still require the device acceptance in BACKLOG Q-12.

## HudView contract

See `src/ui/hud/types.ts` (fully documented). Units are SI; screen points are
normalised 0..1 with `onScreen` + `edgeAngle` (radians, 0 = up, clockwise) for
off-screen edge arrows. Key fields: airspeed/altitude/heading/rpm/throttle/fuel,
`guns[]` (rounds, capacity, spares, jammed, jamClearProgress, reloading 0..1),
`damage` (per zone 0..1 + fire/leak/engine/wounded flags), `target` (name, type,
range, closure, screen point, optional lead point), `padlock`, `threats[]`,
`wingmen[]`, `waypoint`, `gunReticle`, `timeCompression`, `missionTime`, `hint`,
`sunGlare` (sun screen point, 15° glare radius in screen heights, strength 0..1).
`showInstruments` shows the period gauge cluster (for external views).

Crew stations (docs/bombers.md, docs/game.md "Crew stations"): `view` adds `'gunner'` and
`'bombsight'`. `seat` (label, index/count, `aiFlying`) is the seat plate, bottom centre above
the readout, amber while the AI pilot flies. At a gunner's station `guns[]` holds only that
station's guns, undimmed. `gunnerSight` (ring point, `limited`, `arcEdges` screen polylines)
draws a ring-and-bead sight and the field of fire's edge, dashed amber, red at the limit.
`bombsight` (impact point, drift, projected `wire`, `cue` run-in/release/past/none,
`timeToRelease`, `crossM`, target point, release key) draws the drift wire with ticks, the
impact mark (green on release), the target diamond (pinned to the edge while far up the
track) and the cue line ("RUN-IN · 12 s · STEER LEFT 60 m", "RELEASE — R"). `bombs`
(left/total, next store) is the count under the guns. All in `src/ui/hud/crewOverlay.ts`.

HUD methods: `showMessage`, `showWingmanMenu`, `showPauseMenu` /
`showEndFlightPrompt` (cards capture the keyboard while open), `showMap(MapView|null)`,
`setGEffect(-1..1)`, `setDamageFlash(0..1)`, `setVisible`, `setSettings`, `dispose`.

## Map

`src/ui/map/mapRenderer.ts`: `drawMap(canvas, MapView)`, `missionMapView(mission,
units)`, `createMapCanvas(view)`. Draws paper, 10 km squared grid, coast, woods,
rivers, towns, front line (`frontLineAt(date)`) as a hatched band with trench
traces, active aerodromes, route, markers, compass and scale bar.

## Development

* Harness: `pnpm dev`, open `/dev/ui.html?screen=<id>` (see `src/ui/dev/main.ts`;
  `screen=hud` runs a fake flight: N end, K unsafe end, Esc pause, M map, O orders).
* Screenshots: `node dev/screenshot-ui.mjs http://localhost:5173 docs/screenshots`.
* Flow test: `node dev/flow-ui.mjs http://localhost:5173` drives a full career
  loop, quick mission and options with the mock services.
* Real-data walk: `node dev/walk-menus.mjs http://localhost:5173 <outDir> [w] [h] [only]`
  screenshots every screen of the **real** app: careers for all four nations with forced
  debrief outcomes (claims, promotion, medals, newspaper, wounded/captured/killed), the
  Flying School card and a short flight. It prints the music cue per screen and any
  console errors. It uses the dev-only `window.__rb2ui` router hook (`createUi` sets it
  under `import.meta.env.DEV`). `only` filters sections: `title`, `static`, `create`,
  `career-de|gb|fr|us`, `fate`, `school`, `music`, `roster2`.
* UI sound levels: `node dev/measure-ui-audio.mjs http://localhost:5173` renders each UI
  sound and music cue offline and prints peak/RMS dBFS (`UI_GAIN` in
  `src/audio/audioEngine.ts` is tuned from it).

## First-run and period details

* **Flying School** (`src/ui/flyingSchool.ts`): the first take-off on a browser, while
  `showTutorialHints` is on, shows a one-page primer built from the live key bindings.
  The seen flag is `localStorage['rb2r.flyingSchool.seen.v1']`. The Flying Manual has a
  button that reopens it. e2e flows acknowledge it after "Take off".
* `ctx.confirm()` takes rich `body` elements, `infoOnly` (no cancel button; Esc still
  closes) and `className` (e.g. `wide`).
* `serviceName(nation, date, squadronId)` (`catalog.ts`) gives the period name of the
  service. RFC and RNAS both become the Royal Air Force from 1918-04-01. The German
  service is "Die Fliegertruppe" before 1916-10-08.
* The Flying Manual's mouse and gamepad tables mirror `src/game/input.ts`; keep the two
  in step.
