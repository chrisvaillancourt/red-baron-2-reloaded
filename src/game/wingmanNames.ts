/**
 * Compact wingman names for the HUD list: the surname alone ("Wolff"), an
 * initial added when two surnames clash ("M. Richthofen", "L. Richthofen"),
 * and the callsign without its rank if even that is ambiguous.
 */
import { getAce } from '../data/aces';

export interface WingmanNameSource {
  callsign: string;
  aceId?: string;
}

interface Parsed {
  whole: string;
  withoutRank: string;
  surname: string;
  initial: string | null;
}

function parse(m: WingmanNameSource): Parsed {
  const tokens = m.callsign.split(' ').filter(Boolean);
  const last = tokens[tokens.length - 1] ?? m.callsign;
  if (last.startsWith('#')) return { whole: m.callsign, withoutRank: m.callsign, surname: m.callsign, initial: null };
  // A leading abbreviation that isn't an initial is the rank ("Ltn.", "Capt.", "Rittm.").
  const rest = tokens.length > 1 && /^[^.]{2,}\.$/.test(tokens[0]) ? tokens.slice(1) : tokens;
  const initialTok = rest.find((t) => /^\p{L}\.$/u.test(t));
  const ace = m.aceId ? getAce(m.aceId) : undefined;
  const initial = initialTok ?? (ace?.firstName ? `${ace.firstName[0]}.` : null);
  return { whole: m.callsign, withoutRank: rest.join(' '), surname: last, initial };
}

export function wingmanLabels(mates: readonly WingmanNameSource[]): string[] {
  const parsed = mates.map(parse);
  const count = <T>(xs: T[], x: T) => xs.filter((y) => y === x).length;
  const surnames = parsed.map((p) => p.surname);
  const first = parsed.map((p) => (count(surnames, p.surname) > 1 && p.initial ? `${p.initial} ${p.surname}` : p.surname));
  return parsed.map((p, i) => (count(first, first[i]) > 1 ? (count(parsed.map((q) => q.withoutRank), p.withoutRank) > 1 ? p.whole : p.withoutRank) : first[i]));
}
