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
  /** Records that failed validation, kept verbatim so no save ever erases them. */
  quarantined?: unknown[];
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

/** Upgrade an older document in place. Add a case per schema change (see docs/game.md "Robustness"). */
function migrate(doc: Partial<SaveDoc>): Partial<SaveDoc> {
  // Version-less documents predate the version field: same shape as v1.
  if (doc.version === undefined) doc.version = 1;
  return doc;
}

/**
 * Save-safety rules:
 *  - Read-modify-write: every mutation re-reads storage and changes only its own
 *    pilot, so two tabs (or two stores) never erase each other's careers.
 *  - A pilot record that fails validation is kept under `quarantined` instead
 *    of being dropped by the next save.
 *  - A document from a newer game version is never overwritten (`readOnly`):
 *    changes stay in memory for this session.
 *  - A corrupt document is backed up under `<key>.corrupt-<time>` before the
 *    store starts afresh.
 *  - If storage refuses a write (quota), memory stays authoritative until a
 *    write succeeds.
 */
export class CareerStore {
  private pilots = new Map<string, CareerPilot>();
  private quarantined: unknown[] = [];
  private docVersion = VERSION;
  /** True when the save came from a newer version of the game: never written. */
  readOnly = false;
  /** A write failed: memory holds changes storage doesn't have yet. */
  private unsaved = false;
  /** Raw document last parsed or written, to skip re-parsing unchanged storage. */
  private lastRaw: string | null = null;

  constructor(private readonly storage: StorageLike) {
    this.refresh(true);
  }

  /** Mirror storage into memory (unless memory holds unsaved changes). */
  private refresh(initial = false): void {
    if (!initial && (this.readOnly || this.unsaved)) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return; // unreadable storage: keep what we have
    }
    if (!raw) {
      if (!initial) this.pilots.clear();
      this.quarantined = [];
      this.lastRaw = null;
      return;
    }
    if (raw === this.lastRaw) return; // unchanged since we last parsed or wrote it
    this.lastRaw = raw;
    try {
      const doc = migrate(JSON.parse(raw) as Partial<SaveDoc>);
      if (!doc || !Array.isArray(doc.pilots)) throw new Error('malformed save');
      const pilots = new Map<string, CareerPilot>();
      const quarantined: unknown[] = Array.isArray(doc.quarantined) ? [...doc.quarantined] : [];
      for (const p of doc.pilots) {
        if (isPilot(p)) pilots.set(p.id, p);
        else quarantined.push(p);
      }
      this.pilots = pilots;
      this.quarantined = quarantined;
      this.docVersion = doc.version ?? VERSION;
      if (this.docVersion > VERSION) {
        this.readOnly = true;
        console.warn(`[campaign] save is from a newer version (v${this.docVersion} > v${VERSION}); it will not be modified.`);
      }
    } catch {
      try {
        this.storage.setItem(`${STORAGE_KEY}.corrupt-${Date.now()}`, raw);
      } catch {
        /* ignore */
      }
      this.pilots.clear();
      this.quarantined = [];
      this.write();
    }
  }

  private write(): void {
    if (this.readOnly) return;
    const doc: SaveDoc = { version: VERSION, pilots: [...this.pilots.values()] };
    if (this.quarantined.length) doc.quarantined = this.quarantined;
    try {
      const raw = JSON.stringify(doc);
      this.storage.setItem(STORAGE_KEY, raw);
      this.lastRaw = raw;
      this.unsaved = false;
    } catch {
      this.unsaved = true; // quota or unavailable: keep in memory
    }
  }

  private mutate(fn: (pilots: Map<string, CareerPilot>) => void): void {
    this.refresh(); // pick up other tabs' changes first
    fn(this.pilots);
    this.write();
  }

  all(): CareerPilot[] {
    this.refresh();
    return [...this.pilots.values()];
  }

  get(id: string): CareerPilot | null {
    this.refresh();
    const p = this.pilots.get(id);
    return p ? structuredClone(p) : null;
  }

  put(p: CareerPilot): void {
    this.mutate((m) => m.set(p.id, structuredClone(p)));
  }

  delete(id: string): void {
    this.mutate((m) => m.delete(id));
  }
}
