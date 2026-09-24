/**
 * Builds the UI display catalog from the campaign's authoritative data
 * (src/data/ranks.ts, medals.ts, aces.ts). Names, precedence and ids come
 * from the campaign; the UI adds drawing details (medal shape, metal,
 * enamel, detailed ribbons) by mapping campaign medal ids onto its own
 * hand-drawn visuals where one exists.
 */
import { ACES, aceVictoriesOn } from '../data/aces';
import { AIRCRAFT } from '../data/aircraft';
import { MEDALS } from '../data/medals';
import { RANKS } from '../data/ranks';
import { getUiCatalog, type AceDisplay, type MedalDisplay, type RankDisplay, type UiCatalog } from './catalog';

/** Campaign medal id -> UI default visual key (src/ui/catalog.ts DEFAULT_MEDALS). */
const MEDAL_VISUALS: Record<string, string> = {
  ek2: 'iron-cross-2',
  ek1: 'iron-cross-1',
  hohenzollern: 'hohenzollern',
  plm: 'pour-le-merite',
  mc: 'military-cross',
  dfc: 'dfc',
  dso: 'dso',
  vc: 'victoria-cross',
  cdg: 'croix-de-guerre',
  'cdg-foreign': 'croix-de-guerre',
  'medaille-militaire': 'medaille-militaire',
  'legion-chevalier': 'legion-honneur',
  'legion-officier': 'legion-honneur',
  dsc: 'dsc-us',
  moh: 'medal-of-honor',
};

const WAR_END = '1918-11-11';

export function catalogFromCampaignData(): UiCatalog {
  const base = getUiCatalog();
  const ranks: Record<string, RankDisplay> = {};
  for (const r of RANKS) ranks[r.id] = { title: r.title, abbrev: r.abbrev };

  const medals: Record<string, MedalDisplay> = {};
  for (const m of MEDALS) {
    const visual = base.medals[MEDAL_VISUALS[m.id] ?? ''];
    medals[m.id] = {
      name: m.name,
      nation: m.awardedBy,
      ribbon: visual?.ribbon ?? m.ribbon.map((c) => [c, 1] as [string, number]),
      shape: visual?.shape ?? (m.id.includes('badge') ? 'disc' : 'cross'),
      metal: visual?.metal ?? '#b89a60',
      enamel: visual?.enamel,
      precedence: m.precedence,
      description: m.description,
    };
  }

  const aces: AceDisplay[] = ACES.map((a) => {
    const last = a.service[a.service.length - 1];
    const aircraftId = last?.aircraft[last.aircraft.length - 1];
    return {
      id: a.id,
      name: `${a.firstName} ${a.lastName}`,
      nation: a.nation,
      victories: aceVictoriesOn(a, WAR_END),
      epithet: a.nickname,
      aircraft: aircraftId ? AIRCRAFT[aircraftId]?.name : undefined,
    };
  }).sort((x, y) => y.victories - x.victories);

  return { ranks, medals, aces };
}
