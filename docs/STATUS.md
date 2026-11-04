# Status

Updated 2026-11-04 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- `origin/main` `8daef36`, deployed by [Actions run 41795159742](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/41795159742).
- CI runs Node 22; Node 24/26 fail one realsim test on main (Now, track 1).

## Now

| Track | Branch | Next action |
|---|---|---|
| Node LTS | `fix/node-lts-collision` | One-ulp `Math.pow` drift (V8 13+) exposed two extending AIs both crossing into each other. Fix reviewed (Opus clean); finish Sol review and Node 26 A/B, add the two-aircraft unit test, then pin Node 26 LTS in `devEngines.runtime` and CI. |
| Tech-debt wave 1 | `test/*`, `refactor/*`, `fix/tools-*` | Equivalence probes, missing tests and small type fixes from the 2026-11-04 audit; each branch reviewed, then integrated serially with `checkcommits`. |
| F-44 | `feat/checkcommits` | Rewrite committed; round-two review, then integrate. |

## Next

1. Tech-debt wave 2, proved with the wave-1 probes: sim bullet/ground hit tables
   (sim-1/2), world `SegmentIndex` grid (W1), typed screen params (ui-2), `flightSession`
   split (game-7), campaign duplicate rules.
2. Q-13 controller session/prompts: retained omp worktrees `rb2r-workflowz-controller-*`;
   prompts have three open review defects (Flying School grid, action-card entry text,
   L3 manual binding). Not publishable until session binding and UI proof land.
3. Q-06 flight-mate mutual support (`rb2r-workflowz-mutual-support`, uncommitted): 17/19
   real-sim cases pass; two fail (attack timing, attack-my-target spacing).
4. F-75 `prefix-check` on `tools/dev/scratch-worktree.mjs`; worktree inventory tool.
5. BACKLOG as contracts only (one Goal/Acceptance/Non-goals section per open item).

## Blocked on the owner

- Q-07 pursuer calibration: needs rated human dogfight reports.
- Q-09 damage/career/raid policy decisions ([DEFERRED-TODOS](DEFERRED-TODOS.md#blocked-task-contracts)).
- Q-11 license choice.
- Q-12 touch: physical iPhone/Safari acceptance.
- Q-10 CI runner migration: target 2027-01-31.
