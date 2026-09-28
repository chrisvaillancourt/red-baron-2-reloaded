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
| F-2 | 2026-09-28 | lead, wave 9 | Measuring a new candidate setup in the fairness soak means editing the test file to add a `SETS` entry. Nothing can be passed in from the command line. | **Defer:** add an `AI_FAIR_SETUP` JSON override if candidate sweeps come up again. |
