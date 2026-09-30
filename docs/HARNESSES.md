# Harness execution reference

Read only the section for the active harness before background jobs/services, browser QA
or isolated-agent work. Read Context discovery when changing or diagnosing instruction
loading. Shared project policy stays in root `AGENTS.md`; this reference supplies mechanics,
not a second rulebook.

The active harness's instructions and current tool schema govern invocation syntax and
permissions. Historical workarounds are observations, not permission to bypass a safety denial.

## Claude Code
- **Editing subagents:** explicitly request worktree isolation, or set `isolation: worktree`
  in a reusable implementation-agent definition. A separate agent conversation alone does
  not isolate files. Follow Base commit verification below before the child edits.
- Claude's default worktree base is the remote default branch, not necessarily the parent's
  feature-branch HEAD. For a dependent track, use `worktree.baseRef: "head"` where appropriate
  or create a worktree at the named base explicitly. Do not change the project-wide default
  merely for one task, and do not assume uncommitted parent edits reach a worktree.
- Finite long jobs use Bash's `run_in_background` when supported; consume the completion
  result using the current wait/output mechanism. Do not end a task with unobserved owned jobs.
- Interactive browser QA may use installed Playwright with
  `chromium.launch({ channel: 'chrome' })` (see `tools/hangar-shots.mjs`). The cached Chromium
  revision does not match the installed Playwright; use installed Chrome rather than downloading.
- **Worktree-isolated subagents:** historical sandbox refusals include `cd` (even subshells),
  compound commands, loops, `$VAR` paths and process substitution (F-3, F-11, F-18, F-21).
  Use simple worktree-relative/absolute paths. If an allowed operation needs a workaround,
  put it in a small Node script using `spawnSync`'s `cwd`, written through file-editing tools.
  F-24 suspected a Git guard matching "github" in paths; treat that as an observation, not a
  universal shell restriction. Cross-worktree `git -C` was refused (F-39); request committed
  interface details from the owner rather than reaching into a sibling's working files.
- The session scratchpad may be shared across tracks (F-68); use a per-track subdirectory.
  Scripts importing project packages still belong in the repo's `tools/dev/scratch/<task>/`.

## omp
- Finite background commands use `async: true`; their timeout still applies. Long-lived
  services use a unique `name` plus `ready`, without `async` or `timeout`. Use native `cwd`
  instead of a Node wrapper merely to change directory; use `wait` only when blocked.
- Use the browser tool for interactive web QA. It supports explicit browser launch/attachment;
  verify the chosen Chrome/GPU setup rather than assuming it matches Playwright. Preserve the
  existing Playwright test runner; a browser-tool smoke run does not replace required tests.
- **Editing subagents:** set `isolated: true` on each parallel editing task. If unavailable,
  assign an explicitly created worktree; do not silently run concurrent writers in the
  parent's checkout. Read-only agents ordinarily need no separate workspace. Follow Base
  commit verification below before the child edits.
- Inspect the actual returned workspace/patch/branch and integration state; paths, lifecycle
  and whether changes are auto-applied vary by harness configuration. Follow `AGENTS.md`'s
  parent integration rule.
- Before delegating from omp through `claude_task`, read [omp integrations](OMP.md).

## Base commit verification
Before spawning an isolated implementation agent in either harness:
1. Commit shared prerequisites, especially `src/core/` contracts, before launching dependent
   tracks. Name the intended full base SHA in each brief; uncommitted parent changes are not
   a dependable handoff.
2. Create or select the child's workspace from that base. Confirm the child runs in its
   assigned workspace with `git rev-parse --show-toplevel` and record `git rev-parse HEAD`.
3. In the child's workspace, run `git merge-base --is-ancestor <base-sha> HEAD`. A zero exit
   status proves the required base is present. For a fresh track, also require HEAD to equal
   the named base; an existing track may include its own commits above it.
4. If the check fails, stop before editing and have the parent correct the workspace/base.
   Do not improvise against stale contracts or merge an unspecified moving `main`.

These checks complement the ownership and integration rules in `AGENTS.md`; they do not
authorize a child to edit another workspace or publish changes.

## Context discovery
- `CLAUDE.md` contains only `@AGENTS.md`. omp may select either root file, so both entry
  points must yield the same shared policy. A native `.omp/AGENTS.md` could shadow them.
  Keep harness mechanics in this reference rather than a competing auto-loaded rulebook.
- `AGENTS.md` points here with explicit task triggers, not an import. Do not use an `@` import
  for this reference: that would load every harness's mechanics on every turn and defeat
  progressive disclosure.
- After changing discovery/imports, verify the loaded context in fresh sessions of both
  harnesses, including isolated workspaces. Shared rules and the reference pointer must load
  automatically; these mechanics should be read only when the corresponding task needs them.
  In nested worktrees, check for conflicting ancestor rules rather than assuming discovery
  stops at the workspace boundary.
- Claude context-loading probes must enable the project source (for example,
  `--setting-sources project`). Safe mode and an empty settings-source selection suppress
  project instructions; use a project-enabled session for discovery checks.
