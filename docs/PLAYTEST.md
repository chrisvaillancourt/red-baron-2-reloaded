# Playtest reports

## Wave 7 release check

The real app was played in headless Chrome, through the real menus and controls:
- **Resolutions:** 1280×720 and 1920×1080, on the Metal GPU.
- **Low preset on SwiftShader:** once, on the 'low' preset, as a stand-in for a machine
  without a GPU.
- **Production build:** once, served by `pnpm preview`.

Sessions played:
- **Menus:**
  - Every menu screen at both sizes (`dev/walk-menus.mjs`).
  - Keyboard-only title navigation.
  - Esc back-out from all six title-menu screens.
  - Every Options tab. A graphics change and a key rebind survive a reload; this is now
    an e2e test, `tests/e2e/options.spec.ts`.
- **Quick missions:**
  - Intercept, flying the E.III against N.11s and against F.E.2bs.
  - Escort, flying the Nieuport 11 with Farman F.40s.
  - The default dogfight, on both the dev server and the production build.
  - A hard mouse-aim turn.
  - A cockpit look-down at the trenches from 2,200, 1,000 and 400 m.
- **Careers (2–4 sorties each):**
  - Jasta 5 in August 1916, flying the D.II: an escort of Albatros C.IIIs, then a
    balloon attack.
  - Lafayette in February 1918, flying the SPAD VII: four sorties toward the squadron's
    disbanding.
  - 24 Sqn in May 1916, flying the D.H.2: an escort of B.E.2cs, then taken prisoner.
  - N.65 in June 1916, flying the N.11: an escort of Farmans, then killed.
- **Fate screens:** wounded, hospital and return to duty; captured and the POW record;
  killed and the memorial (menu walk).
- **Not reached in play:** the award screens (promotion, medal, newspaper). They have been
  covered by `tests/e2e/career-awards.spec.ts` since wave 6.

Checks on the wave-6 changes, from the player's seat:
- **Mouse-aim cockpit:** in a hard right climbing turn the view stays forward, and the
  nose, struts and horizon stay in frame. Fixed, as #4 below.
- **Trenches from altitude:** from 1–2 km they read as thin pale lines, with no black
  ribbon. One exception is noted at #9.
- **Early two-seaters:**
  - 1916 briefings name B.E.2cs, F.E.2bs, Farman F.40s and Albatros C.IIIs.
  - In flight, the F.E.2b and Farman F.40 pushers render correctly close up: nacelle,
    booms and rear propeller. There are no see-through surfaces.
  - They cruise at 90–106 km/h.
- **Time compression:** it cut out by itself on the Jasta 5 balloon run ("Under fire:
  time compression off.") and when enemies closed within about 4 km.
- **Wingman names:** unique surnames, shown in the HUD roster. No clash came up in these
  sessions; the unit tests cover clashes.

Console: no errors on any screen or in any flight, dev or production. The only warnings
were the GPU's `ReadPixels` stall messages, caused by the screenshot tool.
- **Frame rate:** 60 fps on the Metal GPU, 9 fps on SwiftShader 'low'.

### Ranked findings

| # | Severity | Issue | Repro | Status |
|---|---|---|---|---|
| 1 | minor | **Quick intercept: 2.5–4 minutes to contact.** The intruders started about 12 km away. A player who flies to the "Intercept" waypoint and orbits waits about two minutes before anything appears. | Quick Mission → Intercept → any aircraft | **Fixed** (`src/campaign/quickMission.ts`, with a test): both flights run about 4.5 km to the intercept point, so contact comes in about 90 s. |
| 2 | minor | **Dead squadron mates fly again.** "1st Lt. J. Collins — killed in action" appeared on the Lafayette's 8 February sortie and again on 15 February. Rosters regenerate each quarter and didn't remember losses. | Career: lose a wingman, fly on in the same quarter | **Fixed:** `CareerPilot.lostMates` (additive, in `src/core/campaignTypes.ts`), with a test. Mates killed or captured are left out of later rosters, matched by name without the rank. |
| 3 | minor | **"Mission Failed" beside a ticked objective.** Abandoning after the charges were safe (24 Sqn escort, then captured) stamped FAILED with a green tick, which reads as a bug. | Career or quick → Esc → Abandon after an objective is met | **Fixed:** the stamp reads "Mission Abandoned" (`src/ui/screens/debrief.ts`). There's an e2e assertion in `ui-flow.spec.ts`. |
| 4 | minor | **An escort is judged a success when the player dies early.** The N.65 pilot collided at 4:47, before the Farmans reached their objective, and the report said MISSION SUCCESSFUL. The check seems to count charges still alive when the flight ends. | Career escort; die early | Routed (game, `src/game/missionDirector.ts` protect-flight evaluation). It doesn't affect career progress: the career has ended. |
| 5 | minor | **Quick matchups from different years are dated silently by your aircraft.** A Nieuport 11 against Albatros D.Vs is dated July 1916, a year before the D.V existed. There's no hint on the Quick Mission screen. | Quick Mission → Nieuport 11 vs Albatros D.V | Open (polish for `src/ui/screens/quick.ts`): show "These machines never met; dated by yours." Deferred. |
| 6 | polish | **Keyboard-only Quick Mission needs about 57 Tab presses to reach "To the briefing".** | Quick Mission with the keyboard only | Defer. Enter works on the focused control, and mouse players are unaffected. |
| 7 | polish | **SwiftShader 'low' runs at about 9 fps.** It is playable only as a slideshow. | `E2E_SWIFTSHADER` / no GPU | Defer. The README already asks for a real GPU. |
| 8 | polish | **The CO's remarks drop cap splits "Lt."** into a big "L" and "t. Smith". | Debrief when a wingman is lost | Defer (typographic nicety). |
| 9 | polish | **One dark serrated ribbon still reads near-black from 2 km.** It is at the edge of the front, probably a tree-lined road or wood strip, and is visible in the 2,200 m look-down. | Quick dogfight, look down at 2 km | Routed (render). |
| 10 | polish | **Ace standings say "Flying" for an ace in hospital.** For example, Lothar von Richthofen on 1 June 1917. The status ignores service gaps. | HQ → Ace Standings, June 1917 | Defer. It needs an additive `AceStanding` status. |
| 11 | polish | **American mates in the Lafayette carry USAS ranks** ("1st Lt.", "Sgt."). The escadrille used French ranks until February 1918. | Lafayette career | Defer. |

### Verdict

**GO.** A fan can play this for an evening without hitting a blocker.
- **Coverage:** every mission type flown briefed, flew, ended and debriefed correctly.
- **Careers:** they advanced across sorties and ended on the right fate screens.
- **Robustness:** the production build ran clean at 60 fps, settings persisted, and no
  screen threw an error.
- **Remaining issues:** everything above is minor or polish. Findings 1–3 are fixed in
  this pass.

---

# Playtest report — wave 5 (fresh eyes)

A new player who loved *Red Baron II* in 1997 played the real app, not mocks, in
headless Chrome (Metal GPU) at 1280×720. Input went through the real paths:
clicks and keys, and mouse-aim flying through synthetic `mousemove` deltas on
the flight canvas, which is what the input layer reads. `window.__rb2` was used
only to read state and to steer the scripted pilot toward targets.

Sessions played:
- **Cold start:** title → Quick Mission → briefing → Flying School →
  Camel against 3 D.Vs. Every view was tried (F1–F5, padlock, T), plus the
  map, orders, pause, end flight and the debrief.
- **Careers:**
  - British, 56 Sqn, June 1917, S.E.5a: intercept, then a free hunt.
  - German, Jasta 11, April 1918, Dr.I: patrol, then an intercept.
  - French, N.3, July 1916, Nieuport 11: escort, then a patrol.
  - American, 94th Aero, June 1918, Nieuport 28: a free hunt.
  - British recruit, 70 Sqn, September 1917, Camel: three sorties.
- **Screens checked after each career:** the HQ tabs (orders, logbook,
  victories, decorations, ace standings, squadron), the telegram,
  prisoner-of-war and memorial screens, and the CO's remarks.
- **Briefings:** 16 enlistments across all four nations and 1916–1918, to
  review mission text and maps.

Screenshots are `docs/screenshots/playtest-*.png`.

## Top 15 issues

Severity: blocker, major, minor, polish. "Routed" means the fix lies outside
this pass's ownership (UI, campaign, campaign data).

| # | Severity | Issue | Repro | Where | Status |
|---|---|---|---|---|---|
| 1 | major | **Abandon mission was one click, and it can end a career.** Over enemy lines it records capture. A new player pressing Esc → Abandon to leave a bad fight lost the pilot for good, with no warning. | Career → fly over the lines → Esc → Abandon mission | `src/ui/hud/hud.ts` | **Fixed:** a confirmation card explains the consequence ("…you will come down there and be taken prisoner"). |
| 2 | major | **Instant action took about a minute to reach the enemy.** Head-on quick dogfights started about 5 km apart, so the first 55 s were straight-line flying. RB2's instant action threw you into the fight. | Quick Mission → Dogfight → head-on | `src/campaign/quickMission.ts` | **Fixed:** the flights start about 2.6 km apart and merge in about 25 s. Other quick types keep their run-in. |
| 3 | major | **The trench line reads as a thick black sawtooth band from altitude.** At about 2 km over Croisilles, the zig-zag trench is a solid dark ribbon many pixels wide. It is the most "game-y" thing on screen. | Quick dogfight (Camel, Feb 1918) → look down from 2,000–2,500 m | `src/render/terrain` (trench mask / terrain material) | **Fixed** (wave 6): energy-conserving trench lines, mottled woods. |
| 4 | major | **In mouse-aim mode the cockpit view follows the aim point.** Whenever the aim is well off the nose (turn fights, hunting above or behind), the whole screen is the upper-wing underside or empty sky, with no airframe or horizon for reference. That is disorienting, and unlike RB2's fixed forward view plus padlock. | Any fight with mouse-aim; aim 40°+ off the nose | `src/game/cameras.ts` / `src/game/input.ts` | **Fixed** (game wave 6): the head leads the aim by at most ±25° yaw / +12° up, eased, and the aim ring pins to the screen edge when off view. See `docs/screenshots/aimlead-*.jpg`. |
| 5 | minor | **Historical ranks and honours were static.** Standings, briefings and wingman rosters used each ace's final rank and VC in every year: "Major William Bishop VC" in June 1917, "Capt. Guynemer" in July 1916, "Captain Reed Chambers" in April 1918. | Ace Standings tab or a briefing in 1916–17 | `src/data/aces.ts`, campaign | **Fixed:** dated rank histories and honours for 17 aces (`aceNamesOn`), used by briefings, standings, debrief news and wingmen. |
| 6 | minor | **French July 1916 escort briefing named "Royal Aircraft Factory R.E.8 machines".** The R.E.8 entered service in November 1916, and the roster has no earlier two-seater. | N.3, 10 July 1916, escort | `src/campaign/missionGen.ts` | **Fixed** in text: stand-in types are named generically ("observation two-seaters") before they entered service. The 3D model is still an R.E.8: see #15. |
| 7 | minor | **Enlistment cards list dead aces as current comrades.** Jasta 2 in April 1918 read "with Boelcke, Richthofen, Voss". | Enlist, German, April 1918 | `src/ui/screens/createPilot.ts` | **Fixed:** shows aces actually serving on the date, otherwise "home of …". |
| 8 | minor | **The patrol line's "north" end was sometimes the southern one.** Labels followed leg order, not geography. | Jasta 11, 5 April 1918, barrier patrol briefing map | `src/campaign/missionGen.ts` | **Fixed** |
| 9 | minor | **Briefing-map waypoint tags stacked on top of each other.** "Cross the lines" and "Recross the lines" sit on the same spot, and one circle hid the other. | Any free hunt or ground attack | `src/ui/map/mapRenderer.ts` | **Fixed:** shared circle "1·3" and a merged tag. The home field's name no longer runs off the left edge. |
| 10 | minor | **Lothar von Richthofen flew while in hospital.** His service ran unbroken from March 1917 to August 1918, so he appeared as a Jasta 11 wingman on 5 April 1918, when he was wounded (13 March to 19 July 1918). | Jasta 11 career, April 1918 | `src/data/aces.ts` | **Fixed:** service periods have his hospital gaps. |
| 11 | minor | **Wingman list shows surnames only.** "Richthofen" appeared twice. | Jasta 11 flight with both brothers | `src/game/hudView.ts` `wingmen()` | **Fixed** (game wave 6): clashing surnames get an initial ("M. Richthofen", "L. Richthofen"). The campaign also keeps squadron mates off the player's surname. |
| 12 | minor | **War-period blurbs were off by a battle.** "Third Ypres" began on 1 June 1917 (it opened on 31 July; June was Messines). "Richthofen forms Jasta 11" (he took command of it). The Dr.I "appears in numbers" at Cambrai (it arrived only in ones and twos). | Enlistment screen date slider | `src/ui/catalog.ts` | **Fixed** |
| 13 | minor | **Grammar in debrief text:** "None of your 1 claim could be confirmed", "1 sorties". A POW record also said "Five confirmed and they will call you an ace." | Unconfirmed single claim; captured pilot's HQ | `src/campaign/debrief.ts`, `src/ui/screens/{debrief,hq}.ts` | **Fixed** |
| 14 | polish | **56 Sqn "Formed: 1 June 1917".** It arrived in France in April 1917 (the in-game start follows the S.E.5a's availability, DECISIONS D-010). | HQ → Squadron tab | `src/ui/screens/hq.ts` | **Fixed** label ("In the line from"). The data window is unchanged. |
| 15 | polish | **No early-war two-seaters in the roster** (B.E.2c, F.E.2b, Farman, Aviatik), so 1915–16 escort and intercept missions fly R.E.8 and Rumpler models a year early. | Any 1915–16 escort or intercept | `src/data/aircraft.ts` + model pipeline | Routed (data/models) |

Evidence for #3: the dark woodland patches at the top of
`playtest-mouseaim-down.png` are the same problem. From altitude, dark
land-use features read as flat black ink rather than shaded ground.

## Other observations (not ranked)

- **Time compression stays on while strafing:** at ×4 the flight dropped to
  60–200 m over the trenches under ground fire, and compression only cut out
  when an enemy aircraft came within range. **Fixed** (game wave 6): it also
  drops below 300 m over enemy ground or near enemy targets/AA, and for 8 s
  after the player is hit, near-missed or bracketed by flak.
- **Stalls in turn fights:** the scripted pilot often let the Camel sink to
  45–70 km/h with STALL showing, because it keeps the aim on a climbing
  target. Hands-off at the start is fine: the Camel holds about 147 km/h and
  the SPAD XIII about 186 km/h, level. This is a skill question, not a bug.
- **Quick mission default** was 3 regular D.Vs against you plus one wingman,
  which is hard for a first flight. **Fixed:** the default is now a pair.
- **What works well:**
  - The period presentation: title art, enlistment form, typed briefings,
    the trench map, telegrams, rubber stamps, the POW record.
  - The Flying School card is clear.
  - Views (F1–F5), padlock with next-target, the map overlay, the orders
    list and time compression all work.
  - Briefings match what happens in flight: waypoints, escort charges,
    intercept targets and the intelligence about enemy squadrons were where
    the orders said.
  - Debrief news of aces' deaths lands on the historical dates (Guynemer,
    Wolff, Wüsthoff).
  - Periods, liveries and insignia change with the date (iron cross before
    April 1918).
  - The drop caps in the CO's remarks read as "Agood" in scraped text but
    render correctly on screen.

## Verdict

**It feels like Red Baron II. It is playable and coherent, and it is close to
something a fan would enjoy for an evening.**

- **Strengths:**
  - The career wrapper: squadron, briefing, sortie, debrief, telegram and
    logbook.
  - The historical texture, which is now also right about ranks and
    comrades on the date.
  - Instant action gets you into a fight in under half a minute.
- **Remaining weaknesses:** mainly in flight.
  - **Mouse-aim camera (#4):** the cockpit view chases the aim point, which
    buries the horizon in the wing whenever you manoeuvre hard. This is the
    single change most likely to make flying feel like RB2 rather than a
    modern arcade game.
  - **Trenches from altitude (#3):** they read as black ink.
- **Nothing found blocks play.** Every mission type seen (patrol, free hunt,
  escort, intercept, ground attack) briefed, flew, ended and debriefed
  correctly. Career state persisted across sorties. Fates (returned, captured,
  killed) produced the right screens and closed the record.
