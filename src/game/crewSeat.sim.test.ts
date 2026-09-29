import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { MissionDefinition } from '../core/types';
import { getAIPilot } from '../ai';
import { headlessModules } from './autoplay';
import { SimCore, SIM_HZ } from './simCore';
import { bristolFight, dh4BombRun, playerMember } from './testing/crewMissions';

const realism = () => DEFAULT_SETTINGS.realism;

function run(core: SimCore, seconds: number): void {
  const h = 1 / SIM_HZ;
  for (let t = 0; t < seconds; t += h) core.step(h);
}

/** The Bristol alone on a two-leg route, no enemies: wp0 behind the start, wp1 far ahead. */
function routeMission(): MissionDefinition {
  const m = bristolFight();
  m.flights = m.flights.filter((f) => f.role !== 'enemy');
  m.objectives = [];
  const { flight } = playerMember(m);
  const s = flight.start;
  const fwd = { x: Math.sin(s.heading), z: -Math.cos(s.heading) };
  flight.waypoints = [
    { x: s.x - fwd.x * 6000, z: s.z - fwd.z * 6000, altitude: s.altitude, action: 'fly', label: 'behind' },
    { x: s.x + fwd.x * 12000, z: s.z + fwd.z * 12000, altitude: s.altitude, action: 'fly', label: 'ahead' },
  ];
  return m;
}

describe('player crew seats in the sim core', () => {
  it('starts at the mission station with an AI pilot flying, controller still player', () => {
    const core = new SimCore(headlessModules, bristolFight('observer'), realism);
    const p = core.world.player!;
    expect(core.playerStation).toBe('observer');
    expect(p.controller).toBe('player');
    expect(core.ai.has(p.id)).toBe(true);
    expect(p.stationInputs?.station).toBe('observer');
    const alt0 = p.state.altitude;
    run(core, 20);
    expect(p.outcome).toBeNull();
    expect(p.state.altitude).toBeGreaterThan(alt0 - 600);
    expect(p.controls.throttle).toBeGreaterThan(0.3);
  });

  it('hands the aircraft back at the pilot seat: no AI, no station inputs', () => {
    const core = new SimCore(headlessModules, bristolFight('observer'), realism);
    const p = core.world.player!;
    run(core, 2);
    expect(core.setPlayerStation('pilot')).toBe(true);
    expect(core.playerStation).toBe('pilot');
    expect(core.ai.has(p.id)).toBe(false);
    expect(p.stationInputs).toBeUndefined();
  });

  it('starts at the pilot seat without a station, and refuses a station the type lacks', () => {
    const core = new SimCore(headlessModules, bristolFight(), realism);
    const p = core.world.player!;
    expect(core.playerStation).toBe('pilot');
    expect(core.ai.has(p.id)).toBe(false);
    expect(core.setPlayerStation('ventral')).toBe(false);
    expect(core.playerStation).toBe('pilot');
  });

  it('leaves the autoplayer flying everything: no station inputs from the mission station', () => {
    const core = new SimCore(headlessModules, bristolFight('observer'), realism, { aiPlayer: true });
    const p = core.world.player!;
    expect(core.ai.has(p.id)).toBe(true);
    expect(p.stationInputs).toBeUndefined();
    // And going back to the pilot seat keeps the autoplayer's AI.
    core.setPlayerStation('pilot');
    expect(core.ai.has(p.id)).toBe(true);
  });

  it('the AI pilot takes up the route from the player\'s next waypoint, not the first', () => {
    const distTo = (core: SimCore, i: number) => {
      const wp = playerMember(core.mission).flight.waypoints[i];
      const pos = core.world.player!.state.position;
      return Math.hypot(wp.x - pos.x, wp.z - pos.z);
    };
    const onward = new SimCore(headlessModules, routeMission(), realism);
    onward.setPlayerStation('observer', { fromWaypoint: 1 });
    const back = new SimCore(headlessModules, routeMission(), realism);
    back.setPlayerStation('observer', { fromWaypoint: 0 });
    const d1 = distTo(onward, 1);
    const d0 = distTo(back, 0);
    run(onward, 40);
    run(back, 40);
    expect(distTo(onward, 1)).toBeLessThan(d1 - 1000); // pressed on toward the second
    expect(distTo(back, 0)).toBeLessThan(d0); // the first waypoint, behind: turned back for it
  }, 30_000);
});

describe('the AI pilot\'s lifecycle', () => {
  it('releases the AI pilot on hand-back, so no AI reads the player as AI-flown', () => {
    const core = new SimCore(headlessModules, bristolFight('observer'), realism);
    const p = core.world.player!;
    run(core, 1);
    expect(getAIPilot(p)).toBeDefined();
    core.setPlayerStation('pilot');
    expect(getAIPilot(p)).toBeUndefined();
  });

  for (const how of ['lost', 'mission over'] as const) {
    it(`clears the station and the AI pilot when the ${how === 'lost' ? 'aircraft is lost' : 'mission ends'}`, () => {
      const core = new SimCore(headlessModules, bristolFight('observer'), realism);
      const p = core.world.player!;
      run(core, 1);
      p.stationInputs!.fire = true;
      if (how === 'lost') p.outcome = 'shot-down';
      else core.director.ended = true;
      run(core, 0.1);
      expect(p.stationInputs).toBeUndefined();
      expect(core.ai.has(p.id)).toBe(false);
      expect(getAIPilot(p)).toBeUndefined();
      expect(core.playerStation).toBe('pilot');
    });
  }
});

describe('bomb run pickup', () => {
  const bombIndex = (core: SimCore) => playerMember(core.mission).flight.waypoints.findIndex((w) => w.action === 'bomb');

  it('keeps the bomb waypoint in the AI pilot\'s route when the HUD has already passed it', () => {
    const core = new SimCore(headlessModules, dh4BombRun(), realism);
    const b = bombIndex(core);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(playerMember(core.mission).flight.waypoints.length).toBeGreaterThan(b + 1);
    core.setPlayerStation('observer', { fromWaypoint: b + 1 });
    expect(core.playerPilotFrom).toBe(b);
  });

  it('flies on past the bomb waypoint once the racks are empty', () => {
    const core = new SimCore(headlessModules, dh4BombRun(), realism);
    const b = bombIndex(core);
    const p = core.world.player!;
    p.bombs = p.bombs!.map(() => 0);
    core.setPlayerStation('observer', { fromWaypoint: b + 1 });
    expect(core.playerPilotFrom).toBe(b + 1);
  });
});

describe('bomb aimer seat', () => {
  it('the D.H.4 observer is the bomb aimer', () => {
    const core = new SimCore(headlessModules, dh4BombRun('observer'), realism);
    expect(core.playerStation).toBe('observer');
    expect(core.world.player!.stationInputs!.aim.length()).toBeCloseTo(1, 6);
    expect(core.world.player!.stationInputs!.aim).toBeInstanceOf(Vector3);
  });
});
