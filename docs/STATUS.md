# Status

Updated 2026-11-05 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- `27ec8a2` deployed by [Actions run 42077273793](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/42077273793);
  live `prodcheck` OK (2026-11-05). Adds the visuals pass: post effects (D-123), cloud shadows
  (D-124), ground grain, engine exhaust haze, house facades, inside-out roofs and spires fixed,
  worn aerodromes. Evidence is in the merge commit's message. Previous: `dcb3961` (DOM unit
  tests in Vitest browser mode, D-120, and earlier work).

## Now

| Track | Branch | Next action |
|---|---|---|
| — | — | Nothing in flight. Waiting on the owner's iPhone and Xbox playtest, which now includes a graphics check of the visuals pass ([checklist](PLAYTEST.md#hardware-checklist-iphone-and-xbox-controller)) and the Q-07 and Q-09 decisions. |

## Next

Nothing ready; see Blocked on the owner. Open contracts: [BACKLOG](BACKLOG.md). Visual
follow-ups from the visuals pass are parked as H-32 to H-34 in
[DEFERRED-TODOS](DEFERRED-TODOS.md#historical-conditional-ideas-preserve-individually-do-not-redispatch).
The merged worktree `../rb2r-visuals` (branch `feat/visuals-pass`) can be removed once
`tools/dev/worktrees.mjs` lists it as safe (H-25).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([BACKLOG](BACKLOG.md#q-09-damage--damage-path-default)).
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-13 controller: physical Xbox acceptance (USB and Bluetooth, Chrome and Safari).
- Q-10 CI runner migration: target 2027-01-31.
