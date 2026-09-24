import type { GameEvent } from './types';
import type { EventBus, GameEventOf, GameEventType } from './interfaces';

/** Synchronous in-process event bus for a flight session. */
export function createEventBus(): EventBus {
  const byType = new Map<GameEventType, Set<(e: GameEvent) => void>>();
  const any = new Set<(e: GameEvent) => void>();
  return {
    emit(event) {
      byType.get(event.type)?.forEach((h) => h(event));
      any.forEach((h) => h(event));
    },
    on<T extends GameEventType>(type: T, handler: (e: GameEventOf<T>) => void) {
      let set = byType.get(type);
      if (!set) byType.set(type, (set = new Set()));
      const h = handler as (e: GameEvent) => void;
      set.add(h);
      return () => set!.delete(h);
    },
    onAny(handler) {
      any.add(handler);
      return () => any.delete(handler);
    },
  };
}
