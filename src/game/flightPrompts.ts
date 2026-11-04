const PILOT_HINT = 'Pilot: left stick flies; right stick looks; LB/RB steer rudder; RT fires; LT blips; A clears a jam; X cycles target; Y padlocks; R3 padlocks the nearest enemy; B selects chase view; L3 selects cockpit view; View opens the map; Menu pauses; D-pad up/down changes throttle and left/right changes time compression. Other actions are in Menu → Flight actions.';
const GUNNER_HINT = 'Gunner: left stick aims; right stick looks; RT fires; A clears a jam; LB/RB change crew station; B returns to the pilot. X cycles target unless you are in bombsight view. View opens the map; Menu pauses. Other actions are in Menu → Flight actions.';
const PILOT_BOMBSIGHT_HINT = 'Pilot in bombsight view: left stick flies; right stick looks; LB/RB steer rudder; RT fires; LT blips; A clears a jam; hold X to release a bomb instead of cycling target; Y padlocks; R3 padlocks the nearest enemy; B selects chase view; L3 selects cockpit view; View opens the map; Menu pauses; D-pad up/down changes throttle and left/right changes time compression. Other actions are in Menu → Flight actions.';
const GUNNER_BOMBSIGHT_HINT = 'At the gunner’s bombsight: left stick aims; right stick looks; RT fires; A clears a jam; LB/RB change crew station; hold X to release a bomb instead of cycling target; B returns to the pilot. View opens the map; Menu pauses. Other actions are in Menu → Flight actions.';

/** Return the frozen standard-controller hint for the current flight control context. */
export function controllerFlightHint(atGun: boolean, bombsight: boolean): string {
  if (bombsight) return atGun ? GUNNER_BOMBSIGHT_HINT : PILOT_BOMBSIGHT_HINT;
  return atGun ? GUNNER_HINT : PILOT_HINT;
}
