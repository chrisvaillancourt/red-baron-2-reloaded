import { buildTownTile, type TownTileRequest } from './townTiles';

// Typed minimally to avoid pulling the WebWorker lib (conflicts with DOM lib).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<TownTileRequest>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const r = e.data;
  const data = buildTownTile(r.cx, r.cz, r.date, r.buildingDistance);
  const transfer: Transferable[] = [];
  for (const s of Object.values(data)) {
    transfer.push(s.m.buffer);
    if (s.c) transfer.push(s.c.buffer);
  }
  ctx.postMessage({ id: r.id, data }, transfer);
};
