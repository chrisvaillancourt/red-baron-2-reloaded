/**
 * Historical aces. Victory tallies are piecewise-linear through dated
 * milestones (approximate), frozen at the ace's fate. Service periods map to
 * squadrons in ./squadrons.ts; `squadronId: null` means serving with a unit
 * outside the game (elsewhere on the front) — such periods count for the
 * standings but the ace never appears in the sky.
 */
import type { AircraftId, Nation, SkillLevel } from '../core/types';

export interface AceService {
  from: string;
  to: string;
  squadronId: string | null;
  aircraft: AircraftId[];
}

export interface AceFate {
  /** killed / captured end the ace's war; 'retired' = left the front (wounds, staff post) but survived. */
  kind: 'killed' | 'captured' | 'retired' | 'survived';
  date?: string;
  note: string;
}

export interface Ace {
  id: string;
  firstName: string;
  lastName: string;
  /** Full display name with rank, e.g. "Rittmeister Manfred Freiherr von Richthofen". */
  displayName: string;
  /** Short roster/HUD form, e.g. "Rittm. von Richthofen". */
  shortName: string;
  nickname?: string;
  nation: Nation;
  skill: SkillLevel;
  service: AceService[];
  /** Dated milestones [ISO date, cumulative victories], ascending. */
  victories: [string, number][];
  fate: AceFate;
  bio: string;
  /**
   * Rank history, ascending; the last entry must be the rank that prefixes `displayName` /
   * `shortName`. Absent = the pilot held that rank throughout the game's span.
   */
  ranks?: AceRankStep[];
  /** Post-nominal honours appended from their award (gazette) date, e.g. " VC". */
  honours?: { from: string; text: string }[];
}

export interface AceRankStep {
  from: string;
  title: string;
  abbrev: string;
}

const rk = (from: string, title: string, abbrev: string): AceRankStep => ({ from, title, abbrev });

/**
 * An ace's names as they stood on `date`: "Captain William Bishop" in June 1917, not the
 * "Major William Bishop VC" he became. Falls back to the static names when no history is given.
 */
export function aceNamesOn(ace: Ace, date: string): { display: string; short: string } {
  let display = ace.displayName;
  let short = ace.shortName;
  const final = ace.ranks?.[ace.ranks.length - 1];
  if (ace.ranks && final && display.startsWith(`${final.title} `) && short.startsWith(`${final.abbrev} `)) {
    const current = [...ace.ranks].reverse().find((r) => r.from <= date) ?? ace.ranks[0];
    display = `${current.title} ${display.slice(final.title.length + 1)}`;
    short = `${current.abbrev} ${short.slice(final.abbrev.length + 1)}`;
  }
  for (const hon of ace.honours ?? []) if (hon.from <= date) display += hon.text;
  return { display, short };
}

const svc =(from: string, to: string, squadronId: string | null, ...aircraft: AircraftId[]): AceService => ({ from, to, squadronId, aircraft });

export const ACES: readonly Ace[] = [
  // ============================================================== Germany
  {
    id: 'mvr', firstName: 'Manfred', lastName: 'von Richthofen', displayName: 'Rittmeister Manfred Freiherr von Richthofen', shortName: 'Rittm. von Richthofen',
    ranks: [rk('1914-01-01', 'Leutnant', 'Ltn.'), rk('1917-03-22', 'Oberleutnant', 'Oblt.'), rk('1917-04-06', 'Rittmeister', 'Rittm.')],
    nickname: 'The Red Baron', nation: 'germany', skill: 'ace',
    service: [
      svc('1916-09-01', '1917-01-14', 'jasta2', 'albatros_dii'),
      svc('1917-01-15', '1917-06-23', 'jasta11', 'albatros_diii'),
      svc('1917-06-24', '1917-08-31', 'jasta11', 'albatros_dv'),
      svc('1917-09-01', '1918-04-21', 'jasta11', 'fokker_dri'),
    ],
    victories: [['1916-09-17', 1], ['1916-11-23', 11], ['1917-01-04', 16], ['1917-03-31', 31], ['1917-04-30', 52], ['1917-07-06', 57], ['1917-09-03', 61], ['1917-11-30', 63], ['1918-03-27', 73], ['1918-04-20', 80]],
    fate: { kind: 'killed', date: '1918-04-21', note: 'Killed over Morlancourt Ridge, near Vaux-sur-Somme, by ground fire.' },
    bio: 'The ace of aces of the Great War with 80 victories. Commander of Jasta 11 and then of Jagdgeschwader I, the "Flying Circus".',
  },
  {
    id: 'lothar', firstName: 'Lothar', lastName: 'von Richthofen', displayName: 'Leutnant Lothar Freiherr von Richthofen', shortName: 'Ltn. L. von Richthofen',
    nation: 'germany', skill: 'ace',
    service: [
      // Gaps are his three spells in hospital (wounded 13 May 1917 and 13 March 1918).
      svc('1917-03-06', '1917-05-13', 'jasta11', 'albatros_diii'),
      svc('1917-09-24', '1917-12-31', 'jasta11', 'albatros_dv'),
      svc('1918-01-01', '1918-03-13', 'jasta11', 'fokker_dri'),
      svc('1918-07-19', '1918-08-13', 'jasta11', 'fokker_dvii'),
    ],
    victories: [['1917-03-28', 1], ['1917-05-13', 24], ['1918-03-12', 29], ['1918-07-19', 33], ['1918-08-12', 40]],
    fate: { kind: 'retired', date: '1918-08-13', note: 'Wounded for the third time; survived the war.' },
    bio: 'Manfred\'s younger brother: a hunter rather than a marksman, with 40 victories.',
  },
  {
    id: 'boelcke', firstName: 'Oswald', lastName: 'Boelcke', displayName: 'Hauptmann Oswald Boelcke', shortName: 'Hptm. Boelcke',
    ranks: [rk('1914-01-01', 'Oberleutnant', 'Oblt.'), rk('1916-05-22', 'Hauptmann', 'Hptm.')],
    nickname: 'Father of air fighting', nation: 'germany', skill: 'ace',
    service: [svc('1915-07-01', '1916-06-30', 'ffa62', 'fokker_eiii'), svc('1916-08-27', '1916-10-28', 'jasta2', 'albatros_dii')],
    victories: [['1915-07-04', 1], ['1916-01-12', 8], ['1916-06-27', 19], ['1916-09-02', 20], ['1916-10-26', 40]],
    fate: { kind: 'killed', date: '1916-10-28', note: 'Killed in a collision with his friend Erwin Böhme during a dogfight.' },
    bio: 'Author of the "Dicta Boelcke", the first rules of air combat, and founder of Jasta 2.',
  },
  {
    id: 'immelmann', firstName: 'Max', lastName: 'Immelmann', displayName: 'Oberleutnant Max Immelmann', shortName: 'Oblt. Immelmann',
    nickname: 'The Eagle of Lille', nation: 'germany', skill: 'ace',
    service: [svc('1915-08-01', '1916-06-18', 'ffa62', 'fokker_eiii')],
    victories: [['1915-08-01', 1], ['1916-01-12', 8], ['1916-06-18', 15]],
    fate: { kind: 'killed', date: '1916-06-18', note: 'Killed near Sallaumines fighting F.E.2bs of No. 25 Squadron.' },
    bio: 'Eindecker pioneer and namesake of the Immelmann turn.',
  },
  {
    id: 'voss', firstName: 'Werner', lastName: 'Voss', displayName: 'Leutnant Werner Voss', shortName: 'Ltn. Voss',
    nickname: 'The Hussar of Krefeld', nation: 'germany', skill: 'ace',
    service: [
      svc('1916-11-21', '1917-01-31', 'jasta2', 'albatros_dii'),
      svc('1917-02-01', '1917-05-19', 'jasta2', 'albatros_diii'),
      svc('1917-05-20', '1917-06-29', 'jasta5', 'albatros_diii'),
      svc('1917-06-30', '1917-07-29', null, 'albatros_dv'),
      svc('1917-07-30', '1917-08-28', 'jasta10', 'albatros_dv'),
      svc('1917-08-29', '1917-09-23', 'jasta10', 'fokker_dri'),
    ],
    victories: [['1916-11-27', 1], ['1917-04-06', 24], ['1917-06-06', 34], ['1917-08-15', 38], ['1917-09-23', 48]],
    fate: { kind: 'killed', date: '1917-09-23', note: 'Killed in a legendary ten-minute fight against seven S.E.5as of No. 56 Squadron.' },
    bio: 'Richthofen\'s greatest rival for the German lead, a brilliant natural flyer.',
  },
  {
    id: 'wolff', firstName: 'Kurt', lastName: 'Wolff', displayName: 'Oberleutnant Kurt Wolff', shortName: 'Oblt. Wolff',
    nation: 'germany', skill: 'ace',
    service: [svc('1917-03-01', '1917-08-31', 'jasta11', 'albatros_diii'), svc('1917-09-01', '1917-09-15', 'jasta11', 'fokker_dri')],
    victories: [['1917-03-06', 1], ['1917-04-30', 29], ['1917-05-07', 33]],
    fate: { kind: 'killed', date: '1917-09-15', note: 'Shot down by a Sopwith Camel of Naval 10 over Wervik.' },
    bio: 'A slight, gentle man who scored 22 victories in Bloody April alone.',
  },
  {
    id: 'allmenroder', firstName: 'Karl', lastName: 'Allmenröder', displayName: 'Leutnant Karl Allmenröder', shortName: 'Ltn. Allmenröder',
    nation: 'germany', skill: 'veteran',
    service: [svc('1916-11-01', '1917-01-31', 'jasta11', 'albatros_dii'), svc('1917-02-01', '1917-06-27', 'jasta11', 'albatros_diii')],
    victories: [['1917-02-16', 1], ['1917-04-30', 9], ['1917-06-26', 30]],
    fate: { kind: 'killed', date: '1917-06-27', note: 'Shot down near Zillebeke, possibly by Collishaw of Naval 10.' },
    bio: 'A medical student turned fighter pilot who led Jasta 11 in Richthofen\'s absence.',
  },
  {
    id: 'udet', firstName: 'Ernst', lastName: 'Udet', displayName: 'Oberleutnant Ernst Udet', shortName: 'Oblt. Udet',
    ranks: [rk('1914-01-01', 'Leutnant', 'Ltn.'), rk('1918-04-01', 'Oberleutnant', 'Oblt.')],
    nation: 'germany', skill: 'ace',
    service: [
      svc('1916-03-18', '1918-03-22', null, 'albatros_diii'),
      svc('1918-03-23', '1918-05-19', 'jasta11', 'fokker_dri'),
      svc('1918-05-20', '1918-09-26', 'jasta4', 'fokker_dvii'),
    ],
    victories: [['1916-03-18', 1], ['1917-01-01', 6], ['1918-03-22', 20], ['1918-05-01', 23], ['1918-06-30', 40], ['1918-09-26', 62]],
    fate: { kind: 'retired', date: '1918-09-27', note: 'Wounded in the thigh; survived the war as Germany\'s highest-scoring surviving ace.' },
    bio: 'A cheerful stunt pilot and the second-ranking German ace. His D.VII bore "Du doch nicht!!" on the tail and "LO!" on the fuselage.',
  },
  {
    id: 'goering', firstName: 'Hermann', lastName: 'Göring', displayName: 'Oberleutnant Hermann Göring', shortName: 'Oblt. Göring',
    nation: 'germany', skill: 'veteran',
    service: [
      svc('1917-02-01', '1917-06-30', 'jasta26', 'albatros_diii'),
      svc('1917-07-01', '1918-05-31', 'jasta27', 'albatros_dv'),
      svc('1918-06-01', '1918-07-07', 'jasta27', 'fokker_dvii'),
      svc('1918-07-08', '1918-11-11', 'jasta11', 'fokker_dvii'),
    ],
    victories: [['1915-11-16', 1], ['1917-02-01', 5], ['1917-12-31', 15], ['1918-07-08', 21], ['1918-07-18', 22]],
    fate: { kind: 'survived', note: 'Last commander of Jagdgeschwader I.' },
    bio: 'Commander of Jasta 27 and, from July 1918, of Richthofen\'s Jagdgeschwader I. Flew an all-white Fokker D.VII.',
  },
  {
    id: 'gontermann', firstName: 'Heinrich', lastName: 'Gontermann', displayName: 'Leutnant Heinrich Gontermann', shortName: 'Ltn. Gontermann',
    nation: 'germany', skill: 'ace',
    service: [svc('1916-11-01', '1917-01-31', 'jasta5', 'albatros_dii'), svc('1917-02-01', '1917-04-30', 'jasta5', 'albatros_diii'), svc('1917-05-01', '1917-10-30', null, 'albatros_dv')],
    victories: [['1916-11-14', 1], ['1917-04-30', 17], ['1917-10-19', 39]],
    fate: { kind: 'killed', date: '1917-10-30', note: 'Killed when the upper wing of his Fokker Dr.I failed.' },
    bio: 'A deadly balloon-buster: 18 of his 39 victories were observation balloons.',
  },
  {
    id: 'rumey', firstName: 'Fritz', lastName: 'Rumey', displayName: 'Leutnant Fritz Rumey', shortName: 'Ltn. Rumey',
    nation: 'germany', skill: 'ace',
    service: [svc('1917-07-10', '1918-05-31', 'jasta5', 'albatros_dv'), svc('1918-06-01', '1918-09-27', 'jasta5', 'fokker_dvii')],
    victories: [['1917-07-06', 1], ['1918-01-01', 8], ['1918-06-01', 29], ['1918-09-27', 45]],
    fate: { kind: 'killed', date: '1918-09-27', note: 'Collided with an S.E.5a of No. 32 Squadron; his parachute failed.' },
    bio: 'A former NCO who rose through the ranks to become Jasta 5\'s top scorer.',
  },
  {
    id: 'mai', firstName: 'Josef', lastName: 'Mai', displayName: 'Leutnant Josef Mai', shortName: 'Ltn. Mai',
    nation: 'germany', skill: 'veteran',
    service: [svc('1917-07-01', '1918-05-31', 'jasta5', 'albatros_dv'), svc('1918-06-01', '1918-11-11', 'jasta5', 'fokker_dvii')],
    victories: [['1917-11-20', 1], ['1918-05-01', 11], ['1918-09-30', 30]],
    fate: { kind: 'survived', note: 'Survived the war.' },
    bio: 'Flew a D.VII with a black-and-white striped fuselage.',
  },
  {
    id: 'konnecke', firstName: 'Otto', lastName: 'Könnecke', displayName: 'Leutnant Otto Könnecke', shortName: 'Ltn. Könnecke',
    nation: 'germany', skill: 'veteran',
    service: [svc('1917-02-01', '1918-01-31', null, 'albatros_diii'), svc('1918-02-01', '1918-05-31', 'jasta5', 'albatros_dv'), svc('1918-06-01', '1918-11-11', 'jasta5', 'fokker_dvii')],
    victories: [['1917-02-05', 1], ['1918-02-01', 8], ['1918-09-26', 35]],
    fate: { kind: 'survived', note: 'Survived the war.' },
    bio: 'One of the celebrated "three musketeers" of Jasta 5 with Rumey and Mai.',
  },
  {
    id: 'lowenhardt', firstName: 'Erich', lastName: 'Löwenhardt', displayName: 'Oberleutnant Erich Löwenhardt', shortName: 'Oblt. Löwenhardt',
    ranks: [rk('1914-01-01', 'Leutnant', 'Ltn.'), rk('1918-04-01', 'Oberleutnant', 'Oblt.')],
    nation: 'germany', skill: 'ace',
    service: [
      svc('1917-03-01', '1917-06-30', 'jasta10', 'albatros_diii'),
      svc('1917-07-01', '1918-02-28', 'jasta10', 'albatros_dv'),
      svc('1918-03-01', '1918-05-31', 'jasta10', 'fokker_dri'),
      svc('1918-06-01', '1918-08-10', 'jasta10', 'fokker_dvii'),
    ],
    victories: [['1917-03-24', 1], ['1917-12-31', 9], ['1918-03-30', 15], ['1918-06-01', 24], ['1918-08-09', 54]],
    fate: { kind: 'killed', date: '1918-08-10', note: 'Collided with a Jasta 11 pilot; his parachute failed.' },
    bio: 'Third-ranking German ace, leader of Jasta 10\'s yellow-nosed machines.',
  },
  {
    id: 'wusthoff', firstName: 'Kurt', lastName: 'Wüsthoff', displayName: 'Leutnant Kurt Wüsthoff', shortName: 'Ltn. Wüsthoff',
    nation: 'germany', skill: 'veteran',
    service: [svc('1917-06-01', '1917-12-31', 'jasta4', 'albatros_dv'), svc('1918-01-01', '1918-03-16', 'jasta4', 'fokker_dri')],
    victories: [['1917-06-15', 1], ['1917-12-31', 26], ['1918-03-16', 27]],
    fate: { kind: 'captured', date: '1918-06-17', note: 'Shot down and captured after a fight with S.E.5as.' },
    bio: 'At 20 the youngest Staffelführer in the Luftstreitkräfte.',
  },
  {
    id: 'kirschstein', firstName: 'Hans', lastName: 'Kirschstein', displayName: 'Leutnant Hans Kirschstein', shortName: 'Ltn. Kirschstein',
    nation: 'germany', skill: 'veteran',
    service: [svc('1918-03-01', '1918-05-31', 'jasta6', 'fokker_dri'), svc('1918-06-01', '1918-07-16', 'jasta6', 'fokker_dvii')],
    victories: [['1918-03-10', 1], ['1918-06-24', 27]],
    fate: { kind: 'killed', date: '1918-07-16', note: 'Killed as a passenger in a two-seater crash.' },
    bio: 'Scored 27 victories in barely three months with Jasta 6.',
  },
  {
    id: 'baumer', firstName: 'Paul', lastName: 'Bäumer', displayName: 'Leutnant Paul Bäumer', shortName: 'Ltn. Bäumer',
    nickname: 'The Iron Eagle', nation: 'germany', skill: 'ace',
    service: [svc('1917-08-15', '1917-12-31', 'jasta2', 'albatros_dv'), svc('1918-01-01', '1918-05-15', 'jasta2', 'fokker_dri'), svc('1918-05-16', '1918-11-11', 'jasta2', 'fokker_dvii')],
    victories: [['1917-07-12', 1], ['1918-01-01', 18], ['1918-09-15', 43]],
    fate: { kind: 'survived', note: 'Survived the war; became a dentist and aircraft maker.' },
    bio: 'A former dental assistant who became one of Jasta Boelcke\'s greatest aces.',
  },
  {
    id: 'loerzer', firstName: 'Bruno', lastName: 'Loerzer', displayName: 'Hauptmann Bruno Loerzer', shortName: 'Hptm. Loerzer',
    nation: 'germany', skill: 'veteran',
    service: [svc('1917-02-01', '1918-01-31', 'jasta26', 'albatros_dv'), svc('1918-02-01', '1918-05-31', 'jasta26', 'fokker_dri'), svc('1918-06-01', '1918-11-11', 'jasta26', 'fokker_dvii')],
    victories: [['1916-03-12', 1], ['1917-12-31', 20], ['1918-06-01', 30], ['1918-09-26', 44]],
    fate: { kind: 'survived', note: 'Commander of Jagdgeschwader III; survived the war.' },
    bio: 'Göring\'s closest friend and the leader of the black-and-white banded Jasta 26.',
  },

  // ============================================================== Britain
  {
    id: 'hawker', firstName: 'Lanoe', lastName: 'Hawker', displayName: 'Major Lanoe Hawker', shortName: 'Maj. Hawker',
    ranks: [rk('1914-01-01', 'Captain', 'Capt.'), rk('1915-09-01', 'Major', 'Maj.')], honours: [{ from: '1915-08-24', text: ' VC' }],
    nickname: 'The English Boelcke', nation: 'britain', skill: 'ace',
    service: [svc('1916-02-01', '1916-11-23', 'rfc24', 'airco_dh2')],
    victories: [['1915-07-25', 3], ['1916-11-22', 7]],
    fate: { kind: 'killed', date: '1916-11-23', note: 'Killed after a long duel with Manfred von Richthofen, his 11th victory.' },
    bio: 'The first British fighter ace and first airman awarded the VC for air-to-air combat. Commanded No. 24 Squadron.',
  },
  {
    id: 'ball', firstName: 'Albert', lastName: 'Ball', displayName: 'Captain Albert Ball', shortName: 'Capt. Ball',
    ranks: [rk('1914-01-01', 'Lieutenant', 'Lt.'), rk('1916-09-01', 'Captain', 'Capt.')], honours: [{ from: '1917-06-08', text: ' VC' }],
    nation: 'britain', skill: 'ace',
    service: [svc('1916-05-01', '1916-08-14', null, 'nieuport_11'), svc('1916-08-15', '1916-10-01', 'rfc60', 'nieuport_17'), svc('1917-04-07', '1917-05-07', 'rfc56', 'se5a')],
    victories: [['1916-05-16', 1], ['1916-07-02', 11], ['1916-08-31', 24], ['1916-10-01', 31], ['1917-04-30', 38], ['1917-05-06', 44]],
    fate: { kind: 'killed', date: '1917-05-07', note: 'Crashed near Annoeullin after a fight with Jasta 11.' },
    bio: 'A lone hunter who attacked any odds from below with his wing-mounted Lewis. Britain\'s first national air hero.',
  },
  {
    id: 'mccudden', firstName: 'James', lastName: 'McCudden', displayName: 'Captain James McCudden', shortName: 'Capt. McCudden',
    ranks: [rk('1914-01-01', 'Flight Sergeant', 'F/Sgt.'), rk('1917-01-01', 'Second Lieutenant', '2/Lt.'), rk('1917-06-01', 'Captain', 'Capt.')], honours: [{ from: '1918-04-02', text: ' VC' }],
    nation: 'britain', skill: 'ace',
    service: [svc('1916-08-01', '1917-08-13', null, 'sopwith_pup'), svc('1917-08-14', '1918-03-05', 'rfc56', 'se5a')],
    victories: [['1916-09-06', 1], ['1917-08-13', 7], ['1917-12-31', 37], ['1918-02-26', 57]],
    fate: { kind: 'killed', date: '1918-07-09', note: 'Killed in a flying accident on his way to take command of No. 60 Squadron.' },
    bio: 'A former mechanic, a patient stalker of high-flying two-seaters, and a meticulous tactician.',
  },
  {
    id: 'mannock', firstName: 'Edward', lastName: 'Mannock', displayName: 'Major Edward Mannock', shortName: 'Maj. Mannock',
    ranks: [rk('1914-01-01', 'Second Lieutenant', '2/Lt.'), rk('1917-12-01', 'Captain', 'Capt.'), rk('1918-06-18', 'Major', 'Maj.')], honours: [{ from: '1919-07-18', text: ' VC' }],
    nickname: 'Mick', nation: 'britain', skill: 'ace',
    service: [
      svc('1917-04-06', '1917-09-30', 'rfc40', 'nieuport_17'),
      svc('1917-10-01', '1918-01-01', 'rfc40', 'se5a'),
      svc('1918-03-30', '1918-06-18', 'rfc74', 'se5a'),
      svc('1918-07-05', '1918-07-26', 'rfc85', 'se5a'),
    ],
    victories: [['1917-06-07', 1], ['1917-12-31', 15], ['1918-04-12', 21], ['1918-06-17', 50], ['1918-07-26', 61]],
    fate: { kind: 'killed', date: '1918-07-26', note: 'Shot down by ground fire over the lines near Lestrem.' },
    bio: 'The great British patrol leader, who taught his pilots to fight as a team. He feared fire above all.',
  },
  {
    id: 'bishop', firstName: 'William', lastName: 'Bishop', displayName: 'Major William Bishop', shortName: 'Maj. Bishop',
    ranks: [rk('1914-01-01', 'Lieutenant', 'Lt.'), rk('1917-04-01', 'Captain', 'Capt.'), rk('1918-04-01', 'Major', 'Maj.')], honours: [{ from: '1917-08-11', text: ' VC' }],
    nickname: 'Billy', nation: 'britain', skill: 'ace',
    service: [svc('1917-03-17', '1917-08-31', 'rfc60', 'nieuport_17'), svc('1918-05-22', '1918-06-19', 'rfc85', 'se5a')],
    victories: [['1917-03-25', 1], ['1917-06-02', 22], ['1917-08-16', 47], ['1918-05-27', 48], ['1918-06-19', 72]],
    fate: { kind: 'retired', date: '1918-06-20', note: 'Recalled to England; survived the war.' },
    bio: 'A Canadian whose blue-nosed Nieuport terrorised the Arras front; the top British Empire ace by official count.',
  },
  {
    id: 'collishaw', firstName: 'Raymond', lastName: 'Collishaw', displayName: 'Major Raymond Collishaw', shortName: 'Maj. Collishaw',
    ranks: [rk('1914-01-01', 'Flight Sub-Lieutenant', 'F/S/Lt.'), rk('1917-06-01', 'Flight Commander', 'F/Cdr.'), rk('1918-04-01', 'Major', 'Maj.')],
    nation: 'britain', skill: 'ace',
    service: [
      svc('1917-05-15', '1917-07-31', 'rnas10', 'sopwith_triplane'),
      svc('1917-08-01', '1917-09-30', 'rnas10', 'sopwith_camel'),
      svc('1918-06-01', '1918-10-01', 'rnas3', 'sopwith_camel'),
    ],
    victories: [['1916-10-25', 2], ['1917-06-01', 10], ['1917-07-31', 33], ['1918-01-26', 40], ['1918-06-10', 47], ['1918-10-01', 60]],
    fate: { kind: 'survived', note: 'Survived the war.' },
    bio: 'Leader of Naval 10\'s "Black Flight"; his Triplane was "Black Maria".',
  },
  {
    id: 'rhysdavids', firstName: 'Arthur', lastName: 'Rhys Davids', displayName: 'Lieutenant Arthur Rhys Davids', shortName: 'Lt. Rhys Davids',
    nation: 'britain', skill: 'veteran',
    service: [svc('1917-06-01', '1917-10-27', 'rfc56', 'se5a')],
    victories: [['1917-05-23', 1], ['1917-09-23', 21], ['1917-10-27', 25]],
    fate: { kind: 'killed', date: '1917-10-27', note: 'Missing near Roulers.' },
    bio: 'An Old Etonian of 20 who brought down Werner Voss.',
  },
  {
    id: 'maclaren', firstName: 'Donald', lastName: 'MacLaren', displayName: 'Captain Donald MacLaren', shortName: 'Capt. MacLaren',
    nation: 'britain', skill: 'ace',
    service: [svc('1918-02-01', '1918-10-09', 'rfc46', 'sopwith_camel')],
    victories: [['1918-03-06', 1], ['1918-10-09', 54]],
    fate: { kind: 'retired', date: '1918-10-10', note: 'Broke his leg in a wrestling match; survived the war.' },
    bio: 'A Canadian fur trader who became the highest-scoring Camel pilot, in only eight months.',
  },
  {
    id: 'little', firstName: 'Robert', lastName: 'Little', displayName: 'Captain Robert Little', shortName: 'Capt. Little',
    nation: 'britain', skill: 'ace',
    service: [
      svc('1916-11-01', '1917-03-31', 'rnas8', 'sopwith_pup'),
      svc('1917-04-01', '1917-07-31', 'rnas8', 'sopwith_triplane'),
      svc('1917-08-01', '1917-11-30', 'rnas8', 'sopwith_camel'),
      svc('1918-03-01', '1918-05-27', 'rnas3', 'sopwith_camel'),
    ],
    victories: [['1916-11-23', 1], ['1917-07-27', 28], ['1917-11-18', 38], ['1918-05-22', 47]],
    fate: { kind: 'killed', date: '1918-05-27', note: 'Killed attacking a Gotha by night.' },
    bio: 'Australia\'s top-scoring ace, flying with the naval squadrons.',
  },
  {
    id: 'park', firstName: 'Keith', lastName: 'Park', displayName: 'Major Keith Park', shortName: 'Maj. Park',
    nation: 'britain', skill: 'veteran',
    service: [svc('1917-04-01', '1918-04-10', 'rfc48', 'bristol_f2b')],
    victories: [['1917-04-24', 1], ['1917-12-31', 14], ['1918-04-10', 20]],
    fate: { kind: 'survived', note: 'Survived the war; commanded 11 Group in the Battle of Britain.' },
    bio: 'A New Zealander who proved the Bristol Fighter could be flown like a single-seater.',
  },

  // =============================================================== France
  {
    id: 'guynemer', firstName: 'Georges', lastName: 'Guynemer', displayName: 'Capitaine Georges Guynemer', shortName: 'Capt. Guynemer',
    ranks: [rk('1914-01-01', 'Sergent', 'Sgt.'), rk('1916-03-04', 'Sous-Lieutenant', 'S/Lt.'), rk('1916-07-05', 'Lieutenant', 'Lt.'), rk('1917-02-18', 'Capitaine', 'Capt.')],
    nation: 'france', skill: 'ace',
    service: [svc('1915-06-01', '1916-05-31', null, 'nieuport_11'), svc('1916-06-01', '1916-09-30', 'spa3', 'nieuport_17'), svc('1916-10-01', '1917-09-11', 'spa3', 'spad_vii')],
    victories: [['1915-07-19', 1], ['1916-06-01', 8], ['1916-12-31', 25], ['1917-05-26', 45], ['1917-09-10', 53]],
    fate: { kind: 'killed', date: '1917-09-11', note: 'Vanished over Poelcapelle; no trace was ever found.' },
    bio: 'France\'s beloved ace, frail and fearless. His SPAD "Vieux Charles" hangs in Les Invalides.',
  },
  {
    id: 'fonck', firstName: 'René', lastName: 'Fonck', displayName: 'Lieutenant René Fonck', shortName: 'Lt. Fonck',
    ranks: [rk('1914-01-01', 'Sergent', 'Sgt.'), rk('1917-01-01', 'Adjudant', 'Adj.'), rk('1917-08-01', 'Sous-Lieutenant', 'S/Lt.'), rk('1918-04-01', 'Lieutenant', 'Lt.')],
    nation: 'france', skill: 'ace',
    service: [svc('1917-04-15', '1917-07-31', 'spa103', 'spad_vii'), svc('1917-08-01', '1918-11-11', 'spa103', 'spad_xiii')],
    victories: [['1916-08-06', 2], ['1917-05-03', 4], ['1917-12-31', 19], ['1918-05-09', 36], ['1918-11-01', 75]],
    fate: { kind: 'survived', note: 'Survived the war as the Allied ace of aces.' },
    bio: 'A cold, economical marksman who twice downed six aircraft in a single day.',
  },
  {
    id: 'nungesser', firstName: 'Charles', lastName: 'Nungesser', displayName: 'Lieutenant Charles Nungesser', shortName: 'Lt. Nungesser',
    nation: 'france', skill: 'ace',
    service: [svc('1916-06-01', '1917-03-31', 'n65', 'nieuport_17'), svc('1917-04-01', '1917-09-30', 'n65', 'spad_vii'), svc('1917-10-01', '1918-08-15', 'n65', 'spad_xiii')],
    victories: [['1915-07-31', 1], ['1916-12-31', 21], ['1917-12-31', 30], ['1918-08-15', 43]],
    fate: { kind: 'retired', date: '1918-08-16', note: 'Survived the war, wounded seventeen times.' },
    bio: 'A boxer and racing driver whose machines bore a black heart with skull, crossbones and coffin.',
  },
  {
    id: 'dorme', firstName: 'René', lastName: 'Dorme', displayName: 'Sous-Lieutenant René Dorme', shortName: 'S/Lt. Dorme',
    nation: 'france', skill: 'veteran',
    service: [svc('1916-06-01', '1916-12-31', 'spa3', 'nieuport_17'), svc('1917-01-01', '1917-05-25', 'spa3', 'spad_vii')],
    victories: [['1916-07-01', 1], ['1917-05-24', 23]],
    fate: { kind: 'killed', date: '1917-05-25', note: 'Shot down near Fort de la Pompelle.' },
    bio: '"Père" Dorme, the unkillable Cigogne - until his luck ran out in May 1917.',
  },
  {
    id: 'heurtaux', firstName: 'Alfred', lastName: 'Heurtaux', displayName: 'Capitaine Alfred Heurtaux', shortName: 'Capt. Heurtaux',
    nation: 'france', skill: 'veteran',
    service: [svc('1916-06-01', '1917-01-31', 'spa3', 'nieuport_17'), svc('1917-02-01', '1917-09-03', 'spa3', 'spad_vii')],
    victories: [['1916-06-01', 3], ['1917-05-01', 19], ['1917-09-03', 21]],
    fate: { kind: 'retired', date: '1917-09-03', note: 'Badly wounded; survived the war.' },
    bio: 'Commander of the Cigognes and a close friend of Guynemer.',
  },
  {
    id: 'deullin', firstName: 'Albert', lastName: 'Deullin', displayName: 'Capitaine Albert Deullin', shortName: 'Capt. Deullin',
    nation: 'france', skill: 'veteran',
    service: [svc('1916-06-01', '1916-12-31', 'spa3', 'nieuport_17'), svc('1917-01-01', '1917-02-28', 'spa3', 'spad_vii'), svc('1917-03-01', '1918-05-31', null, 'spad_xiii')],
    victories: [['1916-06-01', 3], ['1917-02-28', 14], ['1918-05-01', 20]],
    fate: { kind: 'survived', note: 'Survived the war.' },
    bio: 'A Cigogne whose written notes on fighter tactics were studied across the French service.',
  },

  // ================================================================== USA
  {
    id: 'lufbery', firstName: 'Raoul', lastName: 'Lufbery', displayName: 'Major Raoul Lufbery', shortName: 'Maj. Lufbery',
    ranks: [rk('1914-01-01', 'Sergent', 'Sgt.'), rk('1917-01-01', 'Sous-Lieutenant', 'S/Lt.'), rk('1918-01-10', 'Major', 'Maj.')],
    nation: 'usa', skill: 'ace',
    service: [svc('1916-06-01', '1917-06-30', 'n124', 'nieuport_17'), svc('1917-07-01', '1918-01-05', 'n124', 'spad_vii'), svc('1918-03-05', '1918-05-19', 'us94', 'nieuport_28')],
    victories: [['1916-07-30', 1], ['1917-12-02', 16], ['1918-05-19', 17]],
    fate: { kind: 'killed', date: '1918-05-19', note: 'Jumped or fell from his burning Nieuport while attacking a two-seater.' },
    bio: 'The Lafayette Escadrille\'s ace, who taught the 94th\'s novices to fight - and gave his name to the "Lufbery circle".',
  },
  {
    id: 'rickenbacker', firstName: 'Edward', lastName: 'Rickenbacker', displayName: 'Captain Edward Rickenbacker', shortName: 'Capt. Rickenbacker',
    ranks: [rk('1914-01-01', 'First Lieutenant', '1st Lt.'), rk('1918-09-25', 'Captain', 'Capt.')],
    nickname: 'Eddie', nation: 'usa', skill: 'ace',
    service: [svc('1918-03-05', '1918-07-14', 'us94', 'nieuport_28'), svc('1918-07-15', '1918-11-11', 'us94', 'spad_xiii')],
    victories: [['1918-04-29', 1], ['1918-05-30', 6], ['1918-09-14', 7], ['1918-09-25', 10], ['1918-10-30', 26]],
    fate: { kind: 'survived', note: 'Survived the war as America\'s ace of aces.' },
    bio: 'A racing driver turned fighter pilot and commander of the "Hat in the Ring" squadron.',
  },
  {
    id: 'luke', firstName: 'Frank', lastName: 'Luke', displayName: 'Second Lieutenant Frank Luke', shortName: '2nd Lt. Luke',
    nickname: 'The Arizona Balloon Buster', nation: 'usa', skill: 'ace',
    service: [svc('1918-07-25', '1918-09-29', 'us27', 'spad_xiii')],
    victories: [['1918-08-16', 1], ['1918-09-11', 2], ['1918-09-18', 13], ['1918-09-29', 18]],
    fate: { kind: 'killed', date: '1918-09-29', note: 'Shot down after destroying three balloons; died resisting capture.' },
    bio: 'A brash loner who scored 18 victories, 14 of them balloons, in seventeen days.',
  },
  {
    id: 'campbell', firstName: 'Douglas', lastName: 'Campbell', displayName: 'Lieutenant Douglas Campbell', shortName: 'Lt. Campbell',
    nation: 'usa', skill: 'veteran',
    service: [svc('1918-03-05', '1918-06-05', 'us94', 'nieuport_28')],
    victories: [['1918-04-14', 1], ['1918-05-31', 5], ['1918-06-05', 6]],
    fate: { kind: 'retired', date: '1918-06-05', note: 'Wounded; survived the war.' },
    bio: 'The first American-trained pilot to become an ace.',
  },
  {
    id: 'springs', firstName: 'Elliott', lastName: 'White Springs', displayName: 'Captain Elliott White Springs', shortName: 'Capt. Springs',
    ranks: [rk('1914-01-01', 'First Lieutenant', '1st Lt.'), rk('1918-10-01', 'Captain', 'Capt.')],
    nation: 'usa', skill: 'veteran',
    service: [svc('1918-07-01', '1918-10-30', 'us148', 'sopwith_camel')],
    victories: [['1918-06-03', 1], ['1918-08-31', 11], ['1918-10-30', 16]],
    fate: { kind: 'survived', note: 'Survived the war; wrote "War Birds".' },
    bio: 'A witty, hard-living flight commander of the 148th.',
  },
  {
    id: 'kindley', firstName: 'Field', lastName: 'Kindley', displayName: 'Captain Field Kindley', shortName: 'Capt. Kindley',
    ranks: [rk('1914-01-01', 'First Lieutenant', '1st Lt.'), rk('1918-10-01', 'Captain', 'Capt.')],
    nation: 'usa', skill: 'veteran',
    service: [svc('1918-07-01', '1918-11-11', 'us148', 'sopwith_camel')],
    victories: [['1918-06-26', 1], ['1918-10-28', 12]],
    fate: { kind: 'survived', note: 'Survived the war.' },
    bio: 'An Arkansas farm boy who commanded the 148th Aero.',
  },
  {
    id: 'vaughn', firstName: 'George', lastName: 'Vaughn', displayName: 'Lieutenant George Vaughn', shortName: 'Lt. Vaughn',
    nation: 'usa', skill: 'veteran',
    service: [svc('1918-05-01', '1918-07-31', null, 'se5a'), svc('1918-08-01', '1918-11-11', 'us17', 'sopwith_camel')],
    victories: [['1918-05-31', 1], ['1918-07-31', 7], ['1918-11-04', 13]],
    fate: { kind: 'survived', note: 'Survived the war.' },
    bio: 'Scored with No. 84 Squadron RAF before joining the 17th Aero.',
  },
  {
    id: 'hall', firstName: 'James Norman', lastName: 'Hall', displayName: 'Captain James Norman Hall', shortName: 'Capt. Hall',
    nation: 'usa', skill: 'regular',
    service: [svc('1918-03-05', '1918-05-07', 'us94', 'nieuport_28')],
    victories: [['1918-04-29', 1], ['1918-05-07', 4]],
    fate: { kind: 'captured', date: '1918-05-07', note: 'Shot down by flak and captured.' },
    bio: 'Lafayette veteran and later co-author of "Mutiny on the Bounty".',
  },
  {
    id: 'chambers', firstName: 'Reed', lastName: 'Chambers', displayName: 'Captain Reed Chambers', shortName: 'Capt. Chambers',
    ranks: [rk('1914-01-01', 'First Lieutenant', '1st Lt.'), rk('1918-10-01', 'Captain', 'Capt.')],
    nation: 'usa', skill: 'veteran',
    service: [svc('1918-03-05', '1918-07-14', 'us94', 'nieuport_28'), svc('1918-07-15', '1918-11-11', 'us94', 'spad_xiii')],
    victories: [['1918-05-07', 1], ['1918-10-22', 7]],
    fate: { kind: 'survived', note: 'Survived the war; co-founded an aviation insurance company.' },
    bio: 'One of the 94th\'s original pilots, flying beside Rickenbacker.',
  },
];

export function getAce(id: string): Ace | undefined {
  return ACES.find((a) => a.id === id);
}

/** Date after which the ace no longer flies (killed/captured/retired), if any. */
export function aceEndDate(a: Ace): string | undefined {
  return a.fate.kind === 'survived' ? undefined : a.fate.date;
}

/** Historical cumulative victory count on `date` (floor of linear interpolation). */
export function aceVictoriesOn(a: Ace, date: string): number {
  const pts = a.victories;
  if (pts.length === 0 || date < pts[0][0]) return 0;
  const end = aceEndDate(a);
  const d = end && date > end ? end : date;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (d >= pts[i][0]) {
      if (i === pts.length - 1) return pts[i][1];
      const [d0, v0] = pts[i];
      const [d1, v1] = pts[i + 1];
      const t = (Date.parse(d) - Date.parse(d0)) / (Date.parse(d1) - Date.parse(d0));
      return Math.floor(v0 + (v1 - v0) * t);
    }
  }
  return 0;
}

/** The ace's service record on `date`, if at the front and not yet killed/captured/retired. */
export function aceServiceOn(a: Ace, date: string): AceService | undefined {
  const end = aceEndDate(a);
  if (end && date >= end) return undefined;
  return a.service.find((s) => s.from <= date && date <= s.to);
}
