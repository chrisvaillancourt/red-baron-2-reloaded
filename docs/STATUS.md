# Status

Updated 2026-11-04 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- `dcb3961` deployed by [Actions run 41898030234](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/41898030234);
  live `prodcheck` OK. Adds DOM unit tests in Vitest browser mode (D-120; Vitest 5.0.5),
  probe evidence scoped to inputs and coverage floors (F-113, F-115) and Q-15's closure
  (D-119) to Q-13 Xbox controller coverage (`04ddbae`), tech-debt wave 2, Node 26.12.1 LTS
  (D-117), D-118, D-116 and pnpm 12.16.1.

## Now

| Track | Branch | Next action |
|---|---|---|
| Q-06 mutual support | `feat/q06-mutual-support` (worktree `../rb2r-q06`) | Owner approved. Steps 1–3 (port behind `TACTICS_FLAGS.mutualSupport`, fixtures, relief counts) in progress; then step-4 soaks one at a time and step-5 review decide keep or drop. |

## Next

1. BACKLOG as contracts only (one Goal/Acceptance/Non-goals section per open item).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([DEFERRED-TODOS](DEFERRED-TODOS.md#blocked-task-contracts)).
- Q-11 license choice.
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-13 controller: physical Xbox acceptance (USB and Bluetooth, Chrome and Safari).
- Q-10 CI runner migration: target 2027-01-31.
