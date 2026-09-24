/**
 * Browser self-test: renders engines, guns and music through OfflineAudioContext
 * and reports peak / RMS / NaN counts per scenario. Used by Playwright QA.
 */
import { SoundBank } from '../bank';
import { createLimiter } from '../limiter';
import { compileScore, scheduleWindow } from '../music/player';
import { SCORES } from '../music/scores';
import { EngineVoice } from '../voices';
import type { EngineKind } from '../synthBuffers';

export interface SelfTestResult {
  name: string;
  peak: number;
  rms: number;
  nans: number;
}

const SR = 44100;

async function render(name: string, seconds: number, build: (ctx: OfflineAudioContext, out: AudioNode) => void): Promise<SelfTestResult> {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * SR), SR);
  const limiter = createLimiter(ctx);
  limiter.output.connect(ctx.destination);
  build(ctx, limiter.input);
  const buf = await ctx.startRendering();
  let peak = 0, sum = 0, nans = 0, n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    for (const v of buf.getChannelData(c)) {
      if (!Number.isFinite(v)) { nans++; continue; }
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      n++;
    }
  }
  return { name, peak: round(peak), rms: round(Math.sqrt(sum / Math.max(1, n))), nans };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export async function runSelfTest(): Promise<SelfTestResult[]> {
  const out: SelfTestResult[] = [];
  for (const kind of ['rotary9', 'inline6', 'v8', 'v12'] as EngineKind[]) {
    out.push(
      await render(`engine:${kind}`, 2, (ctx, dest) => {
        const v = new EngineVoice(ctx, new SoundBank(ctx), kind, dest);
        v.update({ rpm: 1300, throttle: 1, blip: false, damage: 0.4, dead: false, doppler: 1, cutoff: 8000, level: 0.9 });
      }),
    );
  }
  out.push(
    await render('guns', 2, (ctx, dest) => {
      const bank = new SoundBank(ctx);
      (['vickers', 'spandau', 'lewis', 'parabellum'] as const).forEach((g, gi) => {
        for (let i = 0; i < 6; i++) {
          const s = ctx.createBufferSource();
          s.buffer = bank.get(`gun:${g}`);
          s.connect(dest);
          s.start(gi * 0.5 + i * 0.075);
        }
      });
    }),
  );
  out.push(
    await render('bangs', 4, (ctx, dest) => {
      const bank = new SoundBank(ctx);
      (['flak', 'explosion', 'whoomph', 'crash'] as const).forEach((id, i) => {
        const s = ctx.createBufferSource();
        s.buffer = bank.get(id);
        s.connect(dest);
        s.start(i * 0.8);
      });
    }),
  );
  for (const cue of ['menu', 'briefing', 'defeat', 'victory', 'medal'] as const) {
    const score = compileScore(SCORES[cue]!);
    const secs = Math.min(10, score.lengthSec + (score.def.loop ? 0 : score.def.tail));
    out.push(
      await render(`music:${cue}`, secs, (ctx, dest) => {
        const bank = new SoundBank(ctx);
        const gain = ctx.createGain();
        gain.gain.value = 0.6; // music bus level at default volume
        gain.connect(dest);
        scheduleWindow(ctx, gain, { noise: bank.noise('white') }, score, 0.05, 0, secs);
      }),
    );
  }
  return out;
}
