/**
 * Display catalog: how the UI names and draws ranks, medals and aces.
 *
 * The campaign module owns the authoritative data (src/data/ranks.ts,
 * medals.ts, aces.ts). The UI ships sensible defaults keyed by the ids it
 * expects and falls back to prettified ids for anything unknown; the
 * integrator can override/extend with `setUiCatalog()` so the UI never
 * blocks on the campaign data shape.
 */
import type { Nation } from '../core/types';
import { prettifyId } from './format';

export interface RankDisplay {
  title: string;
  abbrev: string;
}

export type MedalShape = 'cross-patee' | 'maltese' | 'cross' | 'star' | 'disc' | 'cross-flory';

export interface MedalDisplay {
  name: string;
  nation: Nation;
  /** Ribbon stripes, left to right, as [colour, relativeWidth]. */
  ribbon: [string, number][];
  shape: MedalShape;
  /** Medal body fill and rim. */
  metal: string;
  enamel?: string;
  /** Precedence: higher is more senior (drawn first in ribbon bars). */
  precedence: number;
  description?: string;
}

export interface AceDisplay {
  id: string;
  name: string;
  nation: Nation;
  victories: number;
  /** Nickname for flavour, e.g. "The Red Baron". */
  epithet?: string;
  aircraft?: string;
}

export interface UiCatalog {
  ranks: Record<string, RankDisplay>;
  medals: Record<string, MedalDisplay>;
  aces: AceDisplay[];
}

const BLACK = '#161412';
const WHITE = '#f2ede0';

const DEFAULT_MEDALS: Record<string, MedalDisplay> = {
  'iron-cross-2': { name: 'Iron Cross, 2nd Class', nation: 'germany', ribbon: [[BLACK, 2], [WHITE, 1], [BLACK, 4], [WHITE, 1], [BLACK, 2]], shape: 'cross-patee', metal: '#c8c8c0', enamel: BLACK, precedence: 10 },
  'iron-cross-1': { name: 'Iron Cross, 1st Class', nation: 'germany', ribbon: [[BLACK, 2], [WHITE, 1], [BLACK, 4], [WHITE, 1], [BLACK, 2]], shape: 'cross-patee', metal: '#d8d8d0', enamel: BLACK, precedence: 20 },
  'hohenzollern': { name: 'Knight\'s Cross of the House Order of Hohenzollern', nation: 'germany', ribbon: [[WHITE, 1], [BLACK, 1], [WHITE, 4], [BLACK, 1], [WHITE, 1]], shape: 'cross', metal: '#d4b25a', enamel: WHITE, precedence: 40 },
  'pour-le-merite': { name: 'Pour le Mérite', nation: 'germany', ribbon: [[WHITE, 1], [BLACK, 1], [WHITE, 0.6], [BLACK, 5], [WHITE, 0.6], [BLACK, 1], [WHITE, 1]], shape: 'maltese', metal: '#d4b25a', enamel: '#2b4fa8', precedence: 90, description: 'The "Blue Max": Prussia\'s highest order for merit, awarded to aces of 16 (later 20) or more victories.' },
  'military-cross': { name: 'Military Cross', nation: 'britain', ribbon: [[WHITE, 3], ['#5b2a86', 3], [WHITE, 3]], shape: 'cross', metal: '#cfcfc8', precedence: 30 },
  'dfc': { name: 'Distinguished Flying Cross', nation: 'britain', ribbon: [['#5b2a86', 1], [WHITE, 0.5], ['#5b2a86', 1], [WHITE, 0.5], ['#5b2a86', 1], [WHITE, 0.5], ['#5b2a86', 1]], shape: 'cross-flory', metal: '#cfcfc8', precedence: 35 },
  'dso': { name: 'Distinguished Service Order', nation: 'britain', ribbon: [['#2b3f8f', 1], ['#b02030', 6], ['#2b3f8f', 1]], shape: 'cross', metal: '#d4b25a', enamel: WHITE, precedence: 60 },
  'victoria-cross': { name: 'Victoria Cross', nation: 'britain', ribbon: [['#7a1f2b', 1]], shape: 'cross-patee', metal: '#8b6a3e', precedence: 100, description: '"For Valour": the highest award for gallantry in the face of the enemy.' },
  'croix-de-guerre': { name: 'Croix de Guerre', nation: 'france', ribbon: [['#2f7a3a', 1], ['#b02030', 0.3], ['#2f7a3a', 1], ['#b02030', 0.3], ['#2f7a3a', 1], ['#b02030', 0.3], ['#2f7a3a', 1]], shape: 'cross-patee', metal: '#9b7b4a', precedence: 20 },
  'medaille-militaire': { name: 'Médaille Militaire', nation: 'france', ribbon: [['#2f7a3a', 1], ['#e5c24a', 5], ['#2f7a3a', 1]], shape: 'disc', metal: '#cfcfc8', precedence: 40 },
  'legion-honneur': { name: 'Légion d\'Honneur', nation: 'france', ribbon: [['#b02030', 1]], shape: 'star', metal: '#cfcfc8', enamel: WHITE, precedence: 80 },
  'dsc-us': { name: 'Distinguished Service Cross', nation: 'usa', ribbon: [['#b02030', 0.6], [WHITE, 0.4], ['#23408e', 5], [WHITE, 0.4], ['#b02030', 0.6]], shape: 'cross', metal: '#9b7b4a', precedence: 60 },
  'medal-of-honor': { name: 'Medal of Honor', nation: 'usa', ribbon: [['#4a7fc0', 1]], shape: 'star', metal: '#d4b25a', precedence: 100 },
};

const DEFAULT_RANKS: Record<string, RankDisplay> = {
  // German
  'flieger': { title: 'Flieger', abbrev: 'Flg.' },
  'gefreiter': { title: 'Gefreiter', abbrev: 'Gefr.' },
  'unteroffizier': { title: 'Unteroffizier', abbrev: 'Uffz.' },
  'vizefeldwebel': { title: 'Vizefeldwebel', abbrev: 'Vzfw.' },
  'leutnant': { title: 'Leutnant', abbrev: 'Ltn.' },
  'oberleutnant': { title: 'Oberleutnant', abbrev: 'Oblt.' },
  'rittmeister': { title: 'Rittmeister', abbrev: 'Rittm.' },
  'hauptmann': { title: 'Hauptmann', abbrev: 'Hptm.' },
  // British
  'second-lieutenant': { title: 'Second Lieutenant', abbrev: '2/Lt.' },
  'lieutenant': { title: 'Lieutenant', abbrev: 'Lt.' },
  'captain': { title: 'Captain', abbrev: 'Capt.' },
  'major': { title: 'Major', abbrev: 'Maj.' },
  'lieutenant-colonel': { title: 'Lieutenant-Colonel', abbrev: 'Lt.Col.' },
  // French
  'sergent': { title: 'Sergent', abbrev: 'Sgt.' },
  'adjudant': { title: 'Adjudant', abbrev: 'Adj.' },
  'sous-lieutenant': { title: 'Sous-Lieutenant', abbrev: 'S/Lt.' },
  'capitaine': { title: 'Capitaine', abbrev: 'Cne.' },
  'commandant': { title: 'Commandant', abbrev: 'Cdt.' },
  // American
  'first-lieutenant': { title: 'First Lieutenant', abbrev: '1st Lt.' },
};

const DEFAULT_ACES: AceDisplay[] = [
  { id: 'richthofen', name: 'Manfred von Richthofen', nation: 'germany', victories: 80, epithet: 'The Red Baron', aircraft: 'Fokker Dr.I' },
  { id: 'udet', name: 'Ernst Udet', nation: 'germany', victories: 62, aircraft: 'Fokker D.VII' },
  { id: 'loewenhardt', name: 'Erich Löwenhardt', nation: 'germany', victories: 54, aircraft: 'Fokker D.VII' },
  { id: 'voss', name: 'Werner Voss', nation: 'germany', victories: 48, aircraft: 'Fokker Dr.I' },
  { id: 'boelcke', name: 'Oswald Boelcke', nation: 'germany', victories: 40, epithet: 'Father of air fighting', aircraft: 'Albatros D.II' },
  { id: 'immelmann', name: 'Max Immelmann', nation: 'germany', victories: 15, epithet: 'The Eagle of Lille', aircraft: 'Fokker E.III' },
  { id: 'fonck', name: 'René Fonck', nation: 'france', victories: 75, aircraft: 'SPAD XIII' },
  { id: 'guynemer', name: 'Georges Guynemer', nation: 'france', victories: 53, aircraft: 'SPAD VII' },
  { id: 'nungesser', name: 'Charles Nungesser', nation: 'france', victories: 43, aircraft: 'Nieuport 17' },
  { id: 'mannock', name: 'Edward "Mick" Mannock', nation: 'britain', victories: 61, aircraft: 'S.E.5a' },
  { id: 'bishop', name: 'William "Billy" Bishop', nation: 'britain', victories: 72, aircraft: 'S.E.5a' },
  { id: 'collishaw', name: 'Raymond Collishaw', nation: 'britain', victories: 60, aircraft: 'Sopwith Triplane' },
  { id: 'mccudden', name: 'James McCudden', nation: 'britain', victories: 57, aircraft: 'S.E.5a' },
  { id: 'ball', name: 'Albert Ball', nation: 'britain', victories: 44, aircraft: 'Nieuport 17' },
  { id: 'hawker', name: 'Lanoe Hawker', nation: 'britain', victories: 7, aircraft: 'Airco D.H.2' },
  { id: 'rickenbacker', name: 'Eddie Rickenbacker', nation: 'usa', victories: 26, epithet: 'Ace of Aces', aircraft: 'SPAD XIII' },
  { id: 'luke', name: 'Frank Luke', nation: 'usa', victories: 18, epithet: 'The Arizona Balloon Buster', aircraft: 'SPAD XIII' },
  { id: 'lufbery', name: 'Raoul Lufbery', nation: 'usa', victories: 17, aircraft: 'Nieuport 28' },
];

let catalog: UiCatalog = { ranks: { ...DEFAULT_RANKS }, medals: { ...DEFAULT_MEDALS }, aces: [...DEFAULT_ACES] };

/** Merge overrides into the display catalog (aces replace the list when given). */
export function setUiCatalog(over: Partial<UiCatalog>): void {
  catalog = {
    ranks: { ...catalog.ranks, ...over.ranks },
    medals: { ...catalog.medals, ...over.medals },
    aces: over.aces ?? catalog.aces,
  };
}

export function getUiCatalog(): UiCatalog {
  return catalog;
}

export function rankDisplay(rankId: string): RankDisplay {
  const r = catalog.ranks[rankId];
  if (r) return r;
  const title = prettifyId(rankId);
  return { title, abbrev: title };
}

function hashColour(id: string, salt: number): string {
  let h = salt;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% ${35 + (h % 20)}%)`;
}

export function medalDisplay(medalId: string, nation: Nation = 'britain'): MedalDisplay {
  return (
    catalog.medals[medalId] ?? {
      name: prettifyId(medalId),
      nation,
      ribbon: [[hashColour(medalId, 7), 2], [hashColour(medalId, 13), 1], [hashColour(medalId, 7), 2]],
      shape: 'disc',
      metal: '#b89a60',
      precedence: 0,
    }
  );
}

export function aceDisplay(aceId: string | undefined): AceDisplay | undefined {
  return aceId ? catalog.aces.find((a) => a.id === aceId) : undefined;
}

export const NATION_INFO: Record<Nation, { service: string; adjective: string; short: string; blurb: string; motto: string }> = {
  germany: {
    service: 'Luftstreitkräfte',
    adjective: 'German',
    short: 'Germany',
    blurb: 'The Imperial German Air Service. Fight mostly over your own lines, where victories are easier to confirm and a forced landing need not mean captivity. Jagdstaffeln hunt in packs; outnumbered, but often better equipped.',
    motto: 'Gott mit uns',
  },
  britain: {
    service: 'Royal Flying Corps',
    adjective: 'British',
    short: 'Britain',
    blurb: 'The RFC (and from April 1918 the Royal Air Force) carries the war to the enemy: offensive patrols deep over German lines, into the prevailing westerly wind. Heavy losses, dogged spirit.',
    motto: 'Per ardua ad astra',
  },
  france: {
    service: 'Aéronautique Militaire',
    adjective: 'French',
    short: 'France',
    blurb: 'The birthplace of the fighter pilot and the "ace". The escadrilles de chasse fly Nieuports and SPADs, and the Cigognes of Groupe de Combat 12 are the elite of the service.',
    motto: 'Honneur et Patrie',
  },
  usa: {
    service: 'U.S. Air Service',
    adjective: 'American',
    short: 'United States',
    blurb: 'Latecomers with something to prove. The Aero Squadrons of the AEF arrive at the front in 1918, green but eager, flying French-built Nieuports and SPADs and British Camels.',
    motto: 'Hat in the Ring',
  },
};

/**
 * The air service's name as it stood on `date`: the RFC and RNAS merged into the
 * Royal Air Force on 1 April 1918; the German Fliegertruppe became the
 * Luftstreitkräfte on 8 October 1916. `squadronId` distinguishes naval squadrons.
 */
export function serviceName(nation: Nation, date?: string, squadronId?: string): string {
  if (!date) return NATION_INFO[nation].service;
  if (nation === 'britain') {
    if (date >= '1918-04-01') return 'Royal Air Force';
    return squadronId?.startsWith('rnas') ? 'Royal Naval Air Service' : 'Royal Flying Corps';
  }
  if (nation === 'germany' && date < '1916-10-08') return 'Die Fliegertruppe';
  return NATION_INFO[nation].service;
}

/** Period highlights for the pilot-creation date slider. */
export const WAR_PERIODS: { from: string; title: string; text: string }[] = [
  { from: '1915-07-01', title: 'The Fokker Scourge', text: 'The Eindecker\'s synchronised gun makes Allied two-seaters "Fokker fodder". Immelmann and Boelcke write the first rules of air fighting.' },
  { from: '1916-02-01', title: 'The Tide Turns', text: 'D.H.2 pushers and nimble Nieuports end the Fokker\'s reign. Over the Somme the Allies win control of the air.' },
  { from: '1916-07-01', title: 'Battle of the Somme', text: 'The greatest battle yet. The RFC flies relentlessly over the lines; in September Boelcke\'s new Jagdstaffel 2 arrives with the Albatros.' },
  { from: '1917-01-01', title: 'The Albatros Ascendancy', text: 'Twin-gunned Albatros scouts outclass the Allied machines. Richthofen takes command of Jasta 11 at Douai.' },
  { from: '1917-04-01', title: 'Bloody April', text: 'Over Arras the RFC loses a third of its strength in a month. The average life of a new British pilot is counted in days.' },
  { from: '1917-06-01', title: 'Messines and the Flying Circus', text: 'Messines Ridge is blown on 7 June. The S.E.5a and Camel reach the front, and Richthofen\'s new Jagdgeschwader I - the Flying Circus - hunts over Flanders.' },
  { from: '1917-07-31', title: 'Third Ypres', text: 'The Flanders offensive grinds towards Passchendaele through rain and mud. Low-flying scouts support the infantry; the sky is contested daily.' },
  { from: '1917-11-20', title: 'Cambrai', text: 'Tanks break the Hindenburg Line; low-flying scouts strafe trenches in fog and rain. The first Fokker Dr.I triplanes join the Flying Circus.' },
  { from: '1918-03-21', title: 'The Kaiserschlacht', text: 'Germany\'s great spring offensive drives west towards Amiens. Aerodromes are overrun; the Red Baron falls on 21 April.' },
  { from: '1918-08-08', title: 'The Hundred Days', text: 'The Allied counter-offensive begins at Amiens. The Fokker D.VII is formidable, but fuel and pilots are running out.' },
];

export function warPeriodFor(date: string): (typeof WAR_PERIODS)[number] {
  let p = WAR_PERIODS[0];
  for (const w of WAR_PERIODS) if (w.from <= date) p = w;
  return p;
}

export const FIRST_NAMES: Record<Nation, string[]> = {
  germany: ['Karl', 'Otto', 'Hans', 'Friedrich', 'Wilhelm', 'Ernst', 'Kurt', 'Heinrich', 'Walter', 'Paul', 'Erich', 'Fritz'],
  britain: ['Arthur', 'Cecil', 'Harold', 'Reginald', 'William', 'Albert', 'George', 'Edward', 'Thomas', 'Frederick', 'Leonard', 'Percy'],
  france: ['Georges', 'René', 'Charles', 'Jean', 'Marcel', 'Henri', 'Louis', 'Pierre', 'Armand', 'Gaston', 'Maurice', 'Lucien'],
  usa: ['Eddie', 'Frank', 'Douglas', 'Elliott', 'Reed', 'James', 'Harold', 'Lawrence', 'Raoul', 'Hamilton', 'David', 'Walter'],
};

export const LAST_NAMES: Record<Nation, string[]> = {
  germany: ['Hartmann', 'Weber', 'von Lindau', 'Krüger', 'Schäfer', 'Brandt', 'von Arnim', 'Neumann', 'Vogel', 'Keller', 'Baumer', 'Lorenz'],
  britain: ['Ashworth', 'Bellamy', 'Carrington', 'Fairfax', 'Hawkins', 'Pemberton', 'Thornton', 'Whitcombe', 'Harrow', 'Leighton', 'Marsh', 'Tennant'],
  france: ['Dubois', 'Lefèvre', 'Moreau', 'Girard', 'Laurent', 'Rousseau', 'Chevalier', 'Mercier', 'Garnier', 'Fontaine', 'Blanchard', 'Vidal'],
  usa: ['Carter', 'Holden', 'Mitchell', 'Sullivan', 'Bradford', 'Winslow', 'Harper', 'Coleman', 'Dawson', 'Whitaker', 'Fletcher', 'Prescott'],
};
