/**
 * Career persistence: one versioned JSON document holding every pilot.
 * Corrupt documents are set aside under a backup key rather than crashing.
 */
import type { CareerPilot } from '../core/campaignTypes';
import { isIsoDate } from './dates';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const STORAGE_KEY = 'rb2r.campaign.v1';
const VERSION = 1;

interface SaveDoc {
  version: number;
  pilots: CareerPilot[];
}

export function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

export function defaultStorage(): StorageLike {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__rb2r_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    /* fall through to memory storage */
  }
  return memoryStorage();
}

function isPilot(x: unknown): x is CareerPilot {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<CareerPilot>;
  return (
    typeof p.id === 'string' &&
    typeof p.firstName === 'string' &&
    typeof p.lastName === 'string' &&
    typeof p.nation === 'string' &&
    typeof p.squadronId === 'string' &&
    typeof p.rankId === 'string' &&
    isIsoDate(p.date) &&
    Array.isArray(p.victories) &&
    Array.isArray(p.medals) &&
    Array.isArray(p.log)
  );
}

export class CareerStore {
  private pilots = new Map<string, CareerPilot>();

  constructor(private readonly storage: StorageLike) {
    this.load();
  }

  private load(): void {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const doc = JSON.parse(raw) as Partial<SaveDoc>;
      if (!doc || !Array.isArray(doc.pilots)) throw new Error('malformed save');
      for (const p of doc.pilots) if (isPilot(p)) this.pilots.set(p.id, p);
    } catch {
      try {
        this.storage.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw);
      } catch {
        /* ignore */
      }
      this.pilots.clear();
      this.flush();
    }
  }

  private flush(): void {
    const doc: SaveDoc = { version: VERSION, pilots: [...this.pilots.values()] };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      /* quota or unavailable: keep in memory */
    }
  }

  all(): CareerPilot[] {
    return [...this.pilots.values()];
  }

  get(id: string): CareerPilot | null {
    const p = this.pilots.get(id);
    return p ? structuredClone(p) : null;
  }

  put(p: CareerPilot): void {
    this.pilots.set(p.id, structuredClone(p));
    this.flush();
  }

  delete(id: string): void {
    this.pilots.delete(id);
    this.flush();
  }
}
