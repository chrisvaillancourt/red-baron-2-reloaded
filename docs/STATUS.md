# Status

Updated 2026-11-04 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- `3b3a89e` deployed by [Actions run 41891081021](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/41891081021);
  live `prodcheck` OK. Adds Q-13 Xbox controller coverage (merge `04ddbae`; full e2e 54
  passed) to tech-debt wave 2, the friction doc fixes, Node 26.12.1 LTS (D-117), D-118,
  D-116, pnpm 12.16.1 and the tooling work.

## Now

| Track | Branch | Next action |
|---|---|---|
| Q-06 mutual support | not started | Waiting for the owner's go-ahead before feature code; plan in Next 1. |

## Next

1. Q-06 mutual support: [finish-or-drop plan](BACKLOG.md#q-06--ordinary-flight-mate-mutual-support),
   decided by the step-4 soaks. Check in with the user before its feature code.
2. BACKLOG as contracts only (one Goal/Acceptance/Non-goals section per open item).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([DEFERRED-TODOS](DEFERRED-TODOS.md#blocked-task-contracts)).
- Q-11 license choice.
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-13 controller: physical Xbox acceptance (USB and Bluetooth, Chrome and Safari).
- Q-10 CI runner migration: target 2027-01-31.
