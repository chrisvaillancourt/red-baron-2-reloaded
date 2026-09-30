# Red Baron II: Reloaded — agent instructions

Modern browser rebuild of Dynamix's Red Baron II (1997). Read `DECISIONS.md` and
`docs/ARCHITECTURE.md` before working.

Shared project policy lives here. `CLAUDE.md` contains only an import of this file.

## Harness reference (read on demand)
- Before background jobs/services, browser QA or isolated-agent work, read only the active
  harness's section in `docs/HARNESSES.md`.
- When changing or diagnosing instruction discovery/imports, read Context discovery in
  `docs/HARNESSES.md` and verify fresh-session loading as described there.

## Shared rules
- TypeScript strict. Three.js r186. No new runtime dependencies without a DECISIONS.md entry.
  Install deps with `sfw pnpm install` / `sfw pnpm add` (Socket Firewall).
- Contracts in `src/core/` are shared. Don't change them casually; if you must, keep changes
  additive (new optional fields / new union members) and note it in your final report.
- Stay inside the directories your task owns. Coordinate missing dependencies through the
  integration owner using `src/core/interfaces.ts`. Temporary scaffolding may support
  development, but a task delivering behaviour is not complete while that behaviour depends
  on an unfinished stub. Name outstanding dependencies at handoff; the integration owner
  must replace scaffolding and verify the integrated path. Isolated test doubles are different.
- Pure-logic modules (`sim`, `ai`, `world`, `campaign`) must not import `three` scene/renderer
  code — only `three` math classes (Vector3, Quaternion, Matrix4, Euler, MathUtils).
- Tests: Vitest, co-located as `*.test.ts`. `pnpm test`, `pnpm typecheck` must pass before commit.
  This pnpm rejects `-s`: use the plain forms (`pnpm typecheck`, `pnpm test`,
  `pnpm exec vitest run <paths>`).
- **Commit before you call work done.** Run `git status` before reporting a task complete,
  finished or ready to merge, and commit your task's changes on its branch. Stage only your
  changes; leave unrelated work untouched. Name anything intentionally uncommitted and why.
  A committed branch is a handoff, not a claim that the change is merged or deployed.
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
  - Never force-push; never rewrite others' commits.
  - Lead merge commits keep the `Merge <branch>: <summary>` form. History before wave 9
    predates this rule.
- Record significant decisions in `DECISIONS.md`. Agents append `D-XXX` entries and never
  renumber, even after merging main; only the integration owner assigns the next free
  number when merging to main (FRICTION F-59).
- End every final report with a **Friction** section: what slowed you down, including
  missing tools, wrong or missing instructions, confusing structure, and flaky commands.
  Give each item a suggested fix. Write "none" if there was none. The lead logs each item
  in `docs/FRICTION.md` with a disposition. Read that file's Open table before starting.
- Run Python via `uv run python`, never bare `python3`. Use `trash` instead of `rm` for
  user-authored files.

## Shared session ownership
- Every concurrent editing session, including top-level Claude Code and omp sessions,
  owns a separate branch and worktree or harness-isolated workspace. The main checkout is
  reserved for the human and designated integration owner; read-only reviews may use it.
- Each task brief names the base commit, owned scope, integration owner, and (when needed)
  server ports and scratch/output locations. If no integration owner is named, finish on
  your task branch without merging or pushing `main`. Only that owner integrates or pushes
  `main`, within the user's authorization: every push to `main` deploys the public site.
- Prefer worktrees outside the checkout for manually managed sessions. Claude-managed
  worktrees may remain under `.claude/worktrees/`. Check the actual loaded context in nested
  workspaces for conflicting ancestor rules; do not assume all harnesses use the same layout.
- Modify only your workspace and branch. Handoff includes the branch/commit or retained
  patch location, changed scope, verification, and unresolved dependencies. Cross-harness
  messaging and task state are not shared; the brief and handoff are the contract.
- The parent session owns integrating retained isolated-agent changes into its task branch,
  resolving conflicts, verifying the integrated result, and committing before reporting it
  complete. A child's report alone is not proof that its changes reached the parent.
- Preserve existing worktrees. Before proposing removal, check ownership, uncommitted work,
  merge status and unpushed commits; obtain explicit user approval before deleting them.

## Shared execution and browser QA
- **Managed jobs:** start long finite commands as harness-tracked background jobs. Do other
  work meanwhile; use the harness's blocking wait when the result is needed and nothing else
  is actionable. Observe completion before reporting results. Do not poll with `sleep`.
  Stop temporary services you started before handoff, or explicitly hand over their ownership.
- **Dedicated tools:** use the harness's file/edit/search tools rather than shell equivalents
  for source changes. Prefer one plain command per shell call and an explicit working directory.
- **Server isolation:** human play keeps port 5173; automation uses an explicit strict port.
  From the owning worktree, run `RB2R_REPORTS_DIR=tools/dev/scratch/<task>/flight-reports pnpm dev --port <port> --strictPort`.
  Pass the same port to replay/screenshot tools instead of relying on their 5173 default.
  For e2e, choose a free `E2E_PORT`; retain `--strictPort` and `reuseExistingServer: false`
  in `playwright.config.ts`. Never silently reuse a server from another checkout.
- **Output isolation:** keep scratch/output within the owning workspace and task subdirectory.
  Set `RB2R_REPORTS_DIR` for agent dev servers so scripted flights cannot enter the human's
  `playtests/inbox/`. Playwright already directs its reports into `test-results/flight-reports`.
- **GPU scheduling:** coordinate full e2e runs and GPU-heavy browser/render jobs through the
  integration owner; run them one at a time on the machine. Without an owner, arrange an
  exclusive slot before starting. Different ports do not isolate the GPU or a real gamepad.
- **Browser evidence:** exercise the actual game from the owning server and inspect screenshots,
  not just DOM assertions. Respect the active harness's browser policy and linked reference.
  Check the actual browser/GPU configuration before interpreting visual or performance results;
  the existing Playwright configuration records the Chrome/Metal setup and software fallback.
  Existing Playwright suites remain the reproducible regression checks.
- Wait for modal fades to finish (about 0.5 s) before screenshots. For held game controls,
  send key-down, wait a few frames, then key-up: an instantaneous press can miss a sim frame.
  Stub `navigator.getGamepads` before the app starts in automated flights so a connected
  controller cannot drive the run (see `tests/e2e/crew.spec.ts`).
- Playwright wipes `test-results/` on every run. Copy screenshots worth keeping to your
  `tools/dev/scratch/<task>/` before another run (F-62).
- **Don't edit `src/` while an e2e run uses that workspace.** Vite hot-reloads the page under
  test and produces false failures (F-40).
- **A red full e2e run under load isn't proof of a bug.** Stop competing GPU work, run the
  failing specs alone, then compare with a baseline worktree at the previous commit before
  blaming your change (F-20). Do not run paired GPU-heavy baselines concurrently.

## Shared workflow lessons
- **New worktrees have no `node_modules`.** Run `sfw pnpm install` before tests, the
  typecheck or the dev server.
- **A/B with `node tools/dev/ab.mjs`** (career, quick, fairness; `--flag`, `--base <ref>`).
  For file-based readiness, `node tools/dev/waitfor.mjs <file> <regex> …` is the portable
  blocking helper. Don't hand-launch paired soaks or write sleep loops. Quote a difference
  only when the tool says "differs" (docs/ai.md "Tests").
- **Don't pin exact sim figures in tests.** A merge elsewhere (placement, weather,
  perception) shifts them. Compare with an independent count, or assert a range, unless the
  test is about determinism. Read aircraft and bomb figures from the spec rather than
  copying them into a test: a data change then can't leave a stale copy that still passes
  (F-77).
- **Scratch scripts that import project packages** (Playwright, three) go in the git-ignored
  `tools/dev/scratch/<task>/`, not the session scratchpad: Node resolves packages only from
  inside the repo (F-48).
- **Back up a branch before a rebase with a tag,** not another branch: `rebase.updateRefs`
  moves branches along with the rewrite (F-50).
- **Playtest reports:** human flights are saved to `playtests/inbox/`, which is git-ignored,
  so fresh worktrees do not contain them. Read a cited human report through the main checkout's
  absolute path. Move it to tracked `playtests/reports/` only when your change cites it (D-084).
- **Test helpers:** never import from a `*.test.ts` file, because Vitest registers its tests
  again in the importing file. Shared fixtures go in a `testing/` module, like
  `src/game/testing/`. Vitest can swallow `console.log` in tests, so print soak output
  with `process.stdout.write`.
- **After `git mv`, stage only the new path.** A `git add` that names a path already moved
  can fail the whole call and stage nothing. Check `git show --stat HEAD` after committing.
- **No `@types/node`:** Node-only tests declare what they need locally (e.g.
  `src/render/aircraft/node-shim.d.ts`); `node --experimental-strip-types` runs `tools/*.ts`
  but can't resolve extensionless relative imports, so exporters only import leaf data files.
- **three r186:** `PCFSoftShadowMap` is gone (use `PCFShadowMap`); buffer usage constant is
  `DynamicDrawUsage`; avoid `InstancedMesh` with a growing `count` for decals (WebGL draw errors) —
  merged per-part geometry with `setDrawRange` works.
- **Verify visuals in-engine, not only in Blender.** EEVEE previews render back faces, so inverted
  normals looked fine there but made wings see-through in three.js. Screenshot the real runtime.
- Blender/Cycles specifics live in `docs/models.md` → "Gotchas".
