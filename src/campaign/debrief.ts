/**
 * Mission debrief: turns a MissionResult into career consequences - claim
 * confirmation, victories, fame, promotion, medals, wounds, capture, death,
 * date advance, transfers - and a period-voice narrative.
 */
import type { CareerPilot, ConfirmedVictory, DebriefReport, MedalAward } from '../core/campaignTypes';
import type { AircraftId, MissionDefinition, MissionResult, PilotFate, VictoryClaim } from '../core/types';
import { NATION_SIDE } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { ACES, aceNamesOn, getAce } from '../data/aces';
import { getMedal } from '../data/medals';
import { getRank } from '../data/ranks';
import { getSquadronInfo } from '../data/squadrons';
import { composeLivery } from '../data/liveries';
import { sideOfFrontAt } from '../world/frontline';
import { confirmedVictories, checkMedals, checkPromotion } from './awards';
import { ARMISTICE, addDays, formatLongDate } from './dates';
import { describeLocation } from './placement';
import { Rng, seedFrom } from './rng';
import { squadronActiveOn, squadronBaseOn, successorSquadron } from './squadronUtil';
import { daysUntilNextSortie } from './weather';

const BASE_CONFIRM: Record<CareerPilot['difficulty'], number> = { recruit: 0.85, pilot: 0.7, ace: 0.55 };

const NEWSPAPER: Record<CareerPilot['nation'], string> = {
  germany: 'Berliner Tageblatt',
  britain: 'The Daily Mail',
  france: 'Le Petit Journal',
  usa: 'The Stars and Stripes',
};

function isAerialClaim(c: VictoryClaim): boolean {
  return c.victimAircraftId === 'balloon' || c.victimAircraftId in AIRCRAFT;
}

function victimLabel(c: VictoryClaim): string {
  if (c.victimAircraftId === 'balloon') return 'Observation balloon';
  return AIRCRAFT[c.victimAircraftId as AircraftId]?.name ?? c.victimName;
}

export function confirmationChance(p: CareerPilot, c: VictoryClaim, date: string): number {
  let pr = BASE_CONFIRM[p.difficulty];
  if (c.witnessed) pr += 0.15;
  // Wreckage on our side of the lines can be inspected; the Germans demanded it.
  if (sideOfFrontAt(c.x, c.z, date) === p.side) pr += 0.2;
  else if (p.nation === 'germany') pr -= 0.1;
  if (c.victimAircraftId === 'balloon') pr += 0.1; // a flaming balloon is seen for miles
  if (c.shared) pr -= 0.05;
  return Math.max(0.05, Math.min(0.98, pr));
}

function fameFor(c: VictoryClaim): number {
  return c.victimAceId ? 6 : c.victimAircraftId === 'balloon' ? 3 : 2;
}

function woundDays(rng: Rng): number {
  return rng.weighted([
    [rng.int(5, 12), 5],
    [rng.int(14, 35), 3],
    [rng.int(40, 90), 1],
  ] as const);
}

export function applyResult(p: CareerPilot, mission: MissionDefinition, result: MissionResult): DebriefReport {
  const rng = new Rng(seedFrom(p.rngSeed, p.missionsFlown, p.date, 'debrief'));
  const missionDate = mission.date;
  const squadron = getSquadronInfo(p.squadronId);
  const rankBefore = getRank(p.rankId);
  const narrative: string[] = [];
  let headline: string | undefined;
  const lang = p.nation === 'germany' ? 'de' : p.nation === 'france' ? 'fr' : 'en';

  // ------------------------------------------------------------ fate
  let fate: PilotFate = result.playerFate;
  // Coming down alive in enemy territory means a prison camp.
  if (result.playerOutcome === 'landed-enemy' && fate !== 'killed') fate = 'captured';

  // ------------------------------------------------------------ claims
  const aerial = result.claims.filter(isAerialClaim);
  const claims = aerial.map((c) => ({ ...c, confirmed: rng.chance(confirmationChance(p, c, missionDate)) }));
  const priorVictories = confirmedVictories(p);
  let fame = 0;
  for (const c of claims) {
    if (c.confirmed) {
      const v: ConfirmedVictory = {
        number: confirmedVictories(p) + 1,
        date: missionDate,
        victim: victimLabel(c),
        location: describeLocation(c),
        confirmed: true,
      };
      if (c.victimAceId) v.victimAceId = c.victimAceId;
      p.victories.push(v);
      fame += fameFor(c);
      if (c.victimAceId) {
        const ace = getAce(c.victimAceId);
        const captured = sideOfFrontAt(c.x, c.z, missionDate) === p.side && rng.chance(0.35);
        p.alteredAces = { ...(p.alteredAces ?? {}), [c.victimAceId]: { fate: captured ? 'captured' : 'killed', date: missionDate } };
        if (ace) {
          narrative.push(captured ? `Your victim came down alive on our side of the lines. He was ${aceNamesOn(ace, missionDate).display} - and he is now a prisoner of war.` : `Word came through tonight from across the lines: the pilot you brought down was ${aceNamesOn(ace, missionDate).display}. He did not survive.`);
          headline = `${ace.nickname ? ace.nickname.toUpperCase() : ace.lastName.toUpperCase()} ${captured ? 'TAKEN PRISONER' : 'FALLS'} - ${p.lastName.toUpperCase()} VICTORIOUS`;
        }
      }
    } else {
      p.unconfirmedClaims += 1;
    }
  }
  // Friendly aces lost in our flight change history too.
  for (const loss of result.friendlyLosses) {
    if (loss.aceId && (loss.fate === 'killed' || loss.fate === 'captured')) {
      p.alteredAces = { ...(p.alteredAces ?? {}), [loss.aceId]: { fate: loss.fate, date: missionDate } };
      const ace = getAce(loss.aceId);
      if (ace) narrative.push(`${aceNamesOn(ace, missionDate).display} failed to return from the patrol. The whole squadron feels his loss.`);
    }
  }
  // Any other ace brought down in the fight (by a wingman, a gunner, flak) is out of the war too.
  for (const down of result.acesDown ?? []) {
    if ((down.fate !== 'killed' && down.fate !== 'captured') || p.alteredAces?.[down.aceId]) continue;
    p.alteredAces = { ...(p.alteredAces ?? {}), [down.aceId]: { fate: down.fate, date: missionDate } };
    const ace = getAce(down.aceId);
    if (!ace) continue;
    narrative.push(
      down.side === p.side
        ? `${aceNamesOn(ace, missionDate).display} was lost in the fighting today.`
        : down.fate === 'captured'
          ? `${aceNamesOn(ace, missionDate).display} came down on our side of the lines today and is now a prisoner.`
          : `The squadron is saying that ${aceNamesOn(ace, missionDate).display} fell in today's fight.`,
    );
  }

  const confirmedNow = claims.filter((c) => c.confirmed).length;
  const total = confirmedVictories(p);
  if (claims.length) {
    const unconf = claims.length - confirmedNow;
    narrative.push(
      confirmedNow
        ? `${
            claims.length === 1
              ? 'Your claim has been confirmed'
              : confirmedNow === claims.length
                ? `All ${claims.length} of your claims have been confirmed`
                : `${confirmedNow} of your ${claims.length} claims ${confirmedNow === 1 ? 'has' : 'have'} been confirmed; ${unconf === 1 ? 'the other' : 'the rest'} could not be verified`
          }. That brings your tally to ${total}.`
        : claims.length === 1
          ? 'Your claim could not be confirmed - no witnesses, and no wreckage found.'
          : `None of your ${claims.length} claims could be confirmed - no witnesses, and no wreckage found.`,
    );
  }
  for (const milestone of [5, 10, 20, 30, 40, 50, 60, 70, 80]) {
    if (priorVictories < milestone && total >= milestone && !headline) {
      headline = milestone === 5 ? `NEW ACE: ${rankBefore?.abbrev ?? ''} ${p.lastName.toUpperCase()} SCORES FIFTH VICTORY` : `${p.lastName.toUpperCase()} DOWNS HIS ${milestone}TH ENEMY`;
    }
  }

  // ------------------------------------------------------------ mission outcome & CO remarks
  if (fate !== 'killed' && fate !== 'captured') {
    narrative.unshift(
      result.aborted
        ? rng.pick(['You broke off and came home before the job was done. The CO wants a written explanation.', 'The patrol was abandoned. There will be questions from Wing.'])
        : result.missionSuccess
        ? rng.pick(['The CO was pleased with the day\'s work.', 'A good show, the CO said - the mission was carried out as ordered.', 'Headquarters has signalled its satisfaction with the patrol.'])
        : rng.pick(['The mission was not accomplished. The CO said little, which was worse than a dressing-down.', 'The objective was not achieved; we shall have to go again.', 'A bad day. The squadron failed in its task.']),
    );
  }
  if (result.missionSuccess) fame += 1;
  for (const loss of result.friendlyLosses.filter((l) => !l.aceId)) {
    if (loss.fate === 'killed') narrative.push(`${loss.name} was killed. We drank to him in the mess tonight.`);
    else if (loss.fate === 'captured') narrative.push(`${loss.name} was seen to land behind the enemy lines - a prisoner, we hope.`);
    else if (loss.fate === 'wounded') narrative.push(`${loss.name} came back wounded and has gone to hospital.`);
  }

  p.missionsFlown += 1;
  let careerEnded = false;
  let days = daysUntilNextSortie(missionDate, rng);
  let woundedNow = false;

  switch (fate) {
    case 'killed':
      p.status = 'killed';
      careerEnded = true;
      narrative.push(`${rankBefore?.title ?? ''} ${p.firstName} ${p.lastName} was killed in action on ${formatLongDate(missionDate, lang)}${squadron ? `, flying with ${squadron.name}` : ''}. ${total ? `He had ${total} confirmed victor${total === 1 ? 'y' : 'ies'}.` : ''}`.trim());
      if (p.fame >= 30) headline = `${p.lastName.toUpperCase()} KILLED IN ACTION`;
      break;
    case 'captured':
      p.status = 'captured';
      careerEnded = true;
      narrative.push(`Forced down behind the enemy lines, ${p.firstName} ${p.lastName} was taken prisoner. For him, the war is over.`);
      if (p.fame >= 30) headline = `${p.lastName.toUpperCase()} MISSING - BELIEVED PRISONER`;
      break;
    case 'wounded': {
      woundedNow = true;
      const wounds = p.log.filter((l) => l.outcome === 'wounded').length + 1;
      const hd = woundDays(rng);
      if (wounds >= 4 && hd > 30) {
        p.status = 'retired';
        careerEnded = true;
        narrative.push('The doctors have spoken: your wounds will not allow you to fly again. You are invalided out of the service.');
      } else {
        p.status = 'hospital';
        p.hospitalDays = hd;
        days += hd;
        narrative.push(hd < 14 ? `A flesh wound - ${hd} days in hospital, then back to the squadron.` : `You were badly hurt and spend ${hd} days in hospital before returning to duty.`);
      }
      fame += 1;
      break;
    }
    case 'landed-elsewhere':
      narrative.push('You put down at another aerodrome and were returned to the squadron by tender the next morning.');
      break;
    default:
      break;
  }

  p.fame = Math.max(0, Math.min(100, p.fame + fame));

  // ------------------------------------------------------------ promotion & medals (living pilots)
  let promotion = null;
  let medals: MedalAward[] = [];
  if (p.status !== 'killed' && p.status !== 'captured') {
    promotion = checkPromotion(p);
    if (promotion) {
      p.rankId = promotion.toRankId;
      const r = getRank(promotion.toRankId);
      narrative.push(`You have been promoted to the rank of ${r?.title}.`);
    }
    medals = checkMedals(p, missionDate, woundedNow);
    for (const m of medals) {
      p.medals.push(m);
      p.fame = Math.min(100, p.fame + 3);
      const def = getMedal(m.medalId);
      narrative.push(`You have been awarded the ${def?.name}. ${m.citation}`);
      if (def && def.precedence >= 60) headline = `${def.name.toUpperCase()} FOR ${p.lastName.toUpperCase()}`;
    }
    // Personal colours: German pilots painted their machines freely; Allied aces less often.
    const threshold = p.nation === 'germany' ? 5 : 10;
    if (!p.personalLivery && total >= threshold) {
      p.personalLivery = personalLivery(p, rng);
      narrative.push(p.nation === 'germany' ? 'The Staffelführer has given you leave to paint your machine in your own colours.' : 'The CO turns a blind eye to the new paint on your machine\'s nose.');
    }
  }

  // ------------------------------------------------------------ date advance, history, transfers
  const oldDate = p.date;
  let newDate = addDays(missionDate, days);
  if (newDate > ARMISTICE) newDate = ARMISTICE;
  p.date = newDate;

  for (const ace of ACES) {
    const d = ace.fate.date;
    if (!d || d <= oldDate || d > newDate || (ace.fate.kind !== 'killed' && ace.fate.kind !== 'captured')) continue;
    if (p.alteredAces?.[ace.id]) continue;
    const same = NATION_SIDE[ace.nation] === p.side;
    if (narrative.filter((n) => n.startsWith('News')).length >= 2) break;
    narrative.push(`News ${same ? 'reached the mess' : 'came from across the lines'}: ${aceNamesOn(ace, missionDate).display} has been ${ace.fate.kind === 'killed' ? 'killed' : 'taken prisoner'}. ${ace.fate.note}`);
  }

  let transferToSquadronId: string | undefined;
  if (!careerEnded && newDate >= ARMISTICE) {
    p.status = 'war-over';
    careerEnded = true;
    narrative.push('At eleven o\'clock on the morning of 11 November 1918, the guns fell silent. The war is over - and you have survived it.');
    headline = headline ?? 'ARMISTICE SIGNED - THE WAR IS OVER';
  } else if (!careerEnded && squadron) {
    if (!squadronActiveOn(squadron, newDate)) {
      const succ = successorSquadron(squadron, newDate);
      if (succ) {
        transferToSquadronId = succ.id;
        p.squadronId = succ.id;
        narrative.push(`${squadron.shortName} has been disbanded. You are posted to ${succ.name} at ${squadronBaseOn(succ, newDate).name}.`);
      }
    } else {
      const before = squadronBaseOn(squadron, missionDate);
      const after = squadronBaseOn(squadron, newDate);
      if (before.id !== after.id) narrative.push(`The squadron has moved to a new aerodrome at ${after.name}.`);
    }
  }

  if (headline) narrative.push(`${NEWSPAPER[p.nation]}: "${headline}"`);

  p.log.push({
    date: missionDate,
    missionType: mission.type,
    missionTitle: mission.title,
    aircraftId: mission.flights.find((f) => f.role === 'player-flight')?.aircraftId ?? p.preferredAircraft ?? 'sopwith_camel',
    outcome: fate,
    claims: claims.length,
    confirmed: confirmedNow,
    notes: [result.missionSuccess ? 'Mission successful.' : 'Mission failed.', result.friendlyLosses.length ? `${result.friendlyLosses.length} squadron loss${result.friendlyLosses.length > 1 ? 'es' : ''}.` : ''].filter(Boolean).join(' '),
  });
  p.updatedAt = new Date().toISOString();

  return {
    missionTitle: mission.title,
    pilotFate: fate,
    missionSuccess: result.missionSuccess,
    claims,
    promotion,
    medals,
    narrative,
    newspaperHeadline: headline,
    daysElapsed: days,
    transferToSquadronId,
    careerEnded,
  };
}

function personalLivery(p: CareerPilot, rng: Rng): NonNullable<CareerPilot['personalLivery']> {
  const palette = ['#b01e1e', '#e3bf1c', '#1f3a8a', '#2e7d32', '#f2f2f2', '#161616', '#8a3fa0', '#e07b1a'];
  const c = rng.pick(palette);
  const aircraftId = p.preferredAircraft ?? p.log[p.log.length - 1]?.aircraftId ?? 'albatros_dv';
  const base = composeLivery({ aircraftId, nation: p.nation, date: p.date, squadronId: p.squadronId });
  // Only fuselage/tail/cowling/accent/marking are treated as personal (see missionGen personalOverrides).
  return p.nation === 'germany'
    ? { ...base, fuselage: c, tail: rng.chance(0.5) ? c : base.tail, marking: p.lastName[0] }
    : { ...base, cowling: c, accent: c, marking: p.lastName[0] };
}
