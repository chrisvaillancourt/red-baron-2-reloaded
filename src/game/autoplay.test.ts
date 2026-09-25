import { describe, expect, it } from 'vitest';
import { createCampaignService, memoryStorage } from '../campaign';
import { runAutoplay } from './autoplay';

// Fast regression checks on real sim+AI+director; the long survey lives in autoplay.soak.test.ts.
describe('autoplayer', () => {
  it('career missions reach contact within a few minutes and end cleanly', () => {
    const campaign = createCampaignService(memoryStorage());
    const cases = [
      ['britain', '1917-06-01'],
      ['germany', '1918-06-01'],
    ] as const;
    for (const [nation, date] of cases) {
      const p = campaign.createPilot({ firstName: 'Auto', lastName: 'Test', nation, startDate: date, difficulty: 'pilot' });
      p.rngSeed = 4242;
      let m = campaign.generateMission(p);
      for (let i = 0; i < 40 && m.type !== 'patrol'; i++) {
        p.missionsFlown++;
        m = campaign.generateMission(p);
      }
      const rep = runAutoplay(m, { maxTime: 420 });
      expect(rep.badSpawns).toEqual([]);
      expect(rep.misplaced).toEqual([]);
      expect(rep.firstContact, `${nation} ${m.type} contact`).not.toBeNull();
      expect(rep.firstContact!).toBeLessThan(330);
      expect(rep.result.missionId).toBe(m.id);
      expect(rep.result.objectives.length).toBe(m.objectives.length);
    }
  }, 60_000);

  it('a passive recruit flying straight and level survives the first minute of most missions', () => {
    const campaign = createCampaignService(memoryStorage());
    const starts = [
      ['germany', '1916-10-01'],
      ['britain', '1917-04-05'],
      ['france', '1917-08-01'],
      ['usa', '1918-07-01'],
    ] as const;
    let flown = 0;
    let survived = 0;
    for (const [nation, date] of starts) {
      const p = campaign.createPilot({ firstName: 'New', lastName: 'Boy', nation, startDate: date, difficulty: 'recruit' });
      p.rngSeed = 99;
      for (let i = 0; i < 4; i++) {
        const m = campaign.generateMission(p);
        p.missionsFlown++;
        const rep = runAutoplay(m, { maxTime: 60, passivePlayer: true });
        flown++;
        if (rep.result.playerOutcome === 'in-flight' && rep.result.playerFate !== 'killed') survived++;
      }
    }
    expect(survived / flown).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
