import type { GameSettings } from './types';

/**
 * Default key bindings: action -> KeyboardEvent.code list.
 * Modelled on Red Baron II's layout, modernised (WASD-friendly alternates).
 * The input layer (src/game/input.ts) is the only consumer of action names.
 */
export const DEFAULT_KEY_BINDINGS: Record<string, string[]> = {
  pitchUp: ['ArrowDown', 'KeyS'],
  pitchDown: ['ArrowUp', 'KeyW'],
  rollLeft: ['ArrowLeft', 'KeyA'],
  rollRight: ['ArrowRight', 'KeyD'],
  yawLeft: ['KeyZ', 'KeyQ'],
  yawRight: ['KeyX', 'KeyE'],
  throttleUp: ['Equal', 'NumpadAdd'],
  throttleDown: ['Minus', 'NumpadSubtract'],
  throttleFull: ['Digit9'],
  throttleCut: ['Digit0'],
  blip: ['KeyB'],
  fire: ['Space'],
  clearJam: ['KeyU'],
  viewCockpit: ['F1'],
  viewChase: ['F2'],
  viewPadlock: ['F4', 'KeyP'],
  viewTarget: ['F5'],
  viewFlyby: ['F3'],
  lookLeft: ['Numpad4'],
  lookRight: ['Numpad6'],
  lookBack: ['Numpad2'],
  lookUp: ['Numpad8'],
  nextTarget: ['KeyT'],
  padlockNearest: ['KeyY'],
  timeCompress: ['KeyK'],
  timeNormal: ['KeyL'],
  pause: ['Escape'],
  map: ['KeyM'],
  endFlight: ['KeyN'],
  wingmenAttack: ['Digit1'],
  wingmenEngage: ['Digit2'],
  wingmenFormUp: ['Digit3'],
  wingmenCover: ['Digit4'],
  wingmenHome: ['Digit5'],
  toggleHud: ['KeyH'],
};

export const DEFAULT_SETTINGS: GameSettings = {
  realism: {
    flightModel: 'standard',
    engineTorque: true,
    gunJams: true,
    limitedAmmo: true,
    limitedFuel: false,
    midairCollisions: true,
    invulnerable: false,
    autoRudder: true,
    gEffects: true,
    targetLabels: true,
    enemySkillBias: 0,
  },
  graphics: 'high',
  fov: 70,
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.9,
  controls: {
    mouseMode: 'mouse-aim',
    invertPitch: false,
    mouseSensitivity: 1,
    gamepadEnabled: true,
    gamepadDeadzone: 0.12,
    keyBindings: DEFAULT_KEY_BINDINGS,
  },
  units: 'auto',
  showTutorialHints: true,
};

const STORAGE_KEY = 'rb2r.settings.v1';

export function loadSettings(): GameSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      realism: { ...DEFAULT_SETTINGS.realism, ...parsed.realism },
      controls: {
        ...DEFAULT_SETTINGS.controls,
        ...parsed.controls,
        keyBindings: { ...DEFAULT_KEY_BINDINGS, ...parsed.controls?.keyBindings },
      },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings persist for this session only */
  }
}
