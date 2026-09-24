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
- Browser QA: `pnpm dev` then drive with Playwright (`@playwright/test` is installed; use the
  installed Chrome via `channel: 'chrome'` — see below) and read screenshots back to check visuals.

## Agent workflow lessons (read before long-running work)
- **Don't poll with `sleep`.** Start long jobs (Blender/Cycles renders, full model rebuilds,
  dev servers) with the Bash tool's `run_in_background: true`; the harness sends a completion
  notification with the exit code. Do other work meanwhile, or simply end the turn and wait.
  Check interim progress by reading the task's output file only if you need it.
- **Worktree-isolated agents:** the sandbox refuses compound commands it can't prove stay in the
  worktree (`cd … &&`, `$PWD`/`$VAR` in paths, multi-file heredoc pipelines). Use single commands
  with worktree-relative or absolute paths, and create files with the Write tool, not heredocs.
- **Playwright:** the cached Chromium revision doesn't match `@playwright/test`; launch with
  `chromium.launch({ channel: 'chrome' })` (see `tools/hangar-shots.mjs`) instead of downloading.
- **No `@types/node`:** Node-only tests declare what they need locally (e.g.
  `src/render/aircraft/node-shim.d.ts`); `node --experimental-strip-types` runs `tools/*.ts`
  but can't resolve extensionless relative imports, so exporters only import leaf data files.
- **three r186:** `PCFSoftShadowMap` is gone (use `PCFShadowMap`); buffer usage constant is
  `DynamicDrawUsage`; avoid `InstancedMesh` with a growing `count` for decals (WebGL draw errors) —
  merged per-part geometry with `setDrawRange` works.
- **Verify visuals in-engine, not only in Blender.** EEVEE previews render back faces, so inverted
  normals looked fine there but made wings see-through in three.js. Screenshot the real runtime.
- Blender/Cycles specifics live in `docs/models.md` → "Gotchas".
