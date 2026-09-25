/**
 * Autoplayer soak runs (skipped unless AUTOPLAY is set):
 *   AUTOPLAY=career,quick AUTOPLAY_MISSIONS=5 AUTOPLAY_OUT=/tmp/ap.txt pnpm vitest run src/game/autoplay.soak.test.ts
 * `career` flies consecutive missions for pilots of every nation across the war,
 * applying each result (promotions, medals, fates); `quick` flies every quick-mission
 * type. Writes one line per mission plus a summary table to AUTOPLAY_OUT (or stdout).
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildQuickMission, createCampaignService, memoryStorage } from '../campaign';
import type { CareerDifficulty, QuickMissionOptions } from '../core/campaignTypes';
import type { MissionDefinition, Nation } from '../core/types';
import { runAutoplay, type AutoplayReport } from './autoplay';

const MODES = (process.env.AUTOPLAY ?? '').split(',').filter(Boolean);
const PER_PILOT = Number(process.env.AUTOPLAY_MISSIONS ?? 5);
const OUT = process.env.AUTOPLAY_OUT;
const MAX_TIME = Number(process.env.AUTOPLAY_MAXTIME ?? 2400);
/** Seeded repetitions of each quick-mission setup (quick missions are otherwise random). */
const QUICK_REPS = Number(process.env.AUTOPLAY_QUICK_REPS ?? 1);
/** Summarise quick runs per setup as well as per type (AUTOPLAY_QUICK_BY_SETUP=1). */
const QUICK_BY_SETUP = !!process.env.AUTOPLAY_QUICK_BY_SETUP;
/** Career difficulty for the career survey (recruit | pilot | ace). */
const DIFFICULTY = (process.env.AUTOPLAY_DIFFICULTY ?? 'pilot') as CareerDifficulty;
/** Offset for the career pilots' seeds, so repeated surveys sample different careers. */
const SEED_BASE = Number(process.env.AUTOPLAY_SEED_BASE ?? 0);

function log(line: string) {
  if (OUT) appendFileSync(OUT, line + '\n');
  else console.log(line);
}

interface Row {
  label: string;
  type: string;
  rep: AutoplayReport;
}

function describeRow(r: Row): string {
  const x = r.rep;
  const fc = x.firstContact === null ? '  none' : `${x.firstContact.toFixed(0).padStart(5)}s`;
  const obj = x.result.objectives.map((o) => (o.completed ? 'Y' : 'n')).join('');
  return [
    r.label.padEnd(44),
    r.type.padEnd(15),
    `init ${(x.initialEnemyRange / 1000).toFixed(1).padStart(5)}km`,
    `objR ${x.objectiveRange === null ? '   - ' : (x.objectiveRange / 1000).toFixed(1).padStart(5)}km`,
    `contact ${fc}`,
    `t ${x.time.toFixed(0).padStart(5)}s${x.timedOut ? '!' : ' '}`,
    `fate ${x.result.playerFate.padEnd(16)}`,
    `out ${String(x.result.playerOutcome).padEnd(15)}`,
    `K ${x.playerKills} claims ${x.result.claims.length}`,
    `EL ${x.enemyLosses} FL ${x.friendlyLosses}`,
    `bal ${x.balloonsDestroyed} gnd ${x.groundDestroyed}`,
    `obj ${obj}${x.result.missionSuccess ? ' OK' : ' --'}`,
    x.playerLossCause ? `LOSS ${x.playerLossCause}` : '',
    x.collisions.length ? `COLL ${x.collisions.join(';')}` : '',
    x.badSpawns.length ? `BADSPAWN ${x.badSpawns.join(';')}` : '',
    x.misplaced.length ? `MISPLACED ${x.misplaced.join(';')}` : '',
    x.acesPresent.length ? `aces ${x.acesPresent.join(',')}${x.acesDowned.length ? ` downed ${x.acesDowned.join(',')}` : ''}` : '',
  ].join(' | ');
}

function summarise(rows: Row[]): void {
  const byType = new Map<string, Row[]>();
  for (const r of rows) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
  log('\nSUMMARY type | n | contact% | median contact s | success% | kills/mission | returned% | killed% | captured% | wounded% | timeout');
  for (const [type, rs] of [...byType].sort()) {
    const n = rs.length;
    const contacts = rs.map((r) => r.rep.firstContact).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const pct = (f: (r: Row) => boolean) => `${Math.round((100 * rs.filter(f).length) / n)}%`;
    log(
      [
        type.padEnd(15),
        n,
        `${Math.round((100 * contacts.length) / n)}%`,
        contacts.length ? contacts[Math.floor(contacts.length / 2)].toFixed(0) : '-',
        pct((r) => r.rep.result.missionSuccess),
        (rs.reduce((s, r) => s + r.rep.playerKills, 0) / n).toFixed(2),
        pct((r) => r.rep.result.playerFate === 'returned' || r.rep.result.playerFate === 'landed-elsewhere'),
        pct((r) => r.rep.result.playerFate === 'killed'),
        pct((r) => r.rep.result.playerFate === 'captured'),
        pct((r) => r.rep.result.playerFate === 'wounded'),
        rs.filter((r) => r.rep.timedOut).length,
      ].join(' | '),
    );
  }
  const causes = new Map<string, number>();
  for (const r of rows) {
    // Group enemy/flak losses by source only; keep the AI phase for self-inflicted ones.
    const c = r.rep.playerLossCause?.replace(/^(enemy-fire|flak\/ground)\(.*\)$/, '$1') ?? null;
    if (c) causes.set(c, (causes.get(c) ?? 0) + 1);
  }
  log(`LOSS CAUSES (${rows.length} missions): ${[...causes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' | ') || 'none'}`);
  const coll = new Map<string, number>();
  for (const r of rows) for (const c of r.rep.collisions) {
    const k = c.split(' ').slice(0, 2).join(' ').replace(/ \d+deg$/, '') + (/ (1[3-8]\d)deg/.test(c) ? ' head-on' : '');
    coll.set(k, (coll.get(k) ?? 0) + 1);
  }
  log(`COLLISIONS (${rows.length} missions): ${[...coll].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' | ') || 'none'}`);
  const claims = rows.reduce((s, r) => s + r.rep.result.claims.length, 0);
  log(`CLAIMS per mission ${(claims / Math.max(1, rows.length)).toFixed(2)}`);
}

const CAREERS: { nation: Nation; dates: string[] }[] = [
  { nation: 'germany', dates: ['1915-08-15', '1916-10-01', '1917-04-05', '1917-11-01', '1918-04-01', '1918-09-01'] },
  { nation: 'britain', dates: ['1916-03-01', '1916-09-01', '1917-04-05', '1917-09-15', '1918-04-01', '1918-09-15'] },
  { nation: 'france', dates: ['1916-06-01', '1917-03-01', '1917-08-01', '1918-06-01'] },
  { nation: 'usa', dates: ['1916-06-01', '1918-04-01', '1918-07-01', '1918-10-01'] },
];

describe.skipIf(!MODES.includes('career'))('autoplay: careers', () => {
  it(
    'flies consecutive career missions for every nation across the war',
    () => {
      if (OUT) writeFileSync(OUT, `# autoplay career run ${new Date().toISOString()} per-pilot=${PER_PILOT}\n`);
      const campaign = createCampaignService(memoryStorage());
      const rows: Row[] = [];
      let seed = 1 + SEED_BASE;
      for (const { nation, dates } of CAREERS) {
        for (const startDate of dates) {
          const p = campaign.createPilot({ firstName: 'Auto', lastName: `Pilot${seed}`, nation, startDate, difficulty: DIFFICULTY });
          p.rngSeed = seed++ * 7777;
          for (let i = 0; i < PER_PILOT; i++) {
            if (p.status !== 'active' && p.status !== 'hospital') break;
            if (p.status === 'hospital') campaign.returnToDuty?.(p);
            const aircraft = campaign.availableAircraft(p)[0];
            const m = campaign.generateMission(p, aircraft);
            const rep = runAutoplay(m, { maxTime: MAX_TIME });
            const row: Row = { label: `${nation} ${m.date} ${p.squadronId} ${m.flights[0].aircraftId}`, type: m.type, rep };
            rows.push(row);
            log(describeRow(row));
            const d = campaign.applyMissionResult(p, m, rep.result);
            const notes = [
              d.promotion ? `PROMOTED ${d.promotion.toRankId}` : '',
              d.medals.length ? `MEDALS ${d.medals.map((x) => x.medalId).join(',')}` : '',
              `confirmed ${d.claims.filter((c) => c.confirmed).length}/${d.claims.length}`,
              `victories ${p.victories.filter((v) => v.confirmed).length}`,
              `status ${p.status}`,
            ].filter(Boolean);
            log(`    debrief: ${notes.join(' | ')}`);
            expect(rep.badSpawns).toEqual([]);
          }
        }
      }
      summarise(rows);
    },
    6 * 60 * 60 * 1000,
  );
});

/** Comma-separated label substrings selecting quick setups (default: all). */
const QUICK_SETUPS = (process.env.AUTOPLAY_QUICK_SETUPS ?? '').split(',').filter(Boolean);
/** Comma-separated quick types (default: all). */
const QUICK_TYPES = (process.env.AUTOPLAY_QUICK_TYPES ?? '').split(',').filter(Boolean);
const QUICK: (QuickMissionOptions & { label: string })[] = [];
for (const type of ['dogfight', 'balloon-attack', 'escort', 'intercept', 'ground-attack'] as const) {
  QUICK.push(
    // The Quick Mission screen's defaults (src/ui/screens/quick.ts): an even fight at standard skill.
    { label: `default camel v dv ${type}`, type, playerAircraft: 'sopwith_camel', enemyAircraft: 'albatros_dv', enemyCount: 2, wingmen: 1, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.35 },
    { label: `camel v dr1 ${type}`, type, playerAircraft: 'sopwith_camel', enemyAircraft: 'fokker_dri', enemyCount: 3, wingmen: 2, enemySkill: 'regular', wingmanSkill: 'regular', altitudeM: 2000, startPosition: 'random', timeOfDay: 'midday', cloudCover: 0.3 },
    { label: `dvii v spad ${type}`, type, playerAircraft: 'fokker_dvii', enemyAircraft: 'spad_xiii', enemyCount: 2, wingmen: 1, enemySkill: 'veteran', wingmanSkill: 'regular', altitudeM: 2500, startPosition: 'head-on', timeOfDay: 'afternoon', cloudCover: 0.5 },
  );
}

describe.skipIf(!MODES.includes('quick'))('autoplay: quick missions', () => {
  it(
    'flies every quick-mission type',
    () => {
      if (OUT) writeFileSync(OUT, `# autoplay quick run ${new Date().toISOString()} reps=${QUICK_REPS}\n`);
      const rows: Row[] = [];
      const setups = QUICK.filter((q) => (!QUICK_SETUPS.length || QUICK_SETUPS.some((s) => q.label.includes(s))) && (!QUICK_TYPES.length || QUICK_TYPES.includes(q.type)));
      for (let rep = 0; rep < QUICK_REPS; rep++) {
        for (const q of setups) {
          const m: MissionDefinition = buildQuickMission(q, 1000 + rep * 97 + QUICK.indexOf(q));
          const r = runAutoplay(m, { maxTime: MAX_TIME });
          const row: Row = { label: `quick ${q.label} #${rep}`, type: `q-${q.type}${QUICK_BY_SETUP ? `-${q.label.split(' ')[0]}` : ''}`, rep: r };
          rows.push(row);
          log(describeRow(row));
          expect(r.badSpawns).toEqual([]);
        }
      }
      summarise(rows);
    },
    60 * 60 * 1000,
  );
});
