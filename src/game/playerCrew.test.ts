import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_BINDINGS, DEFAULT_SETTINGS } from '../core/settings';
import type { AircraftEntity } from '../core/types';
import { getAircraft } from '../data/aircraft';
import { headlessModules } from './autoplay';
import { CameraRig } from './cameras';
import type { InputFrame } from './input';
import { PlayerCrew } from './playerCrew';
import { SimCore, SIM_HZ } from './simCore';
import { bristolFight, dh4BombRun } from './testing/crewMissions';
import { loadBombs } from '../sim';

const realism = () => DEFAULT_SETTINGS.realism;

function frame(o: Partial<InputFrame> = {}): InputFrame {
  return {
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, blip: false, fireGuns: false, clearJam: false },
    commands: [],
    snapLook: null,
    lookDelta: { yaw: 0, pitch: 0 },
    aimDirection: null,
    manualOverride: false,
    ...o,
  };
}

function setup(mission = bristolFight()) {
  const core = new SimCore(headlessModules, mission, realism);
  const rig = new CameraRig(70, 16 / 9);
  const messages: string[] = [];
  const synced: AircraftEntity[] = [];
  const input = { stationMode: false, syncTo: (ac: AircraftEntity) => synced.push(ac) };
  const crew = new PlayerCrew({ core, rig, input, message: (t) => messages.push(t), bindings: () => DEFAULT_KEY_BINDINGS, visual: () => undefined });
  return { core, rig, input, crew, messages, synced, player: core.world.player! };
}

function step(core: SimCore, crew: PlayerCrew, n = 1) {
  for (let i = 0; i < n; i++) {
    crew.beforeStep(i === 0);
    core.step(1 / SIM_HZ);
  }
}

describe('PlayerCrew seat switching', () => {
  it('C takes the observer seat: gunner view, gun input, AI pilot; F gives the controls back', () => {
    const t = setup();
    expect(t.crew.command('stationNext', 0)).toBe(true);
    expect(t.core.playerStation).toBe('observer');
    expect(t.rig.mode).toBe('gunner');
    expect(t.input.stationMode).toBe(true);
    expect(t.rig.station).not.toBeNull();
    expect(t.messages.at(-1)).toMatch(/Observer/);
    t.crew.command('stationPilot', 0);
    expect(t.core.playerStation).toBe('pilot');
    expect(t.rig.mode).toBe('cockpit');
    expect(t.input.stationMode).toBe(false);
    expect(t.rig.station).toBeNull();
    expect(t.synced).toEqual([t.player]); // the input takes over where the AI left the controls
  });

  it('keeps an external view when the seat changes', () => {
    const t = setup();
    t.rig.setMode('chase');
    t.crew.command('stationNext', 0);
    expect(t.rig.mode).toBe('chase');
    t.crew.command('viewCockpit', 0);
    expect(t.rig.mode).toBe('gunner'); // F1 at a gun is the gunner's view
  });

  it('starts in the gunner view when the mission puts the player at the gun', () => {
    const t = setup(bristolFight('observer'));
    t.crew.start();
    expect(t.rig.mode).toBe('gunner');
    expect(t.input.stationMode).toBe(true);
  });

  it('writes the aim and buttons into the station inputs: jam a one-step edge, release held', () => {
    const t = setup(dh4BombRun('observer'));
    t.crew.start();
    const before = t.crew.aim!.azimuthDeg;
    const held = { pitch: 0, roll: 0, yaw: 0, throttle: 0, blip: false, fireGuns: true, clearJam: true, releaseBomb: true };
    t.crew.applyInput(frame({ stationAim: { azimuth: 0.1, elevation: 0 }, controls: held, commands: [] }));
    expect(t.crew.aim!.azimuthDeg).not.toBeCloseTo(before, 3);
    t.crew.beforeStep(true);
    const si = t.player.stationInputs!;
    expect(si).toMatchObject({ station: 'observer', fire: true, clearJam: true, releaseBomb: true });
    const want = t.crew.aim!.body(new Vector3()).applyQuaternion(t.player.state.orientation);
    expect(si.aim.angleTo(want)).toBeLessThan(1e-6);
    t.core.step(1 / SIM_HZ);
    t.crew.beforeStep(false);
    expect(si.clearJam).toBe(false); // an edge: one step
    expect(si.releaseBomb).toBe(true); // held: the sim drops one bomb per rising edge
    expect(si.fire).toBe(true);
    // Key up: the release goes false.
    t.crew.applyInput(frame({ controls: { ...held, clearJam: false, releaseBomb: false } }));
    t.crew.beforeStep(true);
    expect(si.releaseBomb).toBe(false);
  });

  it('does not touch the flight controls while the AI flies', () => {
    const t = setup(bristolFight('observer'));
    t.crew.start();
    step(t.core, t.crew, 20);
    const c = { ...t.player.controls };
    t.crew.beforeStep(true);
    expect(t.player.controls).toEqual(c);
  });
});

describe('PlayerCrew bombs', () => {
  it('F6 on a D.H.4 takes the observer to the bombsight, and again back to his gun', () => {
    const t = setup(dh4BombRun());
    t.crew.command('viewBombsight', 0);
    expect(t.core.playerStation).toBe('observer');
    expect(t.rig.mode).toBe('bombsight');
    t.crew.command('viewBombsight', 0);
    expect(t.rig.mode).toBe('gunner');
  });

  it('R in the D.H.4 pilot seat says the observer aims, and releases nothing', () => {
    const t = setup(dh4BombRun());
    t.player.controls.releaseBomb = true; // as the session copies a held R into the controls
    t.crew.applyInput(frame({ controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, blip: false, fireGuns: false, clearJam: false, releaseBomb: true } }));
    t.crew.command('releaseBomb', 0);
    t.crew.beforeStep(true);
    expect(t.player.controls.releaseBomb).toBe(false);
    expect(t.messages.at(-1)).toMatch(/observer/i);
  });

  it('a pilot-aimed type releases through the controls while R is held', () => {
    const t = setup(bristolFight());
    // A single-seater with a bomb rack: the pilot aims (crewStations derives it).
    t.player.spec = { ...getAircraft('sopwith_camel'), bombs: [{ name: '20 lb Cooper', massKg: 9, explosiveKg: 2, count: 4 }] };
    loadBombs(t.player);
    t.crew.command('viewBombsight', 0);
    expect(t.core.playerStation).toBe('pilot');
    expect(t.rig.mode).toBe('bombsight');
    const c = { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, blip: false, fireGuns: false, clearJam: false };
    t.crew.applyInput(frame({ controls: { ...c, releaseBomb: true } }));
    t.crew.beforeStep(true);
    expect(t.player.controls.releaseBomb).toBe(true);
    t.crew.beforeStep(false);
    expect(t.player.controls.releaseBomb).toBe(true); // still held
    t.crew.applyInput(frame({ controls: { ...c, releaseBomb: false } }));
    t.crew.beforeStep(true);
    expect(t.player.controls.releaseBomb).toBe(false);
  });

  it('says so on a type without bombs, or with none left', () => {
    const t = setup();
    t.crew.command('viewBombsight', 0);
    expect(t.rig.mode).toBe('cockpit');
    expect(t.messages.at(-1)).toMatch(/no bomb/i);
    const d = setup(dh4BombRun('observer'));
    d.crew.start();
    d.player.bombs = [0];
    d.crew.command('releaseBomb', 0);
    expect(d.messages.at(-1)).toMatch(/no bombs left/i);
  });
});
