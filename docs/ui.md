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

Debrief pages, in order, as the report warrants: telegram (wounded/captured/killed)
→ combat report (claims stamped CONFIRMED/UNCONFIRMED) → newspaper → promotion →
one page per medal → memorial / prisoner-of-war record when the career ends.

## Navigation

Arrow keys / D-pad / left stick move focus spatially; Enter/A activates;
Esc/Backspace/B goes back; `[` `]` / PageUp/PageDown / LB/RB switch tabs. The
router keeps a stack; `back()` re-creates the previous screen.

## HudView contract

See `src/ui/hud/types.ts` (fully documented). Units are SI; screen points are
normalised 0..1 with `onScreen` + `edgeAngle` (radians, 0 = up, clockwise) for
off-screen edge arrows. Key fields: airspeed/altitude/heading/rpm/throttle/fuel,
`guns[]` (rounds, capacity, spares, jammed, jamClearProgress, reloading 0..1),
`damage` (per zone 0..1 + fire/leak/engine/wounded flags), `target` (name, type,
range, closure, screen point, optional lead point), `padlock`, `threats[]`,
`wingmen[]`, `waypoint`, `gunReticle`, `timeCompression`, `missionTime`, `hint`.
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
