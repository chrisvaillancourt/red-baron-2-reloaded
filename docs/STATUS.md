# Status

Updated 2026-11-04 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- `31ece95` deployed by [Actions run 41871328346](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/41871328346);
  live `prodcheck` OK. Node 26.12.1 LTS (D-117), long replays as soaks (D-118), D-116,
  pnpm 12.16.1 via `packageManager`, F-44 `checkcommits`, F-75 `prefix-check`,
  `worktrees.mjs`, tech-debt wave 1, and the Q-13/Q-06 plans.

## Now

| Track | Branch | Next action |
|---|---|---|
| Tech-debt wave 2 | local `main`, not pushed | Six refactors merged (sim hit tables, SegmentIndex grid, typed screen params, `flightSession` split, campaign rules); each reviewed clean. Merged tree vs `31ece95`: combat, AI default and long, world, mission and geo probes all `equal`; `pnpm check` green (763 Vitest, 45 tool tests). Run `E2E_PORT=<port> pnpm e2e` (stopped for a restart, not failed), then push and verify the deploy. |
| Friction fixes | `docs/friction-2026-11-04` (`5e4db72`) | Doc fixes from this session's agent friction plus F-113 to F-116; merge with wave 2. |

## Next

1. Q-13 controller: [finish plan](BACKLOG.md#finish-plan--2026-11-04) (menu-owner
   inheritance, session binding, prompt fixes, gates). Branch from `main` after wave 2 is
   pushed: wave 2 split `src/game/flightSession.ts`. Isolated agent worktrees start from
   `origin/main`, so create the worktree from local `main` if wave 2 is not yet pushed.
2. Q-06 mutual support: [finish-or-drop plan](BACKLOG.md#q-06--ordinary-flight-mate-mutual-support),
   decided by the step-4 soaks.
3. BACKLOG as contracts only (one Goal/Acceptance/Non-goals section per open item).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([DEFERRED-TODOS](DEFERRED-TODOS.md#blocked-task-contracts)).
- Q-11 license choice.
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-10 CI runner migration: target 2027-01-31.
