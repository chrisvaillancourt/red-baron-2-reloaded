// Minimal Node typings for the Node-only AI soak tests (the project has no @types/node).
declare module 'node:fs' {
  export function appendFileSync(path: string, data: string): void;
}
declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };
