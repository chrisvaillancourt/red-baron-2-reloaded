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
       ├─ aces (Hall of Fame)
       ├─ options (Realism / Graphics / Sound / Controls / Keys)
       ├─ controls (Flying Manual)
       └─ credits
```

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

A quick mission has only the combat report. Each page has one `data-autofocus`
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
`tests/e2e/flight-report.spec.ts` covers both paths.

## Navigation

Arrow keys / D-pad / left stick move focus spatially; Enter/A activates;
Esc/Backspace/B goes back; `[` `]` / PageUp/PageDown / LB/RB switch tabs. The
router keeps a stack; `back()` re-creates the previous screen.
Button groups (`segmented`, the Quick Mission ace list) are one Tab stop each:
only the chosen button is in the Tab order (`roveTabStop` in `components.ts`),
and left/right step through a group in order even where it wraps onto two rows.
Quick Mission takes 12 Tabs from the aircraft list to "To the briefing"
(`tests/e2e/quick-keyboard.spec.ts`).

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
