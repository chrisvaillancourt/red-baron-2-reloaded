/**
 * Procedural audio for Red Baron II: Reloaded. See docs/audio.md.
 *
 *   const audio = createAudioEngine();
 *   button.onclick = () => audio.resume();      // autoplay policy
 *   audio.playMusic('menu');
 *   // in flight, every frame:
 *   audio.updateFlight(camera, player, world, dt, cockpitView);
 *   audio.updateBullets(combat.bullets);         // optional near-miss whizzes
 *   bus.onAny((e) => audio.handleEvent(e, camera.position));
 *   // leaving flight:
 *   audio.stopFlight();
 */
import type { MusicCue } from '../core/interfaces';
import { WebAudioEngine, type ReloadedAudioEngine } from './audioEngine';

export type { ReloadedAudioEngine } from './audioEngine';
export { WebAudioEngine, MAX_ENGINE_VOICES } from './audioEngine';

/** Silent stand-in used where WebAudio is unavailable (Node tests, very old browsers). */
export class NullAudioEngine implements ReloadedAudioEngine {
  readonly context = null;
  readonly currentMusic: MusicCue = 'none';
  async resume(): Promise<void> {}
  setVolumes(): void {}
  playMusic(): void {}
  playUi(): void {}
  updateFlight(): void {}
  updateBullets(): void {}
  handleEvent(): void {}
  stopFlight(): void {}
  warmUp(): void {}
}

export function createAudioEngine(ctx?: AudioContext): ReloadedAudioEngine {
  if (!ctx && typeof globalThis.AudioContext === 'undefined') return new NullAudioEngine();
  try {
    return new WebAudioEngine(ctx);
  } catch (err) {
    console.warn('WebAudio unavailable, running silent:', err);
    return new NullAudioEngine();
  }
}
