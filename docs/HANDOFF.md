# Handoff: AI depth and web deployment (temporary)

You are picking up **Red Baron II: Reloaded**, a browser rebuild of Dynamix's 1997 WWI
flight sim, at a release-candidate state. The user has asked for two pieces of work next:

- **A. AI depth.** Aces and regulars use the sun, clouds and the vertical, and named aces
  fly with signature tactics.
- **B. Deploy.** Host the production build at a public URL so the user can share it.

You own this work end to end. Make the decisions yourself, record each significant one in
`DECISIONS.md`, commit as you go, and keep going until both are done and verified. Ask
the user only about things that are genuinely theirs to decide; the list is under
"Needs the user" below.

Delete this file (with `trash`) in your final commit once both tasks are finished and
`docs/STATUS.md` carries their outcome.

---

## 1. State at handoff

- `main` is clean and every agent worktree is merged and removed. There is **no git
  remote** yet.
- Baseline on `main`, which you must not regress:

  | Check | Baseline |
  |---|---|
  | `npx tsc --noEmit` | clean |
  | `pnpm test` | 334 passed, 21 skipped (env-gated soaks) |
  | `E2E_PORT=5241 pnpm e2e` | 16 passed, 1 skipped (gated soak) |
  | `pnpm build` | OK (dist ≈ 9.5 MB) |
  | `pnpm prodcheck` | passes at `/` and at a subpath (see §5) |

- Run it with `pnpm dev`, then open http://localhost:5173. The README's "Your first
  flight" section is the player's walkthrough.
- Toolchain: Node 22, pnpm 12.6, TypeScript strict, Three.js r186, Vite, Vitest, and
  Playwright driving installed Chrome.

## 2. Read these first, in this order

1. `CLAUDE.md` in the repo root: project rules and agent workflow lessons. It is mandatory.
2. `docs/STATUS.md`: what's done and what's open, with a disposition on each item.
3. `docs/ARCHITECTURE.md`: modules, the composition root (`src/game/modules.ts`, with the
   flight-side bindings in the lazy `src/game/flightModules.ts`), loop
   timing (sim 120 Hz, AI 30 Hz, render per rAF) and coordinates (+X east, +Y up, −Z
   north; body forward −Z).
4. `docs/ai.md`: the AI's structure, the tuning history for waves 4–7, and **"Known
   weaknesses"**, which is your starting brief for task A.
5. `DECISIONS.md`: D-001 to D-071. The ones most relevant to task A:
   - D-059..D-063: pitch-law inversion, low-level defence, wounds, strafers.
   - D-068/D-069: ground-attack defenders and collision avoidance.
   - D-070: drag-aware lead; out-turned tactics measured and *rejected*.
   - D-071: the Quick Mission default fight stays Camel against D.V, to be revisited
     after AI changes.

   For task B, read D-008 (fan-project naming and no original assets) and the
   lazy-chunk decision D-056.
6. `docs/game.md`: the autoplayer and soak harness, mission director and time
   compression.
7. `docs/PLAYTEST.md`: the wave-5 and wave-7 human-style playtests and what players noticed.

## 3. Rules that bite (from the user; CLAUDE.md covers the rest)

- **Commit signing:** commits are SSH-signed through 1Password (`commit.gpgsign=true`,
  `op-ssh-sign`). If a commit fails with `1Password: agent returned an error`, **stop and
  ask the user** to unlock 1Password. Never disable signing and never use
  `--no-gpg-sign`. Staged work in a worktree survives; commit it once the user says
  to go ahead.
- **Dependencies:** install with `sfw pnpm add …` / `sfw pnpm install`. A new runtime
  dependency needs a DECISIONS entry. In CI a plain `pnpm install --frozen-lockfile` is
  fine.
- **Python:** `uv run python`, never `python3`. Use `jq` for JSON.
- **Deleting files:** `trash`, not `rm`, for anything user-authored. `rm` is fine for
  build output.
- **Waiting:** never `sleep` to wait. Background jobs and agents notify on completion.
- **Committing:** stage only files you or your agents changed; never force-push. Verify
  before claiming done: run the command and quote the numbers.
- **`src/core/`** is a shared contract. Changes there must be additive (optional fields,
  new union members) and noted in the report.
- **Pure-logic modules** (`src/sim`, `src/ai`, `src/world`, `src/campaign`) must not
  import three.js scene or renderer code; math classes only. This matters for task A: the
  sun and cloud code the AI needs currently lives in `src/render` (see §4.2).

## 4. Task A: AI depth (sun, clouds, the vertical, ace signatures)

### 4.1 Why
- Fights settle into flat turning circles. The AI never uses the sun or clouds, and aces
  make little use of the vertical (`docs/ai.md` "Known weaknesses").
- **Named aces are only a skill level.** `src/ai/controller.ts` never reads
  `AircraftEntity.aceId`; the only difference between an ace and anyone else is
  `Ace.skill` in `src/data/aces.ts`.
- Wave 7 proved the Albatros D.V can't beat a Camel by turning (wing loading 44 against
  31 kg/m²) and that more gunnery accuracy doesn't change the result (D-070).
  Historically it won by **boom-and-zoom from above and out of the sun**. Doing that is
  the "real" fix for the lopsided default fight, instead of a tuning hack.

### 4.2 What exists (file map)
- **`src/ai/controller.ts`** (~1,400 lines): the per-aircraft state machine
  (formation, pursue, attack, evade, strafe, RTB, wingman commands), running at 30 Hz.
  `AIControllerOptions` sits at about line 53.
- **Supporting AI modules:**
  - `src/ai/maneuvers.ts`: breaks, extensions, recoveries.
  - `src/ai/autopilot.ts`: turns desired direction, g and speed into stick, rudder
    and throttle. This includes the tail-AoA pitch-law inversion; see D-059 and don't
    undo it.
  - `src/ai/gunnery.ts`: drag- and turn-aware lead.
  - `src/ai/perception.ts`: the visual sweep. It uses a range and rear blind cone only,
    with **no sun glare and no cloud occlusion**.
  - `src/ai/traits.ts`: the `turn` / `energy` / `mixed` style per type.
  - `src/ai/skill.ts`: `SkillProfile`, derived from skill, role and realism.
- **`src/data/aces.ts`:** the historical aces (skill, service periods, ranks,
  victories, fate). There is no tactics field yet.
- **Sun:** `sunPosition(date, hour)` and `hourForTimeOfDay` in
  `src/render/environment.ts` are **pure math**, but they live in `src/render`. Move them
  to `src/world/sun.ts` and re-export from `src/render/environment.ts` so the renderer and
  the AI share one source.
- **Clouds:** `src/render/clouds.ts` places cumulus puffs deterministically: a hash
  over a drifting 3 km cell grid (`CELL`, `hash()`), plus `densityAt(p)` about line
  417. Extract the placement and density maths into a pure `src/world/clouds.ts`, which
  the `CloudLayer` consumes. That way **the AI sees exactly the clouds the player sees**,
  and a hunter doesn't vanish into a cloud that isn't drawn. The drift uses the wind
  offset, so keep it a function of mission time.
- **World access:** the AI reads `WorldQuery` (`src/core/interfaces.ts`), which has
  `time` and `date` but no sun, time of day or weather. Add optional fields, for example
  `sunDirection?: Vector3` and `cloudDensityAt?(x, y, z): number`. Populate them in
  `buildWorld` (`src/game/world.ts:109`) from `mission.timeOfDay` and `mission.weather`.
  Keep test worlds working: `src/ai/testing/testWorld.ts` and
  `src/ai/testing/realSimHarness.ts`.

### 4.3 What to build (suggested; you decide the details)

**1. Perception.**
- **Sun glare:** an enemy within about 10–15° of the sun (sun elevation above about 5°)
  is much harder to spot until close. Skill shortens that distance.
- **Cloud line of sight:** sample `cloudDensityAt` along the ray, so a target can
  be lost in cloud.
- **Memory:** a "last seen" position lets hunters search where they last saw a target.
- **Fairness toward the player:** decide whether the HUD threat triangles and padlock
  should also respect sun and cloud. RB2 padlock worked through cloud; record the
  decision.

**2. Positioning before the merge.**
- Aces and veterans who spot an enemy first, without being seen, climb for a height
  advantage and move up-sun before attacking; aces are more patient about it.
- Energy-style types (see `traits.ts`) do **boom-and-zoom**: dive, fire a burst, zoom
  climb, reposition. They avoid sustained flat turns against turn-style types.
- Turn-style types keep turning, but aces use a high yo-yo when overshooting.
- **Wave-7 warning:** a high yo-yo *alone* made no difference (D-070). The gain has to
  come from the **entry**: starting above, unseen, out of the sun. Measure entry
  geometry first.

**3. Defence and escape.**
- Damaged or outnumbered pilots run for nearby cloud or dive for their own lines, and
  aces break *into* a bounce from the sun.
- Don't reintroduce "run home when outnumbered low" without measuring; wave 4 found it
  made things worse.

**4. Ace signatures.**
- Add an optional `tactics` field to `Ace` in `src/data/aces.ts`, for example
  `'stalker' | 'lone-hunter' | 'leader' | 'brawler' | 'two-seater-hunter'`.
- Map each value to parameters in `src/ai`: patience, preferred height advantage, sun
  use, target choice (stragglers or two-seaters), burst discipline, and when to disengage.
- Ground them in history, and note sources in the DECISIONS entry. Candidates to check:
  - Richthofen: patient; attacks from above and behind, prefers stragglers and
    two-seaters; flies as a leader.
  - Bishop: lone dawn hunter.
  - McCudden: stalks high two-seaters.
  - Mannock: formation leader and tactician.
  - Guynemer: aggressive and close.
  - Voss: brilliant turning dogfighter.
  - Rickenbacker: calculated; attacks only with the advantage.
- Pass `aceId` or the trait through the AI adapter. It maps flight slots into
  `AIControllerOptions`, and there are **two copies to keep in step**:
  `src/game/flightModules.ts` (the real game, lazy chunk) and `src/game/autoplay.ts`
  (the headless autoplayer). If only one is changed, the soaks measure a different
  AI from the one players meet.

### 4.4 How to measure (the harness exists; use it)
The autoplayer flies the player with the same AI, so these are veteran-player numbers.
They are an upper bound on a human's skill, not a stand-in for one.

- **Fairness:** `AI_SOAK=fairness AI_FAIR_SET=default AI_FAIR_REPS=16 pnpm vitest run src/ai/fairness.soak.test.ts`.
  The sets are `default | mirror | matrix | survey | vet`; `AI_FAIR_ONLY=<substr>` picks a
  subset. At 16 reps expect **±12% noise**. Use 24 or more for any number you
  report.
- **Gunnery and geometry diagnostic:** `AI_SOAK=gundiag …src/ai/gundiag.soak.test.ts`
  gives nose-on time, firing time, and hits by aspect. Extend it with "attack entered from
  above / up-sun" and "time in sustained flat turn".
- **Career and quick survey:** `AUTOPLAY=career,quick AUTOPLAY_MISSIONS=5 AUTOPLAY_OUT=<scratch>/ap.txt pnpm vitest run src/game/autoplay.soak.test.ts`.
  The other `AUTOPLAY_*` knobs are listed in `docs/game.md`.
- **Other soaks:** `AI_SOAK=collision|lowlevel|lossdiag|quickdiag|probe|dither`; see
  each file's header.
- **Real-sim regression tests** run in `pnpm test`: `src/ai/*.realsim.test.ts` and
  `src/ai/scenarios.test.ts`. Average over several seeds; several earlier tests passed
  only on lucky seeds.

Acceptance targets (reset them if the data argues otherwise, and record why):

| Measure | Now | Target |
|---|---|---|
| Default quick fight (Camel+1 v 2 regular D.V), player down | 0–8% | rises clearly, toward 20–40%, from D.V boom-and-zoom, **with no flight-model changes** |
| Mirror fights, player down | 13–56% (noisy) | stays 30–70% |
| Veteran career killed or captured | ~29% | ≤ 30–32% |
| Quick ground attack default: success / killed or captured | 96% / 8% | no worse than 90% / 20% |
| Career collisions per 100 missions | 3.5 | ≤ 5 |
| Share of AI attacks entered from above or up-sun (new metric) | ~0 | aces clearly higher than novices |

After the change, re-measure the default fight and **revisit D-071**. Keep it, or write
a superseding decision.

### 4.5 In-engine proof
Numbers aren't enough. Take screenshots of an ace diving out of the sun onto the player,
and of a pilot using cloud to escape, then read them back:
- `src/render/dev/playShots.mjs` has the showcase scenes (`sc-*`), and you can add a
  scene.
- `tools/playtest/flight-shots.mjs` and `aim-turn-shots.mjs` drive real flights through
  `window.__rb2` debug hooks.

## 5. Task B: public deployment

### 5.1 Facts
- `vite.config.ts` has `base: './'`, so the build works at any subpath.
  `tools/playtest/prodcheck.mjs <port> [subpath]` loads the menus, flies a quick
  mission in the built game, and fails on any 404, HTML-served asset or console
  error. Serve with `pnpm preview --port 5325 --strictPort`.
- The flight code is a lazy chunk (D-056). The GLB models (`public/models`, 6.6 MB) and
  art (`public/art`) are static files, and all audio is procedural. There is no
  server-side code.
- The README already carries the fan-project disclaimer and D-008: no Dynamix or Sierra
  code, art or sound.
- `gh` is logged in as `chrisvaillancourt`. There is **no remote**, so the repo doesn't
  exist on GitHub yet.

### 5.2 Needs the user (ask before acting; publishing is outward-facing and hard to undo)
Ask these together, with a recommendation for each:
1. **Repo:** name (suggest `chrisvaillancourt/red-baron-2-reloaded`) and visibility.
   GitHub Pages from a private repo needs a paid plan; public is simplest.
2. **Name and trademark:** confirm they're comfortable publishing under the "Red Baron
   II: Reloaded" title. The disclaimer is in place, but a public URL raises the stakes.
3. **Host:** GitHub Pages (recommended: free, and the Actions deploy sits next to the
   code) or another static host.

### 5.3 Then
- Create the repo with `gh repo create` and push `main`. Pushing is also outward-facing,
  so do it only after the user answers.
- **Workflow:** add `.github/workflows/deploy.yml`, triggered on push to `main`.
  - Checkout, `pnpm/action-setup` (pnpm 12), `actions/setup-node` (22, pnpm cache).
  - `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
  - `actions/upload-pages-artifact` from `dist`, then `actions/deploy-pages`.
  - Pin action versions by major tag or SHA.
  - Keep Playwright e2e **out of CI**: it needs a real GPU (Metal args) and the local Chrome.
- **Pages settings:** set the source to "GitHub Actions" (`gh api` or the settings
  page).
- **Verify the live URL:** run prodcheck against it. Today it takes a localhost port, so
  add a full-URL argument, e.g. `node tools/playtest/prodcheck.mjs https://….github.io/red-baron-2-reloaded/`.
  Also check a first load with a cold cache and a GLB fetch on the lazy flight chunk.
- **README:** add a "Play online" link at the top and a DECISIONS entry for the hosting
  choice. Add a short `docs/STATUS.md` note on how deploys happen.

## 6. How to run the work (lessons from waves 1–7)

- **Parallelise with forked agents in worktrees.** Use the Agent tool with
  `subagent_type: "fork"` and `isolation: "worktree"`.
  - Each agent owns disjoint directories. Say so in its prompt, with a unique port
    (`E2E_PORT=53xx`) and a **turn budget** (about 150). Agents that hit the 200-turn
    limit stop mid-work; continue them with `SendMessage` to their name and tell them
    to wrap up.
  - A sensible split for task A: agent 1 does the pure sun and cloud modules, the
    `WorldQuery` fields and perception. Agent 2 does tactics and ace signatures, coding
    against those fields: stub locally until agent 1 merges, or run the two in
    sequence. Task B is small; do it yourself while the agents run.
- **Merging:**
  - `git merge --no-ff <branch>`.
  - If `DECISIONS.md` conflicts or has `D-XXX` placeholders, run
    `zsh tools/dev/fixdecisions.sh`, check its printout, then `git add DECISIONS.md` and
    commit.
  - For other doc conflicts (for example the tables in `docs/PLAYTEST.md`), take the
    right line from each side by hand.
  - After every merge run `npx tsc --noEmit && pnpm test && pnpm build && E2E_PORT=5241 pnpm e2e`.
- **Worktree cleanup:** after merging, `git worktree remove <path>` then
  `git branch -d <branch>`. Worktrees can stay locked by the agent tool; if one is
  clean (`git -C <wt> status --porcelain` empty) and merged
  (`git merge-base --is-ancestor <branch> main`), use `git worktree remove -f -f`.
- **Timing tests fail under load.** When several agents run soaks, micro-benchmarks
  can fail on a busy machine (`src/world/world.test.ts` was hardened to a median of 7,
  with strict budgets only under `PERF_STRICT=1`). Rerun in isolation before treating a
  timing failure as real, and write any new perf test the same way.
- **E2E:**
  - Playwright uses Metal GPU args by default (`playwright.config.ts`);
    `E2E_SWIFTSHADER=1` is the weak-GPU path.
  - Port 5199 is the default. Use `E2E_PORT` when a dev server holds it.
  - A `ResizeObserver loop completed…` line in the web-server log is harmless noise.
- **Soak noise is real.** Fairness at 16 runs swings about ±12%. Compare before and after
  on the same seeds, and report run counts next to percentages.
- **Measure before you tune, and drop what doesn't move the number.** Waves 5–7 kept a
  change only when a soak showed it helped. D-070 records three plausible tactics that
  did nothing; revert failures rather than stacking them.
- **Check visuals in the running game, not in Blender.** EEVEE hides inverted normals.
- **Blender:** runs headless (`tools/blender/*.py`); gotchas are in `docs/models.md`.
  You shouldn't need it for these tasks.
- **Debug hooks:** `window.__rb2` exposes services, `rig`, `visuals`, `freeze`,
  `aiState` and `placeAtHome` in flight (`src/game/flightSession.ts`). Scripts in
  `tools/playtest/` show how to use them.

## 7. Definition of done

- **Task A:**
  - Merged, with the §4.4 before/after table in `docs/ai.md`.
  - "Known weaknesses" rewritten.
  - DECISIONS entries for the perception model, the tactics, and ace signatures with
    their sources.
  - D-071 revisited.
  - Screenshots from §4.5 committed under `docs/screenshots/`.
- **Task B:**
  - Live URL passes prodcheck.
  - Deploy workflow green on `main`.
  - README "Play online" link.
  - DECISIONS entry for hosting.
- **Both:**
  - The baseline in §1 holds or improves.
  - `docs/STATUS.md` updated, with a disposition on every leftover.
  - This file trashed in the final commit.
  - The final report to the user gives the URL, the metrics table, and anything
    deferred.
