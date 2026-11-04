# Status

Updated 2026-11-04 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- `78f4dd4` deployed by [Actions run 41879408532](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/41879408532);
  live `prodcheck` OK (the first try hit a transient Pages 503 on a worker asset).
  Adds tech-debt wave 2 (full e2e 44 passed) and the friction doc fixes to the earlier
  Node 26.12.1 LTS (D-117), D-118, D-116, pnpm 12.16.1 and tooling work.

## Now

| Track | Branch | Next action |
|---|---|---|
| Q-13 controller | `feat/q13-controller` (worktree `../rb2r-q13`) | Q-13A merged and HUD, nav and prompt patches applied (`3601ff2`). Implementing [finish plan](BACKLOG.md#finish-plan--2026-11-04) B1 menu-owner, B2 session binding, B3 prompt fixes; then gates and a standard-tier review of B2. |

## Next

1. Q-06 mutual support: [finish-or-drop plan](BACKLOG.md#q-06--ordinary-flight-mate-mutual-support),
   decided by the step-4 soaks. Check in with the user before its feature code.
2. BACKLOG as contracts only (one Goal/Acceptance/Non-goals section per open item).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([DEFERRED-TODOS](DEFERRED-TODOS.md#blocked-task-contracts)).
- Q-11 license choice.
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-10 CI runner migration: target 2027-01-31.
