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
- **Commit before you call work done.** Run `git status` before reporting a task complete,
  finished or ready to merge, and commit everything you changed. A final report with
  uncommitted work in it is not finished. If something is left uncommitted on purpose,
  such as a scratch file, name it in the report and say why.
- **Use logically grouped [Conventional Commits](https://www.conventionalcommits.org).**
  Format: `type(scope): summary`, imperative mood, under about 72 characters, and a body
  when the reason isn't obvious.
  - Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`.
  - Scope: the module (`ai`, `sim`, `world`, `render`, `audio`, `campaign`, `ui`, `game`,
    `data`, `core`, `tools`), omitted for changes that span modules.
  - Examples: `fix(ai): pursuer loses sight inside dense cloud`,
    `docs(status): wave 9 dispositions`.
  - One logical change per commit: code, its tests and its docs go together, and unrelated
    changes go in separate commits. Don't mix a refactor with a behaviour change.
  - Stage only files you changed. Never force-push; never rewrite others' commits.
  - Lead merge commits keep the `Merge <branch>: <summary>` form. History before wave 9
    predates this rule.
- Record significant decisions in `DECISIONS.md` (append `D-0NN` entries; take the next free
  number at merge time — use `D-XXX` placeholders if unsure and the lead will renumber).
- End every final report with a **Friction** section: what slowed you down, including
  missing tools, wrong or missing instructions, confusing structure, and flaky commands.
  Give each item a suggested fix. Write "none" if there was none. The lead logs each item
  in `docs/FRICTION.md` with a disposition. Read that file's Open table before starting.
- Run Python via `uv run python`, never bare `python3`. Use `trash` instead of `rm` for
  user-authored files.
- Browser QA: `pnpm dev` then drive with Playwright (`@playwright/test` is installed; use the
  installed Chrome via `channel: 'chrome'` — see below) and read screenshots back to check visuals.

## Agent workflow lessons (read before long-running work)
- **Don't poll with `sleep`.** Start long jobs (Blender/Cycles renders, full model rebuilds,
  dev servers) with the Bash tool's `run_in_background: true`; the harness sends a completion
  notification with the exit code. Do other work meanwhile, or simply end the turn and wait.
  Check interim progress by reading the task's output file only if you need it.
- **New worktrees have no `node_modules`.** Run `sfw pnpm install` before tests, the
  typecheck or the dev server.
- **Worktree-isolated agents:** the sandbox refuses compound commands it can't prove stay in the
  worktree (`cd … &&`, `$PWD`/`$VAR` in paths, multi-file heredoc pipelines). Use single commands
  with worktree-relative or absolute paths. Create files and append to docs with the
  Write/Edit tools, not heredocs, `cat >>` or `sed -i`. Use one plain command per Bash call.
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
