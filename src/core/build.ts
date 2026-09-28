/** Which build is running: the git short SHA and build time, injected by vite.config.ts `define`. */
declare const __BUILD_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

export interface BuildInfo {
  /** Git short SHA, with "-dirty" for uncommitted changes; "unknown" outside a Vite build. */
  sha: string;
  /** ISO time the build (or the dev server) started. */
  builtAt: string;
}

export function buildInfo(): BuildInfo {
  return {
    sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'unknown',
    builtAt: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown',
  };
}
