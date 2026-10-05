import bomberPacing from '../scenarios/bomber-pacing.mjs';

// Explicit terminal-state injection, not evidence of naturally flown sorties.
// All modules and physics remain production; only this fixture wraps SimCore.
export default async function terminalOutcomes({ load }) {
  const { SimCore } = await load('src/game/simCore.ts');
  const { getAerodrome } = await load('src/data/aerodromes.ts');
  const observations = [];
  for (const outcome of ['landed-friendly', 'disengaged', 'shot-down']) {
    class TerminalCore extends SimCore {
      fixtureSteps = 0;
      step(dt) {
        const spawned = super.step(dt);
        if (++this.fixtureSteps === 2) {
          const player = this.world.player;
          const home = getAerodrome(this.mission.homeAerodromeId);
          if (!player || !home) throw new Error('Lifecycle fixture requires player and home');
          player.state.position.set(home.x, this.world.env.groundHeightAt(home.x, home.z), home.z);
          player.state.velocity.set(0, 0, 0);
          player.state.onGround = true;
          player.outcome = outcome;
          // The real director sees the transition on the next production step.
        }
        return spawned;
      }
    }
    const fixtureLoad = async (path) => {
      const module = await load(path);
      return path === 'src/game/simCore.ts' ? { ...module, SimCore: TerminalCore } : module;
    };
    const report = await bomberPacing({ load: fixtureLoad, input: { cases: ['quick/dh4/1'] } });
    observations.push({ injectedOutcome: outcome, observation: report.cases[0] });
  }
  return observations;
}
