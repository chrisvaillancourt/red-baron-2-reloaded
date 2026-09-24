# Red Baron II: Reloaded — agent instructions

Modern browser rebuild of Dynamix's Red Baron II (1997). Read `DECISIONS.md` and
`docs/ARCHITECTURE.md` before working.

## Rules
- TypeScript strict. Three.js r186. No new runtime dependencies without a DECISIONS.md entry.
  Install deps with `sfw pnpm install` / `sfw pnpm add` (Socket Firewall).
- Contracts in `src/core/` are shared. Don't change them casually; if you must, keep changes
  additive (new optional fields / new union members) and note it in your final report.
- Stay inside the directories your task owns. If you need something from another module that
  doesn't exist yet, code against the interface in `src/core/interfaces.ts` and stub locally.
- Pure-logic modules (`sim`, `ai`, `world`, `campaign`) must not import `three` scene/renderer
  code — only `three` math classes (Vector3, Quaternion, Matrix4, Euler, MathUtils).
- Tests: Vitest, co-located as `*.test.ts`. `pnpm test`, `pnpm typecheck` must pass before commit.
- Commit your work as you complete coherent pieces (small, descriptive commits). Stage only
  files you changed. Never force-push; never rewrite others' commits.
- Record significant decisions in `DECISIONS.md` (append `D-0NN` entries; take the next free
  number at merge time — use `D-XXX` placeholders if unsure and the lead will renumber).
- Run Python via `uv run python`, never bare `python3`. Use `trash` instead of `rm` for
  user-authored files.
- Browser QA: `pnpm dev` then drive with Playwright (`@playwright/test` is installed; Chromium
  is cached) and read screenshots back to check visuals.
