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
`damage.zones.engine`, `engineDead`, `onFire`, `destroyed`, `engines` (per engine, twins);
`guns[].jammed`; `outcome`; `spec.performance.engineCount`.
Hammering sounds come from `controls.clearJam` rising edges while any gun is jammed.
Falling wrecks produce a crash when they reach the ground (tracked by the audio engine,
no event needed).

## Structure

| File | Role |
|---|---|
| `synthBuffers.ts` | Pure-TS offline synthesis (Node-testable): engine pulse loops, guns, hits, flak, explosions, bombs (release, whistle, burst), balloon, crash, gun handling, loops, UI, hall IR |
| `bank.ts` | Renders those into AudioBuffers per context, with random variants |
| `voices.ts` | `EngineVoice` (pulse loop → shaper → lowpass → ignition gain + prop wash), `MultiEngineVoice` (one per engine, detuned), `LoopVoice` |
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
Twins (`MultiEngineVoice`) get one voice per engine through the same panner, the second
1.3% fast (`ENGINE_DETUNE`), so the pair beats at about 1 Hz like a Gotha overhead. Each
takes its own `damage.engines[i]`, and an engine at 1 is dead: only its windmilling
propeller is heard (`min(rpm, airspeed × 9)`, as the visual spins it). Each voice plays at
0.72 so the pair is about one engine plus 1.5 dB. The Renault 12Fcx maps to `v12`.

**Bombs.** `bomb-released`: the release clunk (the latch and the rack springing back) in the
cockpit when it's the player's, positional within 250 m otherwise. The whistle (2.2 s,
sliding from about 1650 to 750 Hz and swelling) is heard only within 700 m of where the bomb
will land: the engine asks the sim (`predictBombImpact(aircraft, world.env, storeIndex)`, the
same ballistics, drag and wind as the real fall) and ends the whistle there, as the burst
is heard: it starts `BOMB_WHISTLE_SECONDS / rate` before the impact and gets the same
sound-travel delay as the burst. Whistles wait in a queue (`whistles.ts`) instead of being
scheduled at release, so a falling bomb holds no one-shot voice. At most three play at once,
nearest first; one that comes due with no free slot is dropped. `bomb-exploded`: a deep
concussion with a crack, then earth pattering back for about two seconds; bigger charges are
louder, carry further (`ref` 25 · kg^⅓ m) and play lower. Sound travel delays it like
every distant bang.

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
  aircraft, rpm/throttle/damage sliders and music cues. **Listener: flight** retains
  the existing cockpit/chase poses. **Listener: ground** places only the camera at
  2 m AGL (52 m in the mock world); it does not lower the Camel or other aircraft.
  Ground bursts, bomb sticks and crashes use terrain coordinates in either preset.
* **Falling bomb (D.H.4 → ground)** uses a separate D.H.4 at the original 1,500 m
  flight altitude, loads its real 112 lb R.L. HE stores, and selects the next store
  with `nextBombStore`. `predictBombImpact` places the impact 80 m horizontally
  from the ground listener by translating the carrier horizontally, not vertically.
  The fall uses the sim's `stepBomb` and `groundCrossing`; the release event feeds
  the existing audio world query, whistle queue and master bus, and impact emits
  the real store's burst. The default Camel still has no bomb racks: **bomb release
  (own)** auditions its release clunk, not a fabricated Camel whistle. **Reset
  falling bomb** and listener preset changes cancel the fall and pending queue.
* Headless check: start an owned server with
  `RB2R_REPORTS_DIR=tools/dev/scratch/workflowz-ground-audio/flight-reports pnpm dev --port 5291 --strictPort`,
  then run `node src/audio/dev/qa.mjs http://localhost:5291`. It uses the shared
  native `automationLaunchOptions` policy (headless installed Chrome by default)
  and installs `disableGamepads` before navigation. Launch failure is an error,
  never a silent fallback to a different browser.
* QA samples `debugOutputTap()`, the actual destination input **after the existing
  limiter**, with music muted and engine/wind consumers temporarily omitted at the
  bench query seam. The earlier pre-limiter master tap measured headroom, not
  delivered clipping; no limiter gains or audio tuning were changed. Both
  presets release the same real store: the flight listener must remain silent
  outside whistle range, while the ground listener must hear the queued whistle.
  Burst emission is disabled only during this whistle-only proof to avoid masking;
  the physical fall still runs. Evidence includes prediction, listener/carrier/player
  positions, peak/RMS, nonfinite/clipping counts, silent baseline/pre-whistle/cleanup,
  and a cancelled release observed through its complete due window. Ground-burst
  controls are separately sampled in both presets. Consumer settings are restored.
  The existing live-control sweep and OfflineAudioContext self-test remain.
* QA saves `bench-flight.png` and `bench-ground.png` beneath the owning workspace's
  `tools/dev/scratch/workflowz-ground-audio/`, then closes its audio context and
  browser. Running this script and inspecting its screenshots are integration-owner
  acceptance, not evidence supplied merely by authoring the script.

## Known gaps

* Only the listener's own aircraft gets wind/wire/buffet loops; other aircraft are engine-only.
* No mount-specific stereo placement for the player's guns: `gun-fired` carries `mountIndex`, but audio does not use it and applies random cockpit pan.
* `radio` events are silent (text only, as in RB2).
