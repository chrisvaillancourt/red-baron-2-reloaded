/**
 * Historical timeline of the air war in the sector, used for briefing
 * flavour, mission-type weighting and debrief news. Each event carries
 * per-side briefing lines in period voice.
 */
import type { MissionType, Side } from '../core/types';

export interface HistoricalEvent {
  id: string;
  title: string;
  from: string;
  to: string;
  /** Town (from geography TOWNS) the fighting centred on. */
  focusTown: string;
  summary: string;
  briefing: Record<Side, string>;
  /** Mission types that become more common during the event. */
  emphasis: MissionType[];
  /** Relative air activity 0.5 (quiet) .. 1.5 (maximum effort). */
  intensity: number;
}

export const HISTORY: readonly HistoricalEvent[] = [
  {
    id: 'fokker-scourge', title: 'The Fokker Scourge', from: '1915-08-01', to: '1916-02-28', focusTown: 'Douai', intensity: 0.8,
    summary: 'German Eindeckers with synchronised guns dominate the sky over Artois.',
    briefing: {
      central: 'Our Fokker monoplanes have given the enemy a thorough fright. Hauptmann Boelcke\'s rule holds: attack from the sun, and fire only at close range.',
      allied: 'The Fokker menace continues. Headquarters orders that every reconnaissance machine is to be escorted, and no fighting pilot is to break off an escort for any reason.',
    },
    emphasis: ['escort', 'intercept'],
  },
  {
    id: 'somme', title: 'The Battle of the Somme', from: '1916-07-01', to: '1916-11-18', focusTown: 'Albert', intensity: 1.3,
    summary: 'The great Anglo-French offensive astride the Somme. Allied air superiority early, contested by the new Jagdstaffeln from September.',
    briefing: {
      central: 'The enemy is attacking in overwhelming strength on the Somme. The new Jagdstaffeln must win back the sky over our infantry at any cost.',
      allied: 'The Push goes on along the Somme. Our observation machines must work unmolested: keep the Hun scouts well east of the lines.',
    },
    emphasis: ['patrol', 'escort', 'balloon-attack', 'ground-attack'],
  },
  {
    id: 'hindenburg-withdrawal', title: 'Operation Alberich', from: '1917-02-09', to: '1917-03-20', focusTown: 'Bapaume', intensity: 0.9,
    summary: 'The German army withdraws to the fortified Hindenburg Line, laying waste to the ground it abandons.',
    briefing: {
      central: 'The army is falling back to the Siegfried position. Enemy reconnaissance must not observe the withdrawal.',
      allied: 'The Boche is pulling back towards Cambrai. We need to know where he intends to stand - reconnaissance machines are going deep.',
    },
    emphasis: ['intercept', 'escort'],
  },
  {
    id: 'bloody-april', title: 'Bloody April', from: '1917-04-01', to: '1917-05-15', focusTown: 'Arras', intensity: 1.5,
    summary: 'The Battle of Arras. The RFC loses a third of its strength to the Albatros-equipped Jastas; Jasta 11 is at its deadliest.',
    briefing: {
      central: 'The English are attacking at Arras with every aeroplane they own. Their machines are outclassed: shoot them down in droves.',
      allied: 'The Army attacks at Arras and Vimy Ridge. Casualties in the Corps squadrons have been heavy - the red Albatros scouts of Jasta 11 are active over Douai.',
    },
    emphasis: ['escort', 'patrol', 'balloon-attack'],
  },
  {
    id: 'messines', title: 'The Battle of Messines', from: '1917-06-07', to: '1917-06-14', focusTown: 'Ypres', intensity: 1.2,
    summary: 'Nineteen great mines are blown under Messines Ridge.',
    briefing: {
      central: 'The enemy has blown up the Wytschaete salient. Every Staffel in Flanders is to attack the English artillery flyers.',
      allied: 'The Army has taken Messines Ridge. Keep the Hun away from our new positions and shoot down his balloons.',
    },
    emphasis: ['balloon-attack', 'ground-attack', 'patrol'],
  },
  {
    id: 'third-ypres', title: 'Third Ypres (Passchendaele)', from: '1917-07-31', to: '1917-11-10', focusTown: 'Passchendaele', intensity: 1.4,
    summary: 'The long, mud-drowned offensive towards Passchendaele. Jagdgeschwader I fights the RFC over Flanders.',
    briefing: {
      central: 'The great battle in Flanders rages on. The Geschwader is concentrated at Courtrai: meet the enemy over the salient.',
      allied: 'The offensive toward Passchendaele continues. Low work over the salient is urgently required, and the Hun Circus has been seen near Menin.',
    },
    emphasis: ['patrol', 'ground-attack', 'escort'],
  },
  {
    id: 'cambrai', title: 'The Battle of Cambrai', from: '1917-11-20', to: '1917-12-07', focusTown: 'Cambrai', intensity: 1.3,
    summary: 'Massed British tanks break the Hindenburg Line; the Germans counter-attack ten days later.',
    briefing: {
      central: 'English tanks have broken through at Cambrai. Richthofen\'s Geschwader is rushed south: strafe their columns and drive off their low-flyers.',
      allied: 'Tanks have broken the Hindenburg Line before Cambrai. Fighting squadrons are to go down low and harass the enemy\'s guns and reserves.',
    },
    emphasis: ['ground-attack', 'patrol'],
  },
  {
    id: 'michael', title: 'The Kaiserschlacht (Operation Michael)', from: '1918-03-21', to: '1918-04-05', focusTown: 'St-Quentin', intensity: 1.5,
    summary: 'The German spring offensive smashes the British Fifth Army and drives almost to Amiens.',
    briefing: {
      central: 'The great offensive has begun! The enemy is in full retreat across the old Somme battlefield. Support the infantry and keep the skies clear.',
      allied: 'The enemy has broken through on the Fifth Army front. Every machine is to fly low-level attacks against his advancing columns.',
    },
    emphasis: ['ground-attack', 'patrol', 'airfield-attack'],
  },
  {
    id: 'lys', title: 'The Battle of the Lys (Georgette)', from: '1918-04-09', to: '1918-04-29', focusTown: 'Armentières', intensity: 1.3,
    summary: 'The second German spring offensive, in Flanders towards Hazebrouck.',
    briefing: {
      central: 'The attack in Flanders is going well. Armentières has fallen - press on toward Hazebrouck.',
      allied: 'With our backs to the wall, every squadron must keep the Hun from the Channel ports.',
    },
    emphasis: ['ground-attack', 'patrol'],
  },
  {
    id: 'amiens', title: 'The Battle of Amiens', from: '1918-08-08', to: '1918-08-31', focusTown: 'Villers-Bretonneux', intensity: 1.5,
    summary: 'The "Black Day of the German Army": the start of the Hundred Days offensive.',
    briefing: {
      central: 'The enemy attacked in fog east of Amiens and has broken our line. The Somme bridges must be held; shoot down the bombers attacking them.',
      allied: 'The Army has struck east of Amiens. Bomb and strafe the Somme bridges; the Fokker Staffeln will be up in numbers.',
    },
    emphasis: ['escort', 'ground-attack', 'intercept'],
  },
  {
    id: 'hundred-days', title: 'The Hundred Days', from: '1918-09-01', to: '1918-11-10', focusTown: 'Cambrai', intensity: 1.2,
    summary: 'The Allies break the Hindenburg Line and advance across Artois and Flanders.',
    briefing: {
      central: 'The army is falling back to new positions. Fuel and pilots are short, but the D.VII is still master of the sky - make every sortie count.',
      allied: 'The Hindenburg Line is breached and the enemy is in retreat. Keep up the pressure: his fighters are still dangerous.',
    },
    emphasis: ['ground-attack', 'patrol', 'balloon-attack'],
  },
  {
    id: 'armistice', title: 'The Armistice', from: '1918-11-11', to: '1918-11-11', focusTown: 'Valenciennes', intensity: 0.5,
    summary: 'At the eleventh hour of the eleventh day of the eleventh month, the guns fall silent.',
    briefing: {
      central: 'The Armistice has been signed. The war is over.',
      allied: 'The Armistice has been signed. The war is over.',
    },
    emphasis: [],
  },
];

/** The most specific historical event covering `date`, if any. */
export function eventOn(date: string): HistoricalEvent | undefined {
  return HISTORY.filter((e) => e.from <= date && date <= e.to).sort((a, b) => (a.from < b.from ? 1 : -1))[0];
}
