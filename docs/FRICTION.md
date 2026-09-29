# Friction log

This log collects what made the project slower or harder to work on than it needed to be:
missing tools, confusing structure, instructions that were wrong or missing, and flaky
commands. Every agent's final report ends with a friction section, and the lead copies
each item here.

The rules:
- **Every item has a disposition:**
  - **Do:** a concrete fix, not yet made.
  - **Done:** fixed, with the commit or file.
  - **Defer:** worth doing, with the condition that triggers it.
  - **Skip:** not worth fixing, with the reason.
- **Promote lessons.** A lesson every agent needs goes into `CLAUDE.md` ("Agent workflow
  lessons"). This log keeps a pointer to it.
- **Remove finished items.** Delete Done and Skip entries once they are more than two
  waves old. Git history keeps them.

## Open

| # | Date | Source | Friction | Disposition |
|---|---|---|---|---|
| F-1 | 2026-09-28 | lead, wave 9 | The Quick Mission defaults exist in several copies. `defaults()` in `src/ui/screens/quick.ts` is the source, but the "default" setups in `src/game/autoplay.soak.test.ts`, `src/ai/fairness.soak.test.ts`, `gundiag.soak.test.ts` and `quickdiag.soak.test.ts` are hand-copied. Changing the default means editing all of them, and a missed copy silently measures the old fight. | **Done:** `src/data/quickDefaults.ts` (`QUICK_DEFAULTS`) is imported by the screen and all four soaks. |
| F-3 | 2026-09-28 | polish agent, wave 9 | The worktree sandbox refused a multi-command Bash call (a heredoc append, grep and sed), costing a retry. CLAUDE.md already warned about compound commands, but didn't mention appends. | **Done:** the CLAUDE.md worktree lesson now says one plain command per call, and appends go through Write/Edit. |
| F-4 | 2026-09-28 | polish agent, wave 9 | New worktrees start without `node_modules`, so tests and the dev server fail until `sfw pnpm install` has run. | **Done:** noted in CLAUDE.md "Agent workflow lessons". |
| F-5 | 2026-09-28 | polish agent, wave 9 | `window.__rb2ui` has no type declaration, so using it in an e2e test breaks `pnpm typecheck`. | **Do:** declare it next to `__rb2`. |
| F-6 | 2026-09-28 | polish agent, wave 9 | Unit tests run with `environment: 'node'`, so DOM behaviour such as Tab order can only be tested in e2e, which is slower. | **Defer:** add happy-dom for `src/ui` DOM tests (a new dev dependency, so it needs a DECISIONS entry). Trigger: the next UI task that needs DOM logic tests. |
| F-7 | 2026-09-28 | polish agent, wave 9 | The debrief has several pages advanced with Enter, and nothing documents their order, so a scratch script timed out waiting for the CO's remarks. | **Do:** document the debrief page order in `docs/ui.md`. Add a dev hook that opens a given page if scripts keep needing it. |
| F-8 | 2026-09-28 | cloud agent, wave 9 | An A/B measurement against the old code needs a second checkout. The agent temporarily checked the baseline AI files out in its worktree and ran the soaks one after another. | **Do:** add a `tools/dev` script that runs a given soak at a given commit in a scratch `git worktree` (never `cp -r`) and prints the two summaries side by side. |
| F-9 | 2026-09-28 | cloud agent, wave 9 | The career survey is slow (4–5 min a run) and noisy, with small collision counts. Telling a real change from noise took six runs. | **Do:** let one invocation take several seed sets (`AUTOPLAY_SEED_BASE=0,1000,2000`), and print killed-or-captured % and collisions per 100 missions with a 95% interval. |
| F-10 | 2026-09-28 | cloud agent, wave 9 | "Collisions per 100 missions" in docs/ai.md doesn't say whether it counts every collision or only those involving the player. | **Done:** defined in docs/ai.md "Wave 9 re-baseline": every collision event in the `COLLISIONS` line, with the `player-*` entries counting the player's. Printing a rate goes with F-9. |
| F-11 | 2026-09-28 | cloud agent, wave 9 | The worktree sandbox refused a plain `for` loop with `grep` over scratchpad files ("too complex"). | **Done:** the CLAUDE.md worktree lesson (F-3) now says one plain command per Bash call. Split loops into single commands, or put them in a script file written with the Write tool. |
| F-12 | 2026-09-28 | cloud agent, wave 9 | Rules changed mid-task: the Friction section and Conventional Commits arrived while the agent was working, so it had to reword a commit. | **Skip:** a one-off. Both rules are in CLAUDE.md now, and future agents read them at spawn. |
| F-13 | 2026-09-28 | lead, wave 9 | `tools/dev/fixdecisions.sh` joined the two sides of a DECISIONS conflict without the blank line before the next entry. 17 older entries had lost their separator this way. | **Done:** the script now restores a blank line before every `## D-` heading, and DECISIONS.md is normalized. |
| F-14 | 2026-09-28 | lead, wave 9 | The auto-mode classifier blocks rewording an agent's unpublished worktree commits with `git filter-branch`. Polish commits made before the Conventional Commits rule were merged unchanged. | **Skip:** agents now follow the rule from spawn (F-12). Agents should reword their own commits before reporting. |
| F-15 | 2026-09-28 | playtest-kit agent, wave 9 | Importing a helper from a `*.test.ts` file registered its tests again in the importing file, and `console.log` from tests was swallowed. | **Done:** a CLAUDE.md lesson ("Test helpers"). |
| F-16 | 2026-09-28 | playtest-kit agent, wave 9 | A `git add` that named a path already moved with `git mv` failed as a whole, so a commit went in with only the rename. | **Done:** a CLAUDE.md lesson (stage only the new path, then check `git show --stat HEAD`). |
| F-17 | 2026-09-28 | playtest-kit agent, wave 9 | Playwright counts a fading-in modal as visible, so a screenshot came out empty. | **Done:** added to the CLAUDE.md Playwright lesson. |
| F-18 | 2026-09-28 | playtest-kit agent, wave 9 | The worktree sandbox refused a subshell `(cd … && node …)` with no git in it. | **Done:** a CLAUDE.md worktree lesson. `cd` in any form is refused. To run from another directory, set `cwd` in `spawnSync` from a script. |
| F-19 | 2026-09-28 | playtest-kit agent, wave 9 | A test that pinned an exact sim figure (282.1 s of combat on seed 5000) would have broken on an unrelated merge (D-082 moves blocked starts). | **Done:** a CLAUDE.md testing lesson. Compare sim outputs with an independent count or a range, not an exact figure, unless the test is about determinism. |
| F-20 | 2026-09-28 | lead, wave 9 | The full e2e suite fails 2–7 unrelated tests (GPU "device lost", timeouts, `quick-keyboard` counting duplicate Tab stops) while the user plays on `pnpm dev` and other agents run browsers. Spec files run in parallel workers on one GPU. A pre-change baseline worktree failed the same way, and with the game closed the suite passed 18/18, so it is load, not code. | **Do:** make `quick-keyboard.spec.ts` robust to slow re-renders, and consider `workers: 1` for GPU-heavy specs. Until then, confirm a red run by re-running the failing specs alone and against a baseline worktree (CLAUDE.md lesson). |
| F-2 | 2026-09-28 | lead, wave 9 | Measuring a new candidate setup in the fairness soak means editing the test file to add a `SETS` entry. Nothing can be passed in from the command line. | **Defer:** add an `AI_FAIR_SETUP` JSON override if candidate sweeps come up again. |
