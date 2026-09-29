/**
 * Dev-server flight-report sink (D-084). Under `pnpm dev` the debrief sends each flight report to
 * `REPORT_SINK_PATH`, and the Vite plugin in vite.config.ts saves it to `playtests/inbox/`, so a
 * playtester no longer has to copy and paste. This module is the pure part: validation and the
 * file name. The plugin supplies the file write. Production builds have no sink; the debrief
 * falls back to "Copy flight report".
 */
import { parseFlightReport, serializeFlightReport, type FlightReport } from './flightReport';

export const REPORT_SINK_PATH = '/__rb2r/flight-report';
/** Largest body accepted, bytes (a report is ~10 kB; a whole career mission well under 1 MB). */
export const REPORT_BODY_MAX = 2_000_000;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'x';

/**
 * `YYYY-MM-DD-HHMMSS-<type>-<player type>-v-<enemy count>-<enemy type>.json`, from the report's
 * `createdAt` (UTC) and mission. Rating and note aren't in it, so the debrief's re-sends of one
 * flight overwrite the same file.
 */
export function reportFileName(r: FlightReport): string {
  const when = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(r.createdAt);
  const stamp = when ? `${when[1]}-${when[2]}${when[3]}${when[4]}` : 'undated';
  const flights = Array.isArray(r.mission.flights) ? r.mission.flights : [];
  const player = flights.find((f) => f.role === 'player-flight');
  const enemies = flights.filter((f) => f.role === 'enemy');
  const enemyCount = enemies.reduce((n, f) => n + (Array.isArray(f.members) ? f.members.length : 0), 0);
  const parts = [slug(String(r.mission.type)), slug(String(player?.aircraftId ?? 'unknown')), 'v', String(enemyCount), slug(String(enemies[0]?.aircraftId ?? 'none'))];
  return `${stamp}-${parts.join('-')}.json`.replace(/[^a-z0-9.-]/g, '-');
}

export interface SinkResponse {
  status: 200 | 400 | 413;
  body: { file?: string; error?: string };
}

/** Validate an uploaded report and hand it to `write` under its file name. */
export function acceptFlightReport(body: string, write: (fileName: string, text: string) => void): SinkResponse {
  if (body.length > REPORT_BODY_MAX) return { status: 413, body: { error: `Report larger than ${REPORT_BODY_MAX} bytes.` } };
  let report: FlightReport;
  try {
    report = parseFlightReport(body);
  } catch (e) {
    return { status: 400, body: { error: (e as Error).message } };
  }
  const file = reportFileName(report);
  write(file, serializeFlightReport(report) + '\n');
  return { status: 200, body: { file } };
}
