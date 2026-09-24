// Minimal Node typings for the Node-only autoplay soak tests (the project has no @types/node).
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
}
