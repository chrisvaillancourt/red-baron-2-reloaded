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
  This pnpm rejects `-s`: use the plain forms (`pnpm typecheck`, `pnpm test`,
  `pnpm exec vitest run <paths>`).
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
  number at merge time). Agents always write `D-XXX` and never renumber, even after merging
  main; only the lead numbers entries, when merging to main (FRICTION F-59).
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
  Any `cd` is refused, including in a subshell `( … )`, and so are `for`/`while`/`until`
  loops and `<(…)` process substitution. Write a small Node script to the scratchpad instead. To run something from another
  directory, set `cwd` in `spawnSync` from a script.
  The repo's own path contains "github", which can trip the sandbox's git guard even for
  commands with no git in them (FRICTION F-24). If a plain `jq` or `grep` on such a path is
  refused, do it from a Node script.
  Don't reach into another agent's worktree (`git -C <path>` is refused); ask the lead
  what another track exports.
- **A/B with `node tools/dev/ab.mjs`** (career, quick, fairness; `--flag`, `--base <ref>`) and
  wait on background outputs with `node tools/dev/waitfor.mjs <file> <regex> …`. Don't
  hand-launch paired soaks or write sleep loops. Quote a difference only when the tool says
  "differs" (docs/ai.md "Tests").
- **Don't pin exact sim figures in tests.** A merge elsewhere (placement, weather,
  perception) shifts them. Compare with an independent count, or assert a range, unless the
  test is about determinism. Read aircraft and bomb figures from the spec rather than
  copying them into a test: a data change then can't leave a stale copy that still passes
  (F-77).
- **Scratch scripts that import project packages** (Playwright, three) go in the git-ignored
  `tools/dev/scratch/`, not the session scratchpad: Node resolves `@playwright/test` only
  from inside the repo (FRICTION F-48).
- **Edit source with Write/Edit, never heredocs.** The sandbox refuses heredoc edits
  inconsistently, so one that worked before can be refused the next time (F-46).
- **Back up a branch before a rebase with a tag,** not another branch: `rebase.updateRefs`
  moves branches along with the rewrite (F-50).
- **Playwright:** the cached Chromium revision doesn't match `@playwright/test`; launch with
  `chromium.launch({ channel: 'chrome' })` (see `tools/hangar-shots.mjs`) instead of downloading.
  Modals fade in over about 0.5 s, and Playwright counts a fading modal as visible, so wait
  for the fade to finish before a screenshot.
  `keyboard.press` goes down and up inside one frame, so for keys the game reads as held use
  `keyboard.down`, wait a few frames, then `keyboard.up` (F-61). Playwright wipes
  `test-results/` on every run; copy screenshots you want to keep to `tools/dev/scratch/`
  (F-62). A gamepad on the machine drives headless Chrome; stub `navigator.getGamepads` in
  specs that fly (F-60, see `tests/e2e/crew.spec.ts`).
- **Playtest reports:** the dev server saves every human flight to `playtests/inbox/`, which
  is git-ignored, so worktrees don't have it. Read an inbox report through the main
  checkout's absolute path. Move it to the tracked `playtests/reports/` only when your change
  cites it (D-084).
- **A red full e2e run under load isn't proof of a bug.** Spec files run in parallel on one
  GPU, and the user may be playing on `pnpm dev`. Re-run the failing specs alone, then
  compare with a baseline `git worktree` at the previous commit before blaming your change
  (FRICTION F-20).
- **Don't edit `src/` while an e2e run is going.** Vite hot-reloads the page under test, and
  the run goes red for no real reason (FRICTION F-40).
- **Test helpers:** never import from a `*.test.ts` file, because Vitest registers its tests
  again in the importing file. Shared fixtures go in a `testing/` module, like
  `src/game/testing/`. Vitest can swallow `console.log` in tests, so print soak output
  with `process.stdout.write`.
- **After `git mv`, stage only the new path.** A `git add` that names the old path fails as
  a whole and stages nothing. Check `git show --stat HEAD` after committing.
- **No `@types/node`:** Node-only tests declare what they need locally (e.g.
  `src/render/aircraft/node-shim.d.ts`); `node --experimental-strip-types` runs `tools/*.ts`
  but can't resolve extensionless relative imports, so exporters only import leaf data files.
- **three r186:** `PCFSoftShadowMap` is gone (use `PCFShadowMap`); buffer usage constant is
  `DynamicDrawUsage`; avoid `InstancedMesh` with a growing `count` for decals (WebGL draw errors) —
  merged per-part geometry with `setDrawRange` works.
- **Verify visuals in-engine, not only in Blender.** EEVEE previews render back faces, so inverted
  normals looked fine there but made wings see-through in three.js. Screenshot the real runtime.
- Blender/Cycles specifics live in `docs/models.md` → "Gotchas".
