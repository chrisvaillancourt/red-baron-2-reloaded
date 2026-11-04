# Status

Updated 2026-11-04 by the Claude Code integration session. STATUS is a plan, not proof:
confirm a claim in git or CI before relying on it. Update it in the same commit as the work
that changes Now or Next. History: [STATUS-ARCHIVE](STATUS-ARCHIVE.md).

## Live

- `origin/main` `8daef36`, deployed by [Actions run 41795159742](https://github.com/chrisvaillancourt/red-baron-2-reloaded/actions/runs/41795159742).
- Node 26.12.1 LTS is pinned for local runs (`devEngines.runtime`) and CI once
  `integrate/wave1` lands.

## Now

| Track | Branch | Next action |
|---|---|---|
| Integration | `integrate/wave1` | F-44 checkcommits, agent docs (D-116), tech-debt wave 1 (9 branches), the extending-pair collision fix (D-117) and the Node 26 pin. Full gate green; push to `main` awaits owner approval. |

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
