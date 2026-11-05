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
| Visuals pass | `feat/visuals-pass` | Owner asked for a visuals pass on 2026-11-04. On the branch: post effects (D-123), cloud shadows (D-124), ground grain, exhaust haze, house facades, roof and spire winding fixes, worn aerodromes. Two review rounds (Opus + Sol) dispositioned; full e2e 54 passed; `checkcommits` passes all 18 commits. Not pushed: every push deploys, and the hardware playtest is running. Next: owner decides when to merge and deploy (merge, full gate, push, `prodcheck`). |
| — | — | Waiting on the owner's iPhone and Xbox playtest ([checklist](PLAYTEST.md#hardware-checklist-iphone-and-xbox-controller)) and the Q-07 and Q-09 decisions. |

## Next

Nothing ready; see Blocked on the owner. Open contracts: [BACKLOG](BACKLOG.md).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([BACKLOG](BACKLOG.md#q-09-damage--damage-path-default)).
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-13 controller: physical Xbox acceptance (USB and Bluetooth, Chrome and Safari).
- Q-10 CI runner migration: target 2027-01-31.
