import { buildChunk, type ChunkRequest } from './chunkBuilder';

// Typed minimally to avoid pulling the WebWorker lib (conflicts with DOM lib).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ChunkRequest>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const d = buildChunk(e.data);
  ctx.postMessage(d, [d.positions.buffer, d.normals.buffer, d.land.buffer, d.front.buffer]);
};
