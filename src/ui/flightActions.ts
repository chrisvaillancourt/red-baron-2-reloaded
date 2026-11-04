import type { EdgeAction } from '../game/input';

/** Common flight commands shared by touch and the paused controller menu. */
export const ACTION_GROUPS: { label: string; actions: [EdgeAction, string][] }[] = [
  { label: 'Views & targets', actions: [
    ['viewCockpit', 'Cockpit view'], ['viewChase', 'Chase view'], ['viewPadlock', 'Padlock view'],
    ['viewTarget', 'Target view'], ['viewFlyby', 'Fly-by view'], ['nextTarget', 'Next target'], ['padlockNearest', 'Nearest enemy'],
  ] },
  { label: 'Navigation & time', actions: [['map', 'Map'], ['timeNormal', 'Normal time'], ['timeCompress', 'Compress time']] },
  { label: 'Crew & weapons', actions: [
    ['stationNext', 'Next crew station'], ['stationPrev', 'Previous crew station'], ['stationPilot', 'Pilot station'],
    ['viewBombsight', 'Bombsight'], ['releaseBomb', 'Release bomb'], ['clearJam', 'Clear gun jam'],
  ] },
  { label: 'Engine', actions: [['throttleFull', 'Full throttle'], ['throttleCut', 'Cut throttle']] },
  { label: 'Wingmen', actions: [
    ['wingmenAttack', 'Attack my target'], ['wingmenEngage', 'Engage enemies'], ['wingmenFormUp', 'Form up'],
    ['wingmenCover', 'Cover me'], ['wingmenHome', 'Return home'],
  ] },
  { label: 'Flight', actions: [['toggleHud', 'Show / hide HUD'], ['endFlight', 'End flight']] },
];
