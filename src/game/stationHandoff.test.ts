import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS, DEFAULT_SETTINGS } from '../core/settings';
import { headlessModules } from './autoplay';
import { CameraRig } from './cameras';
import { FlightSession } from './flightSession';
import { InputManager } from './input';
import type { EdgeAction } from './input';
import { PlayerCrew } from './playerCrew';
import { SimCore } from './simCore';
import { bristolFight } from './testing/crewMissions';

afterEach(() => vi.unstubAllGlobals());

/** A Gotha nose gunner's held RT and stick must not fire or swing the dorsal gun after RB. */
it('requires released RT and centered stick after a gunner-to-gunner station change', () => {
  const pad = { index: 0, id: 'review pad', connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({length: 17}, () => ({pressed: false, value: 0})) };
  vi.stubGlobal('navigator', {getGamepads: () => [pad]});
  const mission = bristolFight('nose', {playerAircraft: 'gotha_gv'});
  const core = new SimCore(headlessModules, mission, () => DEFAULT_SETTINGS.realism);
  const settings = {...DEFAULT_SETTINGS, controls: {...DEFAULT_SETTINGS.controls, mouseMode: 'off' as const, gamepadEnabled: true}};
  const input = new InputManager(new EventTarget() as HTMLElement, () => settings.controls);
  const rig = new CameraRig(70, 16/9);
  const crew = new PlayerCrew({core, input, rig, message: () => {}, bindings: () => DEFAULT_KEY_BINDINGS, visual: () => undefined});
  // Access the production command path without launching the renderer in this CPU repro.
  const session = new FlightSession({} as never, {} as never, mission, settings, {} as never) as unknown as { handleCommands(commands: EdgeAction[]): void };
  Object.assign(session, {core, world: core.world, input, rig, crew});
  crew.start();
  input.update(1/60, core.world.player, false); // acquire neutral pad
  pad.buttons[7] = {pressed: true, value: 1};
  pad.axes[0] = 0.8;
  crew.applyInput(input.update(1/60, core.world.player, false));
  crew.beforeStep(true);
  expect(core.world.player!.stationInputs).toMatchObject({station: 'nose', fire: true});
  pad.buttons[5] = {pressed: true, value: 1};
  const before = core.playerStation;
  const change = input.update(1/60, core.world.player, false);
  expect(change.commands).toEqual(['stationNext']);
  session.handleCommands(change.commands); // production handoff/cancel path
  expect(core.playerStation).toBe('dorsal');
  if (before === core.playerStation) crew.applyInput(change); // same guard as tick
  crew.beforeStep(true);
  expect(core.world.player!.stationInputs).toMatchObject({station: 'dorsal', fire: false});
  const next = input.update(1/60, core.world.player, false); // RT/LS still held
  crew.applyInput(next);
  crew.beforeStep(true);

  expect(core.world.player!.stationInputs!.fire).toBe(false);
  expect(next.stationAim).toEqual({azimuth: 0, elevation: 0});
});
