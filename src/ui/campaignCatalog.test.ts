import { describe, expect, it } from 'vitest';
import { ACES } from '../data/aces';
import { MEDALS } from '../data/medals';
import { RANKS } from '../data/ranks';
import { aceDisplay, medalDisplay, rankDisplay, setUiCatalog } from './catalog';
import { catalogFromCampaignData } from './campaignCatalog';

describe('catalogFromCampaignData', () => {
  setUiCatalog(catalogFromCampaignData());

  it('names every campaign rank', () => {
    for (const r of RANKS) expect(rankDisplay(r.id)).toEqual({ title: r.title, abbrev: r.abbrev });
  });

  it('names every campaign medal and keeps hand-drawn visuals where mapped', () => {
    for (const m of MEDALS) expect(medalDisplay(m.id).name).toBe(m.name);
    expect(medalDisplay('plm').shape).toBe('maltese');
    expect(medalDisplay('vc').precedence).toBe(MEDALS.find((m) => m.id === 'vc')!.precedence);
  });

  it('uses campaign ace ids with final tallies', () => {
    for (const a of ACES) expect(aceDisplay(a.id)?.nation).toBe(a.nation);
    expect(aceDisplay('mvr')?.victories).toBe(80);
    expect(aceDisplay('mvr')?.epithet).toBe('The Red Baron');
  });
});
