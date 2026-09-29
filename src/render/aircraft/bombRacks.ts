/**
 * Bombs on the racks (docs/models.md "Bombs"): the model's `Bombs` > `Bomb_<store>_<k>` meshes,
 * merged into one mesh per store where they can be, and shown as the load drops.
 */
import { Mesh, type BufferGeometry, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * One bomb store. Merged: one mesh, bomb k at index range [k·perBomb, (k+1)·perBomb), so
 * drawing the first `n` ranges shows `n` bombs (the generator lists each store's bombs in
 * reverse release order). Not mergeable (bombs of unequal meshes): the separate meshes, the
 * first `n` visible (perBomb 0).
 */
export interface BombStoreView {
  meshes: Mesh[];
  perBomb: number;
  count: number;
  /** Bombs shown now (-1: not yet set). */
  shown: number;
}

/** Merge each store under `holder`; returns the stores and the geometries the caller owns. */
export function mergeBombStores(holder: Object3D): { stores: Map<number, BombStoreView>; geometries: BufferGeometry[] } {
  const stores = new Map<number, BombStoreView>();
  const geometries: BufferGeometry[] = [];
  const found = new Map<number, { k: number; mesh: Mesh }[]>();
  for (const c of holder.children) {
    const m = /^Bomb_(\d+)_(\d+)$/.exec(c.name);
    if (!m || !(c as Mesh).isMesh) continue;
    const list = found.get(+m[1]) ?? [];
    list.push({ k: +m[2], mesh: c as Mesh });
    found.set(+m[1], list);
  }
  holder.updateMatrixWorld(true);
  for (const [s, list] of found) {
    list.sort((a, b) => a.k - b.k);
    const geos = list.map(({ mesh }) => {
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
      return g.index ? g : g.setIndex([...Array(g.getAttribute('position').count).keys()]);
    });
    const n = geos[0].index!.count;
    const merged = geos.every((g) => g.index!.count === n) ? mergeGeometries(geos, false) : null;
    geos.forEach((g) => g.dispose());
    if (!merged) {
      stores.set(s, { meshes: list.map((b) => b.mesh), perBomb: 0, count: list.length, shown: -1 });
      continue;
    }
    const mesh = new Mesh(merged, list[0].mesh.material);
    mesh.name = `Bombs_${s}`;
    for (const { mesh: m } of list) m.removeFromParent();
    holder.add(mesh);
    geometries.push(merged);
    stores.set(s, { meshes: [mesh], perBomb: n, count: list.length, shown: -1 });
  }
  return { stores, geometries };
}

/** Show `bombsLeft[store]` bombs of each store (none for a store it doesn't list, or when absent). */
export function showBombs(stores: ReadonlyMap<number, BombStoreView>, bombsLeft: readonly number[] | undefined): void {
  for (const [s, b] of stores) {
    const shown = Math.max(0, Math.min(b.count, bombsLeft?.[s] ?? 0));
    if (shown === b.shown) continue;
    b.shown = shown;
    if (b.perBomb > 0) {
      const mesh = b.meshes[0];
      mesh.geometry.setDrawRange(0, shown * b.perBomb);
      mesh.visible = shown > 0;
    } else {
      b.meshes.forEach((m, k) => (m.visible = k < shown));
    }
  }
}
