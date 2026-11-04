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
| — | — | Nothing in flight. Q-06 dropped by its soaks (D-121); pick from Next. |

## Next

Nothing ready; see Blocked on the owner. Open contracts: [BACKLOG](BACKLOG.md).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([BACKLOG](BACKLOG.md#q-09-damage--damage-path-default)).
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-13 controller: physical Xbox acceptance (USB and Bluetooth, Chrome and Safari).
- Q-10 CI runner migration: target 2027-01-31.
