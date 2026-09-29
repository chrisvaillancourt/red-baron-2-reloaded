import { BoxGeometry, type BufferGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { mergeBombStores, showBombs } from './bombRacks';

const mat = new MeshBasicMaterial();
function bomb(name: string, geo: BufferGeometry = new BoxGeometry(0.2, 0.2, 1.5)): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  return m;
}

/** Store 0 has bombs of two different meshes (can't merge into equal ranges); store 1 merges. */
function racks(): Group {
  const holder = new Group();
  holder.name = 'Bombs';
  holder.add(bomb('Bomb_0_0'), bomb('Bomb_0_1', new SphereGeometry(0.2, 6, 4)));
  for (let k = 0; k < 3; k++) holder.add(bomb(`Bomb_1_${k}`));
  return holder;
}

describe('bomb racks', () => {
  it('merges each store it can into one mesh, and keeps no hole for one it cannot', () => {
    const { stores } = mergeBombStores(racks());
    expect([...stores.keys()].sort()).toEqual([0, 1]);
    expect(stores.get(1)!.meshes).toHaveLength(1);
    // Store 0 kept its separate bomb meshes.
    expect(stores.get(0)!.meshes).toHaveLength(2);
  });

  it('shows as many bombs as are left in each store, merged or not, without throwing', () => {
    const holder = racks();
    const { stores } = mergeBombStores(holder);
    expect(() => showBombs(stores, [1, 2])).not.toThrow();
    const merged = stores.get(1)!.meshes[0];
    expect(merged.geometry.drawRange.count).toBe(2 * stores.get(1)!.perBomb);
    const [a, b] = stores.get(0)!.meshes;
    expect([a.visible, b.visible]).toEqual([true, false]);
    showBombs(stores, undefined);
    expect(merged.visible).toBe(false);
    expect(a.visible).toBe(false);
  });

  it('shows no bombs for a store index the aircraft does not have', () => {
    const holder = new Group();
    holder.name = 'Bombs';
    holder.add(bomb('Bomb_2_0'));
    const { stores } = mergeBombStores(holder);
    expect(() => showBombs(stores, [4])).not.toThrow();
    expect(stores.get(2)!.meshes[0].visible).toBe(false);
  });
});
