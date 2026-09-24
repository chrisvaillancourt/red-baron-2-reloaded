/** STUB audio: silent. Replaced by src/audio. */
import type { AudioEngine } from '../../core/interfaces';

export function stubCreateAudioEngine(): AudioEngine {
  return {
    resume: async () => {},
    setVolumes: () => {},
    playMusic: () => {},
    playUi: () => {},
    updateFlight: () => {},
    handleEvent: () => {},
    stopFlight: () => {},
  };
}
