/**
 * Which build is running: the git short SHA and build time, injected by vite.config.ts `define`.
 *
 * `define` is evaluated once, when Vite loads its config: at `pnpm build` for a production build,
 * but at dev-server start under `pnpm dev`. So a dev report carries the SHA and dirty state from
 * when the server started, not from later edits; `dev: true` marks such reports.
 */
declare const __BUILD_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

export interface BuildInfo {
  /** Git short SHA, with "-dirty" for uncommitted changes; "unknown" outside a Vite build. */
  sha: string;
  /** ISO time the build (or the dev server) started. */
  builtAt: string;
  /** Served by the dev server: `sha` is as of server start (edits since then aren't reflected). */
  dev?: boolean;
}

export function buildInfo(): BuildInfo {
  const info: BuildInfo = {
    sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'unknown',
    builtAt: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown',
  };
  if (import.meta.env?.DEV) info.dev = true;
  return info;
}
