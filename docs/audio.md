# Audio

Everything is synthesised at runtime with WebAudio: no sample files (D-003).

## Using it (integrator notes)

```ts
import { createAudioEngine } from './audio';
const audio = createAudioEngine();          // silent NullAudioEngine if WebAudio is missing
startButton.onclick = () => audio.resume(); // browsers need a user gesture
audio.setVolumes(s.masterVolume, s.musicVolume, s.effectsVolume);
audio.playMusic('menu');                    // 'briefing' | 'victory' | 'defeat' | 'medal' | 'flight' (= silence) | 'none'
audio.playUi('click');

// Mission load:
audio.warmUp();                             // pre-render flight buffers (~100 ms) so the first shot doesn't hitch
audio.playMusic('flight');
bus.onAny((e) => audio.handleEvent(e, camera.position));
// Every frame, after cameras update:
audio.updateFlight(camera, player, world, dt, cockpitView);
audio.updateBullets(combat.bullets);        // optional extra: near-miss whizzes
// Leaving the flight:
audio.stopFlight();
```

`createAudioEngine()` returns `ReloadedAudioEngine` (the `AudioEngine` contract plus
`updateBullets`, `warmUp`, `currentMusic`, `context`).

What the engine reads from entities: `state.engineRpm`, `airspeed`, `velocity`, `aoa`,
`stalled`, `gLoad`, `onGround`, `heightAboveGround`; `controls.throttle/blip/clearJam`;
`damage.zones.engine`, `engineDead`, `onFire`, `destroyed`; `guns[].jammed`; `outcome`.
Hammering sounds come from `controls.clearJam` rising edges while any gun is jammed.
Falling wrecks produce a crash when they reach the ground (tracked by the audio engine,
no event needed).

## Structure

| File | Role |
|---|---|
| `synthBuffers.ts` | Pure-TS offline synthesis (Node-testable): engine pulse loops, guns, hits, flak, explosions, balloon, crash, gun handling, loops, UI, hall IR |
| `bank.ts` | Renders those into AudioBuffers per context, with random variants |
| `voices.ts` | `EngineVoice` (pulse loop → shaper → lowpass → ignition gain + prop wash), `LoopVoice` |
| `audioEngine.ts` | `WebAudioEngine`: buses, listener, player voice & loops, nearest-6 remote engines, one-shots |
| `spatial.ts` | Doppler, air absorption, speed-of-sound delay, nearest-N voice selection |
| `limiter.ts` | Master compressor + soft clipper (never exceeds full scale) |
| `music/` | Notation parser, original scores, synthesised instruments, look-ahead sequencer |

**Engines.** A loop of exhaust pulses covering 48 crank revolutions at 1200 rpm, played at
`playbackRate = rpm / 1200`, so the firing rate tracks rpm exactly. Profiles: `rotary9`
(4.5 pulses/rev, lumpy per-cylinder amplitude, jitter, valve rasp, harder drive), `inline6`
(Mercedes/BMW: 3 pulses/rev, smooth, deep), `v8` (Hispano/Viper), `v12` (Rolls-Royce).
Blip switch cuts ignition; engine damage causes random misfires; prop wash is noise
modulated at blade-passing frequency and keeps windmilling after the engine dies.

**Spatial.** HRTF panners for the six nearest other aircraft (0.4 s reselection with
hysteresis), inverse distance model, per-voice low-pass for air absorption, Doppler by
pitch shift (WebAudio has no built-in Doppler). Distant one-shots are delayed by the
speed of sound.

**Music.** Original pieces: "The Dawn Patrol" (menu march), "Orders from Wing" (briefing),
"Lament for the Fallen" (defeat), "Victory Roll" (victory), "Pour le Mérite" (medal:
drum roll + fanfare). 1.2 s crossfades. Music goes through a convolution hall reverb.

## QA

* `pnpm test` covers the pure synthesis (finite, non-silent, unclipped, deterministic,
  rotary rougher than inline, pulse counts), notation, score lengths, spatial math.
* `dev/audio.html` is an interactive bench for every sound, a fly-by, six circling
  aircraft, rpm/throttle/damage sliders and music cues.
* Headless check: `pnpm exec vite --port 5291` then `node src/audio/dev/qa.mjs`. It clicks
  through the bench, samples the live master bus, runs an OfflineAudioContext self-test,
  and fails on console errors, NaNs, silence or clipping. Uses installed Google Chrome
  (falls back to Playwright's Chromium).

## Known gaps

* Only the listener's own aircraft gets wind/wire/buffet loops; other aircraft are engine-only.
* No per-gun stereo placement for the player's guns (events don't carry the mount index).
* `radio` events are silent (text only, as in RB2).
