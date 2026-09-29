# Flight reports from human playtests

Each file here is one human flight that something in the repo cites: a DECISIONS entry, a
test, or a STATUS item (D-084). Schema: `src/core/flightReport.ts`; background:
docs/PLAYTEST.md "Human playtests". `../example-report.json` shows the format.

- **New flights don't land here.** Under `pnpm dev` the debrief saves every flight to
  `playtests/inbox/`, which is git-ignored. It saves on arrival at the combat report, and
  again after a rating or note.
- **Promote a report** when a change relies on it: move it from the inbox to this folder
  and commit it with that change, e.g. `test(ai): … (playtests/reports/<file>)`.
- **On the live build,** press **Copy flight report** and paste it into the chat, or save
  it in the inbox by hand.

## Saving a report by hand (live build)

1. After a flight, on the combat report page, pick **Too easy / Fair / Too hard** if you
   have a view, and type a short note: what happened and what felt wrong.
2. Press **Copy flight report**. If the clipboard refuses, the report opens in a box:
   select it all and copy.
3. Save the text in `playtests/inbox/` as `YYYY-MM-DD-<who>-<what>.json`, for example
   `2026-10-02-chris-default-dogfight.json`. Keep it as copied, and don't edit the JSON: the
   replay reads it as it is.

## Using a report

```sh
# The autoplayer flies the same mission 8 times: a summary row like the fairness soak's.
node tools/playtest/replay-report.mjs playtests/reports/<file>.json [--reps N]

# The same mission in the real app, with screenshots at the first merge (needs `pnpm dev`).
node tools/playtest/replay-report.mjs playtests/reports/<file>.json --browser --port 5173
```

The report holds the whole mission, so a career flight replays as well as a quick one. The
autoplayer is a veteran pilot, not you: compare its numbers with the reported outcome, and
turn a fight that felt wrong into a seeded scene or a regression test.

The report holds the pilot's name (career) and the mission's generated names. Nothing else
personal is in it.
