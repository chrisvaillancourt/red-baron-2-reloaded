/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Same as REPORT_SINK_PATH in src/core/reportSink.ts (reportSink.test.ts checks they match). */
const REPORT_SINK_PATH = '/__rb2r/flight-report';
/** Stop reading a body past this; the sink module rejects it (REPORT_BODY_MAX there is 2 MB). */
const READ_LIMIT = 2_100_000;

/**
 * Git short SHA of the build, "-dirty" with uncommitted tracked changes (flight reports,
 * src/core/build.ts). Read once when this config loads: under `pnpm dev` that is server start,
 * so dev reports carry the start-time SHA and are marked `build.dev`.
 */
function buildSha(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== '';
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

/**
 * Dev server only (D-084): the debrief POSTs each flight report here, and it is saved to
 * playtests/reports/, or to $RB2R_REPORTS_DIR (e2e points it at test-results/). A production
 * build has no such endpoint. The validation lives in src/core/reportSink.ts, loaded through
 * Vite (ssrLoadModule) so this config imports nothing from src.
 */
function flightReportSink(): Plugin {
  const dir = process.env.RB2R_REPORTS_DIR ?? 'playtests/reports';
  return {
    name: 'rb2r-flight-report-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(REPORT_SINK_PATH, (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST a flight report.' });
        let body = '';
        let tooBig = false;
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          if (tooBig) return;
          body += chunk;
          if (body.length > READ_LIMIT) tooBig = true;
        });
        req.on('end', async () => {
          try {
            const sink = (await server.ssrLoadModule('/src/core/reportSink.ts')) as typeof import('./src/core/reportSink');
            const r = sink.acceptFlightReport(tooBig ? 'x'.repeat(sink.REPORT_BODY_MAX + 1) : body, (file, text) => {
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, file), text);
            });
            if (r.status === 200) server.config.logger.info(`flight report saved: ${join(dir, r.body.file!)}`);
            reply(r.status, r.status === 200 ? { ...r.body, dir } : r.body);
          } catch (e) {
            reply(500, { error: (e as Error).message });
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [flightReportSink()],
  server: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
