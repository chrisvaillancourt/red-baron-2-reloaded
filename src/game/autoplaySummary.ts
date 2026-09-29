/**
 * One summary row over several autoplayer runs of a setup: the fairness soak's line
 * (src/ai/fairness.soak.test.ts), also printed by the flight-report replay.
 */
import type { AutoplayReport } from './autoplay';

export const FAIRNESS_HEADER =
  'setup | n | win% | player down% (killed/captured/wounded) | player-side share of losses | wingmen / enemies lost | kills/mission | player loss causes | structural failures (all aircraft)';

export function fairnessLine(label: string, runs: readonly AutoplayReport[]): string {
  const n = runs.length;
  let win = 0;
  let down = 0;
  let killed = 0;
  let captured = 0;
  let wounded = 0;
  let ours = 0;
  let wingLost = 0;
  let theirs = 0;
  let kills = 0;
  let structural = 0;
  const causes = new Map<string, number>();
  for (const rep of runs) {
    const fate = rep.result.playerFate;
    if (rep.result.missionSuccess) win++;
    if (fate === 'killed' || fate === 'captured' || fate === 'wounded') down++;
    if (fate === 'killed') killed++;
    if (fate === 'captured') captured++;
    if (fate === 'wounded') wounded++;
    // friendlyLosses lists the player's flight-mates; add the player when they went down.
    const o = rep.result.playerOutcome;
    ours += rep.friendlyLosses + (o !== 'in-flight' && o !== 'landed-friendly' && o !== 'disengaged' ? 1 : 0);
    theirs += rep.enemyLosses;
    wingLost += rep.friendlyLosses;
    kills += rep.playerKills;
    const c = rep.playerLossCause?.replace(/\(.*\)$/, '') ?? null;
    if (c) causes.set(c, (causes.get(c) ?? 0) + 1);
    structural += rep.events['structural-failure'] ?? 0;
  }
  const pct = (x: number) => `${Math.round((100 * x) / n)}%`;
  return [
    label.padEnd(30),
    n,
    pct(win),
    `${pct(down)} (${killed}/${captured}/${wounded})`,
    ours + theirs ? (ours / (ours + theirs)).toFixed(2) : '-',
    `wingmen lost ${wingLost} enemy lost ${theirs}`,
    (kills / n).toFixed(2),
    `causes ${[...causes].map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
    `structural ${structural}`,
  ].join(' | ');
}
