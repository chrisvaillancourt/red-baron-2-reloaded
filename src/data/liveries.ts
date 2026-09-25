/**
 * Livery composition. A final Livery is layered:
 *   factory finish for the aircraft type
 *   -> squadron markings (SQUADRON_LIVERY_OVERRIDES)
 *   -> ace or personal markings (ACE_LIVERIES / CareerPilot.personalLivery)
 *   -> national insignia resolved by nation and date (cross pattée until
 *      mid-April 1918, then Balkenkreuz).
 */
import type { AircraftId, Livery, Nation } from '../core/types';

type Finish = Omit<Livery, 'insignia' | 'marking'>;

const CLEAR_LINEN: Finish = { fuselage: '#cdbf95', wingTop: '#cdbf95', wingBottom: '#d8cca6', tail: '#cdbf95', cowling: '#a7a9a8', accent: '#a7a9a8', pattern: 'clear-doped' };
const ALBATROS_WOOD: Finish = { fuselage: '#b27b3e', wingTop: '#5f6b3a', wingBottom: '#9fbad0', tail: '#b27b3e', cowling: '#8e8f8c', accent: '#8e8f8c', pattern: 'plain' };
const PFALZ_SILVER: Finish = { fuselage: '#b9bdbd', wingTop: '#b9bdbd', wingBottom: '#c9cdcd', tail: '#b9bdbd', cowling: '#9a9d9d', accent: '#9a9d9d', pattern: 'plain' };
const FOKKER_STREAKED: Finish = { fuselage: '#5d6a3a', wingTop: '#5d6a3a', wingBottom: '#8fb0c8', tail: '#e8e4d8', cowling: '#5d6a3a', accent: '#5d6a3a', pattern: 'streaked' };
const FOKKER_LOZENGE: Finish = { fuselage: '#55643a', wingTop: '#6a5a7a', wingBottom: '#9aa0b8', tail: '#e8e4d8', cowling: '#55643a', accent: '#55643a', pattern: 'lozenge' };
const GERMAN_TWO_SEATER: Finish = { fuselage: '#c2b48a', wingTop: '#5f6b3a', wingBottom: '#a6bfd2', tail: '#c2b48a', cowling: '#8e8f8c', accent: '#8e8f8c', pattern: 'lozenge' };
const PC10: Finish = { fuselage: '#5a5436', wingTop: '#5a5436', wingBottom: '#d8cdae', tail: '#5a5436', cowling: '#a9aba9', accent: '#a9aba9', pattern: 'pc10' };
const NIEUPORT_SILVER: Finish = { fuselage: '#b7bbb6', wingTop: '#b7bbb6', wingBottom: '#c6c9c4', tail: '#b7bbb6', cowling: '#a6a8a6', accent: '#a6a8a6', pattern: 'plain' };
const SPAD_CAMO: Finish = { fuselage: '#bda77c', wingTop: '#5d6a45', wingBottom: '#d6cbac', tail: '#bda77c', cowling: '#8f918e', accent: '#8f918e', pattern: 'plain' };

const FACTORY: Record<AircraftId, Finish> = {
  fokker_eiii: CLEAR_LINEN,
  albatros_dii: ALBATROS_WOOD,
  albatros_diii: ALBATROS_WOOD,
  albatros_dv: { ...ALBATROS_WOOD, fuselage: '#a8743a' },
  pfalz_diiia: PFALZ_SILVER,
  fokker_dri: FOKKER_STREAKED,
  fokker_dvii: FOKKER_LOZENGE,
  fokker_dviii: FOKKER_LOZENGE,
  halberstadt_clii: GERMAN_TWO_SEATER,
  rumpler_civ: { ...GERMAN_TWO_SEATER, fuselage: '#d0c7a6', pattern: 'plain' },
  albatros_ciii: { ...CLEAR_LINEN, fuselage: '#b27b3e', tail: '#b27b3e', pattern: 'plain' }, // varnished plywood, clear-doped wings
  airco_dh2: CLEAR_LINEN,
  nieuport_11: NIEUPORT_SILVER,
  nieuport_17: NIEUPORT_SILVER,
  sopwith_pup: PC10,
  sopwith_triplane: PC10,
  spad_vii: SPAD_CAMO,
  spad_xiii: SPAD_CAMO,
  se5a: PC10,
  sopwith_camel: PC10,
  nieuport_28: { ...SPAD_CAMO, fuselage: '#b9b09a', wingTop: '#6a7050' },
  bristol_f2b: PC10,
  re8: PC10,
  dh4: PC10,
  be2c: CLEAR_LINEN, // clear-doped in 1915-16; PC10 came later
  fe2b: CLEAR_LINEN,
  farman_f40: { ...CLEAR_LINEN, fuselage: '#b8bbb4' }, // aluminium-doped nacelle
};

/** National insignia by nation and date. */
export function nationalInsignia(nation: Nation, date: string): Livery['insignia'] {
  switch (nation) {
    case 'germany':
      // Idflieg ordered the straight-armed Balkenkreuz on 17 March 1918; units had repainted by mid-April.
      return date >= '1918-04-15' ? 'balkenkreuz' : 'iron-cross-patee';
    case 'britain':
      return 'roundel-rfc';
    case 'france':
      return 'roundel-france';
    case 'usa':
      // US roundels appear with the first AEF pursuit squadrons (spring 1918).
      return date >= '1918-02-18' ? 'roundel-usa' : 'roundel-france';
  }
}

/** Squadron identification markings (applied on top of the factory finish). */
export const SQUADRON_LIVERY_OVERRIDES: Record<string, Partial<Livery>> = {
  ffa62: {},
  jasta2: { tail: '#f2f2f2', accent: '#161616' }, // Jasta Boelcke: black-and-white tails
  jasta4: { accent: '#161616', cowling: '#161616' }, // black nose, Udet-era spirals
  jasta5: { tail: '#3d6b3a', accent: '#c8372a' }, // green tails
  jasta6: { tail: '#161616', accent: '#f2f2f2', pattern: 'stripes' }, // black/white striped tail
  jasta10: { cowling: '#e3bf1c', accent: '#e3bf1c' }, // yellow noses
  jasta11: { fuselage: '#a8251d', accent: '#a8251d', cowling: '#a8251d' }, // red machines
  jasta26: { fuselage: '#1b1b1b', accent: '#f2f2f2', pattern: 'stripes' }, // black/white bands
  jasta27: { cowling: '#e0b02a', accent: '#e0b02a' }, // yellow noses
  rfc24: {},
  rfc40: { accent: '#f2f2f2' },
  rfc46: { accent: '#f2f2f2' },
  rfc48: { accent: '#161616' },
  rfc56: { accent: '#f2f2f2' }, // white fuselage band
  rfc60: { accent: '#2f4f9a' },
  rfc74: { accent: '#f2f2f2', tail: '#5a5436' },
  rfc85: { accent: '#161616' },
  rnas3: { cowling: '#b9bbba' },
  rnas8: { cowling: '#b9bbba' },
  rnas10: { cowling: '#161616' }, // "Black Flight" noses
  spa3: { accent: '#1e2a6b' }, // stork insignia squadrons
  spa103: { accent: '#1e2a6b' },
  n65: { accent: '#b3261e' },
  n124: { accent: '#b3261e' }, // Sioux head
  us94: { accent: '#b3261e', cowling: '#e8e2d0' }, // Hat in the Ring
  us95: { accent: '#161616' }, // kicking mule
  us27: { accent: '#e0b02a' }, // eagle
  us103: { accent: '#b3261e' },
  us147: { accent: '#2f4f9a' }, // ratter terrier
  us17: { accent: '#f2f2f2', insignia: 'roundel-rfc' }, // flew as part of the RAF
  us148: { accent: '#f2f2f2', insignia: 'roundel-rfc' },
};

/** Famous personal colours, keyed by ace id. */
export const ACE_LIVERIES: Record<string, Partial<Livery>> = {
  mvr: { fuselage: '#b01e1e', wingTop: '#b01e1e', wingBottom: '#b01e1e', tail: '#b01e1e', cowling: '#b01e1e', accent: '#b01e1e', pattern: 'plain' },
  lothar: { fuselage: '#b01e1e', tail: '#e3bf1c', accent: '#e3bf1c' },
  wolff: { fuselage: '#b01e1e', tail: '#3d6b3a' },
  allmenroder: { fuselage: '#b01e1e', cowling: '#f2f2f2' },
  voss: { cowling: '#d8b14a', accent: '#d8b14a', marking: 'face' },
  udet: { fuselage: '#b3261e', wingTop: '#b3261e', pattern: 'stripes', marking: 'LO!' },
  goering: { fuselage: '#f2f2f2', tail: '#f2f2f2', cowling: '#f2f2f2', accent: '#f2f2f2' },
  lowenhardt: { tail: '#e3bf1c', cowling: '#e3bf1c' },
  loerzer: { fuselage: '#1b1b1b', accent: '#f2f2f2', pattern: 'stripes' },
  ball: { cowling: '#c81e1e', accent: '#c81e1e' },
  bishop: { cowling: '#2f4f9a', accent: '#2f4f9a' },
  mccudden: { accent: '#c81e1e', marking: 'G' },
  mannock: { marking: 'D' },
  collishaw: { cowling: '#161616', fuselage: '#2a2a22', marking: 'BLACK MARIA' },
  guynemer: { marking: 'Vieux Charles' },
  fonck: { accent: '#1e2a6b' },
  nungesser: { marking: 'N' },
  rickenbacker: { marking: '1' },
  luke: { accent: '#e0b02a' },
};

export function factoryFinish(aircraftId: AircraftId): Finish {
  return FACTORY[aircraftId] ?? CLEAR_LINEN;
}

export interface LiveryLayers {
  aircraftId: AircraftId;
  nation: Nation;
  date: string;
  squadronId?: string;
  aceId?: string;
  personal?: Partial<Livery>;
  marking?: string;
}

/** Compose the final livery for one machine. */
export function composeLivery(l: LiveryLayers): Livery {
  const squadron = l.squadronId ? SQUADRON_LIVERY_OVERRIDES[l.squadronId] ?? {} : {};
  const ace = l.aceId ? ACE_LIVERIES[l.aceId] ?? {} : {};
  const merged: Partial<Livery> = { ...factoryFinish(l.aircraftId), ...squadron, ...ace, ...(l.personal ?? {}) };
  const insignia = squadron.insignia ?? nationalInsignia(l.nation, l.date);
  return {
    fuselage: merged.fuselage!,
    wingTop: merged.wingTop!,
    wingBottom: merged.wingBottom!,
    tail: merged.tail!,
    cowling: merged.cowling!,
    accent: merged.accent!,
    pattern: merged.pattern,
    insignia,
    marking: ace.marking ?? l.personal?.marking ?? l.marking,
  };
}
