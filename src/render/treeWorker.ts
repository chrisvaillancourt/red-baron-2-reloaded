import { buildTreeCell, type TreeCellRequest } from './treeCells';

// Typed minimally to avoid pulling the WebWorker lib (conflicts with DOM lib).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<TreeCellRequest>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const r = e.data;
  const cell = buildTreeCell(r.ix, r.iz, r.date, r.season, r.density);
  const transfer: Transferable[] = [];
  for (const k of cell.kinds) transfer.push(k.m.buffer, k.c.buffer);
  ctx.postMessage({ id: r.id, cell }, transfer);
};
