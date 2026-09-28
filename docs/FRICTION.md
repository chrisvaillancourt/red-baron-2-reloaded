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
| F-1 | 2026-09-28 | lead, wave 9 | The Quick Mission defaults exist in several copies. `defaults()` in `src/ui/screens/quick.ts` is the source, but the "default" setups in `src/game/autoplay.soak.test.ts`, `src/ai/fairness.soak.test.ts`, `gundiag.soak.test.ts` and `quickdiag.soak.test.ts` are hand-copied. Changing the default means editing all of them, and a missed copy silently measures the old fight. | **Do:** move the defaults to one pure module that the screen and the soaks both import. |
| F-2 | 2026-09-28 | lead, wave 9 | Measuring a new candidate setup in the fairness soak means editing the test file to add a `SETS` entry. Nothing can be passed in from the command line. | **Defer:** add an `AI_FAIR_SETUP` JSON override if candidate sweeps come up again. |
