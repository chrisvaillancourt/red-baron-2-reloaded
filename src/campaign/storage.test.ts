import { describe, expect, it } from 'vitest';
import type { CareerPilot } from '../core/campaignTypes';
import { CareerStore, memoryStorage, STORAGE_KEY, type StorageLike } from './storage';

function pilot(id: string, extra: Partial<CareerPilot> = {}): CareerPilot {
  return {
    id,
    firstName: 'Test',
    lastName: id,
    nation: 'britain',
    side: 'allied',
    difficulty: 'pilot',
    squadronId: 'rfc56',
    rankId: 'gb-2lt',
    date: '1917-06-01',
    status: 'active',
    hospitalDays: 0,
    missionsFlown: 0,
    victories: [],
    unconfirmedClaims: 0,
    medals: [],
    log: [],
    fame: 0,
    rngSeed: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function doc(s: StorageLike): { version: number; pilots: unknown[]; quarantined?: unknown[] } {
  return JSON.parse(s.getItem(STORAGE_KEY)!);
}

describe('CareerStore save safety', () => {
  it('round-trips pilots', () => {
    const s = memoryStorage();
    new CareerStore(s).put(pilot('a'));
    expect(new CareerStore(s).get('a')?.lastName).toBe('a');
  });

  it('sets aside a corrupt document under a backup key and starts empty', () => {
    const written = new Map<string, string>();
    const base = memoryStorage();
    const s: StorageLike = {
      getItem: (k) => base.getItem(k),
      setItem: (k, v) => {
        written.set(k, v);
        base.setItem(k, v);
      },
      removeItem: (k) => base.removeItem(k),
    };
    base.setItem(STORAGE_KEY, '{not json');
    const store = new CareerStore(s);
    expect(store.all()).toEqual([]);
    const backup = [...written].find(([k]) => k.startsWith(`${STORAGE_KEY}.corrupt-`));
    expect(backup?.[1]).toBe('{not json');
  });

  it('keeps a pilot record it cannot read instead of erasing it on the next save', () => {
    const s = memoryStorage();
    const damaged = { ...pilot('bad'), date: 'someday' }; // fails validation
    s.setItem(STORAGE_KEY, JSON.stringify({ version: 1, pilots: [pilot('good'), damaged] }));
    const store = new CareerStore(s);
    expect(store.all().map((p) => p.id)).toEqual(['good']);
    store.put(pilot('new'));
    const d = doc(s);
    const all = [...d.pilots, ...(d.quarantined ?? [])] as { id: string }[];
    expect(all.map((p) => p.id).sort()).toEqual(['bad', 'good', 'new']);
  });

  it('never overwrites a save written by a newer version of the game', () => {
    const s = memoryStorage();
    const future = JSON.stringify({ version: 99, pilots: [pilot('a', { futureField: 1 } as never)] });
    s.setItem(STORAGE_KEY, future);
    const store = new CareerStore(s);
    expect(store.readOnly).toBe(true);
    store.put(pilot('b'));
    expect(s.getItem(STORAGE_KEY)).toBe(future);
  });

  it('does not lose another tab’s changes (two stores sharing one storage)', () => {
    const s = memoryStorage();
    const tabA = new CareerStore(s);
    const tabB = new CareerStore(s);
    tabA.put(pilot('fromA'));
    tabB.put(pilot('fromB'));
    expect(new CareerStore(s).all().map((p) => p.id).sort()).toEqual(['fromA', 'fromB']);
    // And each tab sees the other's pilot.
    expect(tabA.get('fromB')).not.toBeNull();
    tabB.delete('fromA');
    expect(new CareerStore(s).all().map((p) => p.id)).toEqual(['fromB']);
  });

  it('keeps working in memory when storage refuses writes (quota)', () => {
    const base = memoryStorage();
    const s: StorageLike = {
      getItem: (k) => base.getItem(k),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: (k) => base.removeItem(k),
    };
    const store = new CareerStore(s);
    expect(() => store.put(pilot('a'))).not.toThrow();
    expect(store.get('a')?.id).toBe('a');
  });

  it('migrates a version-less document as version 1', () => {
    const s = memoryStorage();
    s.setItem(STORAGE_KEY, JSON.stringify({ pilots: [pilot('old')] }));
    const store = new CareerStore(s);
    expect(store.get('old')?.id).toBe('old');
    store.put(pilot('x'));
    expect(doc(s).version).toBe(1);
  });
});
