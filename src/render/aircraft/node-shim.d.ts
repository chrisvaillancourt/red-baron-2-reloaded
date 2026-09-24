// Minimal Node typings for the model contract test (the project doesn't
// depend on @types/node; tests run under Vitest's Node environment).
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array & { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
  export function existsSync(path: string | URL): boolean;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
