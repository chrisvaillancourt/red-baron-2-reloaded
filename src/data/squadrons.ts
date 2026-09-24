/**
 * Historical squadrons fielded in the sector, with bases (aerodrome ids from
 * ./aerodromes.ts) and equipment by date. Dates are approximate; see
 * DECISIONS.md for simplifications (e.g. 56 Sqn's SE5 period, 24 Sqn's
 * D.H.5 period, units rebased from elsewhere on the front).
 */
import type { SquadronInfo } from '../core/campaignTypes';
import type { AircraftId } from '../core/types';
import { composeLivery } from './liveries';

type Base = SquadronInfo['bases'][number];
type Equip = SquadronInfo['equipment'][number];

const base = (from: string, to: string, aerodromeId: string): Base => ({ from, to, aerodromeId });
const eq = (from: string, to: string, ...aircraft: AircraftId[]): Equip => ({ from, to, aircraft });

const END = '1918-11-11';

/** Jagdgeschwader I moved as a unit from June 1917 (Jastas 4, 6, 10, 11). */
const JG1_BASES: Base[] = [
  base('1917-06-10', '1917-11-19', 'marcke'),
  base('1917-11-20', '1918-03-24', 'avesnes-le-sec'),
  base('1918-03-25', '1918-03-31', 'lechelle'),
  base('1918-04-01', '1918-08-24', 'cappy'),
  base('1918-08-25', '1918-09-09', 'bernes'),
  base('1918-09-10', '1918-09-30', 'proville'),
  base('1918-10-01', '1918-10-09', 'avesnes-le-sec'),
  base('1918-10-10', END, 'douai'),
];

type Def = Omit<SquadronInfo, 'livery'>;

const DEFS: Def[] = [
  // =============================================================== Germany
  {
    id: 'ffa62', name: 'Feldflieger-Abteilung 62', shortName: 'FFA 62', nation: 'germany',
    formed: '1915-07-01', disbanded: '1916-08-31',
    bases: [base('1915-07-01', '1916-08-31', 'douai')],
    equipment: [eq('1915-07-01', '1916-08-31', 'fokker_eiii')],
    notableAces: ['boelcke', 'immelmann'],
    description: 'A field aviation section at Douai whose single-seat Fokker detachment - Boelcke and Immelmann - pioneered the art of air fighting and began the "Fokker Scourge".',
  },
  {
    id: 'jasta2', name: 'Jagdstaffel 2 "Boelcke"', shortName: 'Jasta 2', nation: 'germany',
    formed: '1916-08-27', disbanded: END,
    bases: [
      base('1916-08-27', '1916-09-30', 'bertincourt'),
      base('1916-10-01', '1917-03-14', 'lagnicourt'),
      base('1917-03-15', '1917-11-19', 'pronville'),
      base('1917-11-20', '1918-03-24', 'proville'),
      base('1918-03-25', '1918-08-29', 'lechelle'),
      base('1918-08-30', '1918-09-09', 'bernes'),
      base('1918-09-10', '1918-09-30', 'proville'),
      base('1918-10-01', '1918-10-09', 'avesnes-le-sec'),
      base('1918-10-10', END, 'douai'),
    ],
    equipment: [
      eq('1916-08-27', '1917-03-31', 'albatros_dii'),
      eq('1917-01-15', '1917-08-31', 'albatros_diii'),
      eq('1917-07-01', '1918-05-31', 'albatros_dv'),
      eq('1917-10-01', '1918-05-15', 'fokker_dri'),
      eq('1918-05-01', END, 'fokker_dvii'),
    ],
    notableAces: ['boelcke', 'mvr', 'voss', 'baumer'],
    motto: 'Boelcke\'s Dicta',
    description: 'Oswald Boelcke\'s own Jasta, the school of German fighter pilots. Renamed "Jasta Boelcke" after his death in October 1916.',
  },
  {
    id: 'jasta4', name: 'Königlich Preussische Jagdstaffel 4', shortName: 'Jasta 4', nation: 'germany',
    formed: '1916-08-25', disbanded: END,
    bases: [base('1916-08-25', '1917-06-09', 'proville'), ...JG1_BASES],
    equipment: [
      eq('1916-08-25', '1917-03-31', 'albatros_dii'),
      eq('1917-01-15', '1917-08-31', 'albatros_diii'),
      eq('1917-07-01', '1918-05-31', 'albatros_dv'),
      eq('1917-11-01', '1918-05-31', 'fokker_dri'),
      eq('1918-05-15', END, 'fokker_dvii'),
    ],
    notableAces: ['wusthoff', 'udet'],
    description: 'A founding Jasta of Richthofen\'s Flying Circus. Commanded from May 1918 by Ernst Udet.',
  },
  {
    id: 'jasta5', name: 'Königlich Preussische Jagdstaffel 5', shortName: 'Jasta 5', nation: 'germany',
    formed: '1916-08-21', disbanded: END,
    bases: [
      base('1916-08-21', '1917-03-09', 'bertincourt'),
      base('1917-03-10', '1918-03-24', 'proville'),
      base('1918-03-25', '1918-09-09', 'bernes'),
      base('1918-09-10', '1918-09-30', 'proville'),
      base('1918-10-01', END, 'avesnes-le-sec'),
    ],
    equipment: [
      eq('1916-08-21', '1917-03-31', 'albatros_dii'),
      eq('1917-01-15', '1917-09-30', 'albatros_diii'),
      eq('1917-07-01', '1918-06-30', 'albatros_dv'),
      eq('1918-01-01', '1918-06-30', 'pfalz_diiia'),
      eq('1918-06-01', END, 'fokker_dvii'),
    ],
    notableAces: ['gontermann', 'rumey', 'mai', 'konnecke', 'voss'],
    description: 'A hard-fighting Staffel near Cambrai whose green-tailed machines were a menace throughout 1917 and 1918.',
  },
  {
    id: 'jasta6', name: 'Königlich Preussische Jagdstaffel 6', shortName: 'Jasta 6', nation: 'germany',
    formed: '1916-08-25', disbanded: END,
    bases: [base('1916-08-25', '1917-03-19', 'proville'), base('1917-03-20', '1917-06-09', 'bernes'), ...JG1_BASES],
    equipment: [
      eq('1916-08-25', '1917-03-31', 'albatros_dii'),
      eq('1917-01-15', '1917-08-31', 'albatros_diii'),
      eq('1917-07-01', '1917-12-31', 'albatros_dv'),
      eq('1917-11-01', '1918-06-30', 'fokker_dri'),
      eq('1918-06-01', END, 'fokker_dvii'),
      eq('1918-08-01', END, 'fokker_dviii'),
    ],
    notableAces: ['kirschstein'],
    description: 'Jagdgeschwader I\'s black-and-white striped Staffel, one of the few units to fly the Fokker D.VIII monoplane.',
  },
  {
    id: 'jasta10', name: 'Königlich Preussische Jagdstaffel 10', shortName: 'Jasta 10', nation: 'germany',
    formed: '1916-10-01', disbanded: END,
    bases: [base('1916-10-01', '1917-06-09', 'douai'), ...JG1_BASES],
    equipment: [
      eq('1916-10-01', '1917-03-31', 'albatros_dii'),
      eq('1917-01-15', '1917-08-31', 'albatros_diii'),
      eq('1917-07-01', '1918-05-31', 'albatros_dv'),
      eq('1917-09-01', '1918-05-31', 'fokker_dri'),
      eq('1917-12-01', '1918-06-30', 'pfalz_diiia'),
      eq('1918-06-01', END, 'fokker_dvii'),
    ],
    notableAces: ['voss', 'lowenhardt'],
    description: 'The yellow-nosed Staffel of Jagdgeschwader I, led by Werner Voss in the summer of 1917.',
  },
  {
    id: 'jasta11', name: 'Königlich Preussische Jagdstaffel 11', shortName: 'Jasta 11', nation: 'germany',
    formed: '1916-10-01', disbanded: END,
    bases: [base('1916-10-01', '1917-04-21', 'la-brayelle'), base('1917-04-22', '1917-06-09', 'roucourt'), ...JG1_BASES],
    equipment: [
      eq('1916-10-01', '1917-03-31', 'albatros_dii'),
      eq('1917-01-15', '1917-08-31', 'albatros_diii'),
      eq('1917-07-01', '1917-12-31', 'albatros_dv'),
      eq('1917-09-01', '1918-07-01', 'fokker_dri'),
      eq('1918-06-01', END, 'fokker_dvii'),
    ],
    notableAces: ['mvr', 'lothar', 'wolff', 'allmenroder', 'udet', 'goering'],
    motto: 'The red machines',
    description: 'Manfred von Richthofen\'s own Staffel. Its red-painted machines claimed 89 victories in "Bloody April" 1917 alone and formed the heart of the Flying Circus.',
  },
  {
    id: 'jasta26', name: 'Königlich Preussische Jagdstaffel 26', shortName: 'Jasta 26', nation: 'germany',
    formed: '1917-02-01', disbanded: END,
    bases: [base('1917-02-01', END, 'harlebeke')],
    equipment: [
      eq('1917-02-01', '1917-09-30', 'albatros_diii'),
      eq('1917-07-01', '1918-06-30', 'albatros_dv'),
      eq('1918-01-01', '1918-05-31', 'fokker_dri'),
      eq('1918-05-15', END, 'fokker_dvii'),
    ],
    notableAces: ['loerzer', 'goering'],
    description: 'Bruno Loerzer\'s Flanders Staffel, its machines banded in black and white. Core of Jagdgeschwader III from February 1918.',
  },
  {
    id: 'jasta27', name: 'Königlich Preussische Jagdstaffel 27', shortName: 'Jasta 27', nation: 'germany',
    formed: '1917-03-01', disbanded: END,
    bases: [base('1917-03-01', '1918-03-24', 'rumbeke'), base('1918-03-25', '1918-08-29', 'lechelle'), base('1918-08-30', END, 'avesnes-le-sec')],
    equipment: [
      eq('1917-03-01', '1917-09-30', 'albatros_diii'),
      eq('1917-07-01', '1918-06-30', 'albatros_dv'),
      eq('1918-01-01', '1918-06-30', 'pfalz_diiia'),
      eq('1918-03-01', '1918-05-31', 'fokker_dri'),
      eq('1918-05-15', END, 'fokker_dvii'),
    ],
    notableAces: ['goering'],
    description: 'Commanded by Hermann Göring from May 1917 until he took over Jagdgeschwader I in July 1918.',
  },

  // =============================================================== Britain
  {
    id: 'rfc24', name: 'No. 24 Squadron RFC', shortName: '24 Sqn', nation: 'britain',
    formed: '1916-02-01', disbanded: END,
    bases: [base('1916-02-01', END, 'bertangles')],
    equipment: [eq('1916-02-01', '1917-05-31', 'airco_dh2'), eq('1917-06-01', END, 'se5a')],
    notableAces: ['hawker'],
    motto: 'In omnibus princeps',
    description: 'The first RFC squadron formed purely for air fighting, led by Major Lanoe Hawker VC. Its D.H.2s ended the Fokker Scourge over the Somme.',
  },
  {
    id: 'rfc40', name: 'No. 40 Squadron RFC', shortName: '40 Sqn', nation: 'britain',
    formed: '1917-03-01', disbanded: END,
    bases: [base('1917-03-01', '1917-04-30', 'bailleul'), base('1917-05-01', END, 'estree-blanche')],
    equipment: [eq('1917-03-01', '1917-10-15', 'nieuport_17'), eq('1917-10-01', END, 'se5a')],
    notableAces: ['mannock'],
    description: 'Where Edward "Mick" Mannock learned his trade flying Nieuports over Lens and Vimy.',
  },
  {
    id: 'rfc46', name: 'No. 46 Squadron RFC', shortName: '46 Sqn', nation: 'britain',
    formed: '1917-04-15', disbanded: END,
    bases: [base('1917-04-15', END, 'ste-marie-cappel')],
    equipment: [eq('1917-04-15', '1917-11-15', 'sopwith_pup'), eq('1917-11-01', END, 'sopwith_camel')],
    notableAces: ['maclaren'],
    description: 'A Pup squadron, then Camels; its Donald MacLaren became the highest-scoring Camel pilot of the war.',
  },
  {
    id: 'rfc48', name: 'No. 48 Squadron RFC', shortName: '48 Sqn', nation: 'britain',
    formed: '1917-04-01', disbanded: END,
    bases: [base('1917-04-01', '1918-03-24', 'vert-galand'), base('1918-03-25', END, 'bertangles')],
    equipment: [eq('1917-04-01', END, 'bristol_f2b')],
    notableAces: ['park'],
    description: 'The first Bristol Fighter squadron. After a costly debut at Arras its crews learned to fly the "Brisfit" as an aggressive fighter.',
  },
  {
    id: 'rfc56', name: 'No. 56 Squadron RFC', shortName: '56 Sqn', nation: 'britain',
    formed: '1917-06-01', disbanded: END,
    bases: [base('1917-06-01', '1918-01-20', 'estree-blanche'), base('1918-01-21', END, 'baizieux')],
    equipment: [eq('1917-06-01', END, 'se5a')],
    notableAces: ['ball', 'mccudden', 'rhysdavids'],
    motto: 'Quid si coelum ruat',
    description: 'An elite S.E.5 squadron raised to beat the Albatros. Albert Ball, James McCudden and Arthur Rhys Davids flew with it; its pilots brought down Werner Voss.',
  },
  {
    id: 'rfc60', name: 'No. 60 Squadron RFC', shortName: '60 Sqn', nation: 'britain',
    formed: '1916-08-01', disbanded: END,
    bases: [base('1916-08-01', END, 'filescamp')],
    equipment: [eq('1916-08-01', '1916-12-31', 'nieuport_11'), eq('1916-08-01', '1917-07-31', 'nieuport_17'), eq('1917-07-15', END, 'se5a')],
    notableAces: ['ball', 'bishop'],
    motto: 'Per ardua ad astra',
    description: 'A Nieuport squadron at Filescamp Farm, home to Albert Ball in 1916 and Billy Bishop in 1917.',
  },
  {
    id: 'rfc70', name: 'No. 70 Squadron RFC', shortName: '70 Sqn', nation: 'britain',
    formed: '1917-07-01', disbanded: END,
    bases: [base('1917-07-01', '1918-04-11', 'bailleul'), base('1918-04-12', END, 'estree-blanche')],
    equipment: [eq('1917-07-01', END, 'sopwith_camel')],
    notableAces: [],
    description: 'The first squadron to take the Sopwith Camel to war.',
  },
  {
    id: 'rfc74', name: 'No. 74 Squadron RAF', shortName: '74 Sqn', nation: 'britain',
    formed: '1918-03-30', disbanded: END,
    bases: [base('1918-03-30', END, 'ste-marie-cappel')],
    equipment: [eq('1918-03-30', END, 'se5a')],
    notableAces: ['mannock'],
    motto: 'I fear no man',
    description: '"Tiger" squadron. Mannock was its star flight commander in the spring of 1918.',
  },
  {
    id: 'rfc85', name: 'No. 85 Squadron RAF', shortName: '85 Sqn', nation: 'britain',
    formed: '1918-05-22', disbanded: END,
    bases: [base('1918-05-22', END, 'petite-synthe')],
    equipment: [eq('1918-05-22', END, 'se5a')],
    notableAces: ['bishop', 'mannock', 'springs'],
    description: 'Commanded first by Billy Bishop, then by Mannock until his death in July 1918.',
  },
  {
    id: 'rnas3', name: 'No. 3 Squadron RNAS', shortName: 'Naval 3', nation: 'britain',
    formed: '1917-02-01', disbanded: END,
    bases: [base('1917-02-01', '1917-06-14', 'vert-galand'), base('1917-06-15', '1918-03-24', 'st-pol'), base('1918-03-25', END, 'filescamp')],
    equipment: [eq('1917-02-01', '1917-07-15', 'sopwith_pup'), eq('1917-07-01', END, 'sopwith_camel')],
    notableAces: ['little', 'collishaw'],
    description: 'A Royal Naval Air Service fighter squadron lent to the RFC; No. 203 Squadron RAF from April 1918.',
  },
  {
    id: 'rnas8', name: 'No. 8 Squadron RNAS', shortName: 'Naval 8', nation: 'britain',
    formed: '1916-10-26', disbanded: END,
    bases: [base('1916-10-26', '1917-06-30', 'vert-galand'), base('1917-07-01', END, 'filescamp')],
    equipment: [eq('1916-10-26', '1917-04-30', 'sopwith_pup'), eq('1917-04-01', '1917-07-31', 'sopwith_triplane'), eq('1917-07-15', END, 'sopwith_camel')],
    notableAces: ['little'],
    description: '"Naval Eight" flew Pups, Triplanes and Camels in support of the RFC on the Arras front; No. 208 Squadron RAF from April 1918.',
  },
  {
    id: 'rnas10', name: 'No. 10 Squadron RNAS', shortName: 'Naval 10', nation: 'britain',
    formed: '1917-05-15', disbanded: END,
    bases: [base('1917-05-15', END, 'ste-marie-cappel')],
    equipment: [eq('1917-05-15', '1917-08-31', 'sopwith_triplane'), eq('1917-08-15', END, 'sopwith_camel')],
    notableAces: ['collishaw'],
    description: 'Home of Raymond Collishaw\'s all-Canadian "Black Flight" of Triplanes: Black Maria, Black Prince, Black George, Black Death and Black Roger.',
  },

  // ================================================================ France
  {
    id: 'spa3', name: 'Escadrille N.3 / SPA 3 "Les Cigognes"', shortName: 'SPA 3', nation: 'france',
    formed: '1916-06-01', disbanded: END,
    bases: [base('1916-06-01', '1917-06-30', 'cachy'), base('1917-07-01', END, 'bierne')],
    equipment: [
      eq('1916-06-01', '1916-12-31', 'nieuport_11'),
      eq('1916-06-01', '1917-06-30', 'nieuport_17'),
      eq('1916-09-01', '1918-03-31', 'spad_vii'),
      eq('1917-06-01', END, 'spad_xiii'),
    ],
    notableAces: ['guynemer', 'dorme', 'heurtaux', 'deullin'],
    motto: 'Les Cigognes',
    description: 'The most famous French escadrille, its stork insignia worn by Guynemer, Dorme and Heurtaux.',
  },
  {
    id: 'n65', name: 'Escadrille N.65', shortName: 'N.65', nation: 'france',
    formed: '1916-06-01', disbanded: END,
    bases: [base('1916-06-01', '1918-03-24', 'cachy'), base('1918-03-25', END, 'bierne')],
    equipment: [
      eq('1916-06-01', '1916-12-31', 'nieuport_11'),
      eq('1916-06-01', '1917-09-30', 'nieuport_17'),
      eq('1917-04-01', '1918-03-31', 'spad_vii'),
      eq('1917-10-01', END, 'spad_xiii'),
    ],
    notableAces: ['nungesser'],
    description: 'Charles Nungesser\'s escadrille, whose skull-and-crossbones and coffin insignia taunted the enemy over the Somme.',
  },
  {
    id: 'spa103', name: 'Escadrille SPA 103', shortName: 'SPA 103', nation: 'france',
    formed: '1916-06-01', disbanded: END,
    bases: [base('1916-06-01', '1917-06-30', 'cachy'), base('1917-07-01', END, 'bierne')],
    equipment: [eq('1916-06-01', '1917-04-30', 'nieuport_17'), eq('1917-01-01', '1918-03-31', 'spad_vii'), eq('1917-08-01', END, 'spad_xiii')],
    notableAces: ['fonck'],
    description: 'A stork escadrille of Groupe de Combat 12, where René Fonck became the Allies\' ace of aces.',
  },

  // =================================================================== USA
  {
    id: 'n124', name: 'Escadrille N.124 "Lafayette"', shortName: 'Lafayette', nation: 'usa',
    formed: '1916-06-01', disbanded: '1918-02-17',
    bases: [base('1916-06-01', '1918-02-17', 'cachy')],
    equipment: [
      eq('1916-06-01', '1916-12-31', 'nieuport_11'),
      eq('1916-06-01', '1917-06-30', 'nieuport_17'),
      eq('1917-06-01', '1918-02-17', 'spad_vii'),
      eq('1918-01-01', '1918-02-17', 'spad_xiii'),
    ],
    notableAces: ['lufbery'],
    motto: 'Sioux head',
    description: 'American volunteers flying for France before the United States entered the war. Transferred to the US Air Service as the 103rd Aero Squadron in February 1918.',
  },
  {
    id: 'us103', name: '103rd Aero Squadron', shortName: '103rd Aero', nation: 'usa',
    formed: '1918-02-18', disbanded: END,
    bases: [base('1918-02-18', END, 'bierne')],
    equipment: [eq('1918-02-18', '1918-05-31', 'spad_vii'), eq('1918-02-18', END, 'spad_xiii')],
    notableAces: [],
    description: 'The former Lafayette Escadrille, now flying under American colours with the French in Flanders.',
  },
  {
    id: 'us94', name: '94th Aero Squadron "Hat in the Ring"', shortName: '94th Aero', nation: 'usa',
    formed: '1918-03-05', disbanded: END,
    bases: [base('1918-03-05', END, 'allonville')],
    equipment: [eq('1918-03-05', '1918-07-31', 'nieuport_28'), eq('1918-07-15', END, 'spad_xiii')],
    notableAces: ['rickenbacker', 'lufbery', 'campbell', 'hall', 'chambers'],
    motto: 'Hat in the Ring',
    description: 'The first American pursuit squadron in action. Eddie Rickenbacker, America\'s ace of aces, commanded it from September 1918.',
  },
  {
    id: 'us95', name: '95th Aero Squadron', shortName: '95th Aero', nation: 'usa',
    formed: '1918-03-05', disbanded: END,
    bases: [base('1918-03-05', END, 'allonville')],
    equipment: [eq('1918-03-05', '1918-07-31', 'nieuport_28'), eq('1918-07-15', END, 'spad_xiii')],
    notableAces: [],
    motto: 'Kicking mule',
    description: 'The 94th\'s rival squadron of the 1st Pursuit Group.',
  },
  {
    id: 'us27', name: '27th Aero Squadron', shortName: '27th Aero', nation: 'usa',
    formed: '1918-06-01', disbanded: END,
    bases: [base('1918-06-01', END, 'allonville')],
    equipment: [eq('1918-06-01', '1918-07-31', 'nieuport_28'), eq('1918-07-15', END, 'spad_xiii')],
    notableAces: ['luke'],
    motto: 'Eagle',
    description: 'Home of Frank Luke, the "Arizona Balloon Buster".',
  },
  {
    id: 'us147', name: '147th Aero Squadron', shortName: '147th Aero', nation: 'usa',
    formed: '1918-06-01', disbanded: END,
    bases: [base('1918-06-01', END, 'allonville')],
    equipment: [eq('1918-06-01', '1918-07-31', 'nieuport_28'), eq('1918-07-15', END, 'spad_xiii')],
    notableAces: [],
    motto: 'Who said rats?',
    description: 'A 1st Pursuit Group squadron whose ratter terrier insignia chased the German "rats".',
  },
  {
    id: 'us17', name: '17th Aero Squadron', shortName: '17th Aero', nation: 'usa',
    formed: '1918-05-15', disbanded: END,
    bases: [base('1918-05-15', END, 'petite-synthe')],
    equipment: [eq('1918-05-15', END, 'sopwith_camel')],
    notableAces: ['vaughn'],
    description: 'An American Camel squadron attached to the Royal Air Force in Flanders and Picardy.',
  },
  {
    id: 'us148', name: '148th Aero Squadron', shortName: '148th Aero', nation: 'usa',
    formed: '1918-07-01', disbanded: END,
    bases: [base('1918-07-01', END, 'petite-synthe')],
    equipment: [eq('1918-07-01', END, 'sopwith_camel')],
    notableAces: ['springs', 'kindley'],
    description: 'The 17th\'s sister Camel squadron with the RAF, home of Elliott White Springs and Field Kindley.',
  },
];

/** Successor unit when a squadron is disbanded (pilots transfer with it). */
export const SQUADRON_SUCCESSORS: Record<string, string> = {
  ffa62: 'jasta2',
  n124: 'us103',
};

export const SQUADRONS: readonly SquadronInfo[] = DEFS.map((d) => ({
  ...d,
  livery: composeLivery({ aircraftId: d.equipment[0].aircraft[0], nation: d.nation, date: d.formed, squadronId: d.id }),
}));

export function getSquadronInfo(id: string): SquadronInfo | undefined {
  return SQUADRONS.find((s) => s.id === id);
}
