// Loudness check for UI sounds and music cues: renders each through the real
// audio engine into an OfflineAudioContext and prints peak / RMS in dBFS.
// Usage: node dev/measure-ui-audio.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5304';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const page = await browser.newPage();
await page.goto(base);
const rows = await page.evaluate(async () => {
  const { createAudioEngine } = await import('/src/audio/index.ts');
  const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
  const stats = (buf) => {
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > peak) peak = v;
        sum += v * v;
        n++;
      }
    }
    // RMS over the non-silent part so short blips aren't diluted by the tail.
    let active = 0;
    let asum = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.001) (active++, (asum += d[i] * d[i]));
    }
    return { peak: db(peak), rms: db(Math.sqrt(sum / n)), activeRms: db(Math.sqrt(asum / Math.max(1, active))), activeMs: Math.round((active / buf.numberOfChannels / buf.sampleRate) * 1000) };
  };
  const out = [];
  for (const s of ['click', 'hover', 'confirm', 'back', 'typewriter', 'stamp']) {
    const ctx = new OfflineAudioContext(2, 44100 * 1.5, 44100);
    // The engine skips one-shots unless the context is running; an offline context
    // only runs once rendering starts, so report it as running for this measurement.
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    const eng = createAudioEngine(ctx);
    eng.setVolumes(0.8, 0.6, 0.9); // shipped defaults
    eng.playUi(s);
    const buf = await ctx.startRendering();
    out.push({ sound: `ui:${s}`, ...stats(buf) });
  }
  for (const cue of ['menu', 'briefing', 'victory', 'defeat', 'medal']) {
    const ctx = new OfflineAudioContext(2, 44100 * 8, 44100);
    const eng = createAudioEngine(ctx);
    eng.setVolumes(0.8, 0.6, 0.9);
    eng.playMusic(cue);
    const buf = await ctx.startRendering();
    out.push({ sound: `music:${cue}`, ...stats(buf) });
  }
  return out;
});
console.table(rows);
await browser.close();
