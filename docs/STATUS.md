# Status

Updated 2026-11-04 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- Release `4f7abbd` deployed by [Actions run 41869054412](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/41869054412);
  live `prodcheck` OK. Node 26.12.1 LTS (D-117), long replays as soaks (D-118), D-116,
  F-44 `checkcommits`, tech-debt wave 1. Then pnpm 12.16.1 via `packageManager`,
  F-75 `prefix-check`, `worktrees.mjs`, and the Q-13/Q-06 plans.

## Now

| Track | Branch | Next action |
|---|---|---|
| Tech-debt wave 2 | `perf/sim-*`, `perf/world-segment-grid`, `refactor/*` | Behavior-neutral refactors proved with the equivalence probes; review, then integrate. |

## Next

1. Q-13 controller: [finish plan](BACKLOG.md#finish-plan--2026-11-04) (menu-owner
   inheritance, session binding, prompt fixes, gates).
2. Q-06 mutual support: [finish-or-drop plan](BACKLOG.md#q-06--ordinary-flight-mate-mutual-support),
   decided by the step-4 soaks.
3. BACKLOG as contracts only (one Goal/Acceptance/Non-goals section per open item).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([DEFERRED-TODOS](DEFERRED-TODOS.md#blocked-task-contracts)).
- Q-11 license choice.
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-10 CI runner migration: target 2027-01-31.
