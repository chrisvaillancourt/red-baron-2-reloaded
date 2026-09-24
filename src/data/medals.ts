/**
 * Decorations and their (simplified, historically inspired) award criteria.
 * Evaluated by src/campaign/awards.ts after each debrief. Each medal is
 * awarded at most once per pilot (bars/clasps are not modelled).
 *
 * Citation templates accept {name}, {rank}, {victories}, {squadron}, {date}.
 */
import type { Nation } from '../core/types';

export interface MedalDef {
  id: string;
  name: string;
  /** Awarding state (for foreign awards this differs from the recipient's nation). */
  awardedBy: Nation;
  /** Recipient nations eligible for this award. */
  recipients: Nation[];
  /** Higher = more prestigious; used to order the medal case. */
  precedence: number;
  description: string;
  /** Ribbon stripe colours for UI rendering, left to right. */
  ribbon: string[];
  officerOnly?: boolean;
  /** Awarded only to NCOs and other ranks. */
  enlistedOnly?: boolean;
  /** Medal ids that must be held first. */
  requires?: string[];
  availableFrom?: string;
  availableTo?: string;
  /** Confirmed-victory threshold; a function of date allows rising bars (Pour le Mérite). */
  minVictories?: number | ((date: string) => number);
  minMissions?: number;
  /** Special triggers evaluated per mission rather than by totals. */
  trigger?: 'wounded';
  citation: string;
}

export const MEDALS: readonly MedalDef[] = [
  // ------------------------------------------------------------ Germany
  {
    id: 'ek2', name: 'Iron Cross 2nd Class', awardedBy: 'germany', recipients: ['germany'], precedence: 10,
    description: 'Eisernes Kreuz II. Klasse, worn as a ribbon in the buttonhole.', ribbon: ['#111', '#fff', '#111'],
    minVictories: 1, minMissions: 12,
    citation: 'For bravery before the enemy, {rank} {name} of {squadron} is awarded the Iron Cross, Second Class.',
  },
  {
    id: 'ek1', name: 'Iron Cross 1st Class', awardedBy: 'germany', recipients: ['germany'], precedence: 20,
    description: 'Eisernes Kreuz I. Klasse, the pin-backed cross worn on the breast.', ribbon: ['#111', '#fff', '#111'],
    requires: ['ek2'], minVictories: 3,
    citation: 'In recognition of {victories} aerial victories, {rank} {name} is awarded the Iron Cross, First Class.',
  },
  {
    id: 'wound-badge', name: 'Wound Badge (Black)', awardedBy: 'germany', recipients: ['germany'], precedence: 5,
    description: 'Verwundetenabzeichen, instituted March 1918.', ribbon: ['#222'],
    availableFrom: '1918-03-03', trigger: 'wounded',
    citation: '{rank} {name}, wounded in aerial combat, is awarded the Wound Badge in Black.',
  },
  {
    id: 'hohenzollern', name: 'Knight\'s Cross of the Royal House Order of Hohenzollern with Swords', awardedBy: 'germany', recipients: ['germany'], precedence: 40,
    description: 'The customary stepping stone to the Pour le Mérite for Prussian officers.', ribbon: ['#fff', '#111', '#fff', '#111', '#fff'],
    officerOnly: true, requires: ['ek1'], minVictories: (d) => (d < '1917-01-01' ? 6 : d < '1918-01-01' ? 12 : 15),
    citation: 'His Majesty the King of Prussia confers upon {rank} {name} the Knight\'s Cross with Swords of the Royal House Order of Hohenzollern, in recognition of {victories} victories.',
  },
  {
    id: 'plm', name: 'Pour le Mérite', awardedBy: 'germany', recipients: ['germany'], precedence: 60,
    description: 'Prussia\'s highest order for valour - the "Blue Max".', ribbon: ['#111', '#fff', '#111'],
    officerOnly: true, requires: ['hohenzollern'], minVictories: (d) => (d < '1917-01-01' ? 8 : d < '1918-01-01' ? 16 : 20),
    citation: 'His Majesty the Kaiser has been graciously pleased to award {rank} {name}, {squadron}, the order Pour le Mérite after his {victories}th victory in the air.',
  },
  {
    id: 'goldene-mvk', name: 'Golden Military Merit Cross', awardedBy: 'germany', recipients: ['germany'], precedence: 55,
    description: 'Prussia\'s highest award for NCOs and men - the NCO\'s "Pour le Mérite".', ribbon: ['#111', '#fff', '#111'],
    enlistedOnly: true, requires: ['ek1'], minVictories: 15,
    citation: 'For conspicuous gallantry in {victories} air combats, {rank} {name} receives the Golden Military Merit Cross.',
  },

  // ------------------------------------------------------------ Britain
  {
    id: 'mc', name: 'Military Cross', awardedBy: 'britain', recipients: ['britain'], precedence: 30,
    description: 'Awarded to officers for gallantry in active operations.', ribbon: ['#fff', '#6a2d8a', '#fff'],
    officerOnly: true, minVictories: 3, availableTo: '1918-06-02',
    citation: 'For conspicuous gallantry and devotion to duty. {rank} {name}, {squadron}, has destroyed {victories} enemy machines, attacking with the utmost dash and determination.',
  },
  {
    id: 'dfc', name: 'Distinguished Flying Cross', awardedBy: 'britain', recipients: ['britain'], precedence: 32,
    description: 'Instituted 3 June 1918 for acts of valour in the air by RAF officers.', ribbon: ['#6a2d8a', '#fff', '#6a2d8a', '#fff', '#6a2d8a'],
    officerOnly: true, minVictories: 5, availableFrom: '1918-06-03',
    citation: 'A gallant and skilful officer. {rank} {name} has accounted for {victories} enemy machines and has at all times set a fine example to his flight.',
  },
  {
    id: 'dso', name: 'Distinguished Service Order', awardedBy: 'britain', recipients: ['britain'], precedence: 45,
    description: 'For distinguished service under fire, usually to officers of field rank or proven leaders.', ribbon: ['#b3261e', '#1f3a8a', '#b3261e'],
    officerOnly: true, minVictories: 12,
    citation: 'For conspicuous gallantry and skill in leading offensive patrols. {rank} {name} has destroyed {victories} enemy aircraft and has displayed the greatest courage throughout.',
  },
  {
    id: 'vc', name: 'Victoria Cross', awardedBy: 'britain', recipients: ['britain'], precedence: 70,
    description: '"For Valour" - the highest award for gallantry in the face of the enemy.', ribbon: ['#8a1c2b'],
    minVictories: 30, requires: ['dso'],
    citation: 'For most conspicuous and consistent bravery. {rank} {name}, {squadron}, has in all accounted for {victories} enemy machines, frequently engaging superior numbers with complete disregard of personal danger.',
  },
  {
    id: 'mm', name: 'Military Medal', awardedBy: 'britain', recipients: ['britain'], precedence: 15,
    description: 'For bravery in the field, awarded to other ranks.', ribbon: ['#1f3a8a', '#fff', '#b3261e', '#fff', '#1f3a8a'],
    enlistedOnly: true, minVictories: 2,
    citation: 'For bravery in the field: {rank} {name} pressed home his attack in the face of heavy fire.',
  },

  // ------------------------------------------------------------ France
  {
    id: 'cdg', name: 'Croix de Guerre', awardedBy: 'france', recipients: ['france'], precedence: 20,
    description: 'Awarded with a citation in orders; each further citation adds a palm or star.', ribbon: ['#2e7d32', '#b3261e', '#2e7d32', '#b3261e', '#2e7d32'],
    minVictories: 1,
    citation: 'Cité à l\'ordre de l\'armée: {rank} {name}, pilote de chasse d\'une grande bravoure, a abattu son {victories}e avion ennemi.',
  },
  {
    id: 'medaille-militaire', name: 'Médaille militaire', awardedBy: 'france', recipients: ['france'], precedence: 35,
    description: 'France\'s highest award for NCOs and soldiers - also given to victorious generals.', ribbon: ['#e6c34a', '#2e7d32', '#e6c34a'],
    minVictories: 5, requires: ['cdg'],
    citation: '{rank} {name}: pilote d\'élite, modèle de courage et d\'audace. {victories} victoires.',
  },
  {
    id: 'legion-chevalier', name: 'Légion d\'honneur (Chevalier)', awardedBy: 'france', recipients: ['france', 'usa', 'britain'], precedence: 50,
    description: 'The Legion of Honour, Knight class.', ribbon: ['#c62828'],
    minVictories: (d) => (d < '1917-06-01' ? 8 : 10),
    citation: '{rank} {name}, {squadron}: officier de haute valeur morale, a remporté {victories} victoires aériennes. Nommé Chevalier de la Légion d\'honneur.',
  },
  {
    id: 'legion-officier', name: 'Légion d\'honneur (Officier)', awardedBy: 'france', recipients: ['france'], precedence: 65,
    description: 'The Legion of Honour, Officer class, with rosette.', ribbon: ['#c62828'],
    requires: ['legion-chevalier'], minVictories: 25,
    citation: 'Promu Officier de la Légion d\'honneur: {rank} {name}, as incomparable de l\'aviation de chasse, {victories} avions abattus.',
  },

  // ------------------------------------------------------------ USA
  {
    id: 'dsc', name: 'Distinguished Service Cross', awardedBy: 'usa', recipients: ['usa'], precedence: 40,
    description: 'The US Army\'s second-highest award for extraordinary heroism.', ribbon: ['#1f3a8a', '#b3261e', '#fff', '#b3261e', '#1f3a8a'],
    minVictories: 3,
    citation: 'For extraordinary heroism in action. {rank} {name}, {squadron}, attacked a superior force of enemy aircraft and brought down {victories} machines in all.',
  },
  {
    id: 'moh', name: 'Medal of Honor', awardedBy: 'usa', recipients: ['usa'], precedence: 70,
    description: 'The highest American award for valour.', ribbon: ['#6fa8dc'],
    requires: ['dsc'], minVictories: 18,
    citation: 'For conspicuous gallantry and intrepidity above and beyond the call of duty in action with the enemy. {rank} {name} has destroyed {victories} enemy aircraft and balloons.',
  },
  {
    id: 'cdg-foreign', name: 'Croix de Guerre (French award)', awardedBy: 'france', recipients: ['usa', 'britain'], precedence: 18,
    description: 'French Croix de Guerre conferred on an allied airman.', ribbon: ['#2e7d32', '#b3261e', '#2e7d32', '#b3261e', '#2e7d32'],
    minVictories: (d) => (d < '1918-01-01' ? 8 : 4),
    citation: 'La République française confère la Croix de Guerre avec palme à {rank} {name} pour {victories} victoires remportées aux côtés de l\'aviation française.',
  },
];

export function getMedal(id: string): MedalDef | undefined {
  return MEDALS.find((m) => m.id === id);
}
