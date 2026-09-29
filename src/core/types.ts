/**
 * Shared contracts for Red Baron II: Reloaded.
 *
 * Every module imports its cross-module types from here. Change these with
 * care: several subsystems are built against them in parallel. See
 * docs/ARCHITECTURE.md for the module map and DECISIONS.md for rationale.
 *
 * Conventions (see DECISIONS.md D-004):
 *  - Units are SI: metres, seconds, kilograms, radians, newtons, watts.
 *  - World frame: +X east, +Y up, -Z north. Heading 0 = north, increasing clockwise.
 *  - Body frame (aircraft local): forward = -Z, up = +Y, right = +X.
 *  - Dates are ISO strings 'YYYY-MM-DD'. The game spans 1915-07-01 .. 1918-11-11.
 */
import type { Quaternion, Vector3 } from 'three';

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export type Side = 'central' | 'allied';
export type Nation = 'germany' | 'britain' | 'france' | 'usa';

export const NATION_SIDE: Record<Nation, Side> = {
  germany: 'central',
  britain: 'allied',
  france: 'allied',
  usa: 'allied',
};

export type SkillLevel = 'novice' | 'regular' | 'veteran' | 'ace';

// ---------------------------------------------------------------------------
// Aircraft specification (static data; see src/data/aircraft.ts)
// ---------------------------------------------------------------------------

export type WingLayout = 'monoplane' | 'parasol' | 'biplane' | 'sesquiplane' | 'triplane';
export type EngineType = 'rotary' | 'inline' | 'twin-inline';
export type AircraftRole = 'fighter' | 'two-seater' | 'bomber';

export type GunType = 'spandau' | 'parabellum' | 'vickers' | 'lewis' | 'hotchkiss';

export interface GunMount {
  type: GunType;
  /** Mount position in body frame, metres. */
  position: [number, number, number];
  /** 'fixed' fires along the body -Z axis (plus convergence); 'flexible' is an AI/rear gunner on a ring. */
  mount: 'fixed-synchronized' | 'fixed-overwing' | 'fixed-pusher' | 'flexible';
  /** Rounds per belt (fixed Vickers/Spandau), per drum (Lewis, Parabellum) or per strip (Hotchkiss). */
  rounds: number;
  /** Spare drums or strips carried (0 for belt-fed guns). */
  spareDrums: number;
}

export interface GunSpec {
  type: GunType;
  name: string;
  /** Cyclic rate, rounds per minute (synchronized guns are slower). */
  rpmSynchronized: number;
  rpmFree: number;
  muzzleVelocity: number; // m/s
  bulletMass: number; // kg
  /** Base per-round jam probability at cold barrel; scaled by heat. */
  jamChancePerRound: number;
  /** Seconds to swap a Lewis drum. */
  drumChangeTime: number;
}

export interface AircraftGeometry {
  layout: WingLayout;
  /** Pusher = engine behind pilot (DH.2). */
  pusher: boolean;
  span: number; // upper/main wing span, m
  lowerSpan: number; // 0 for monoplane/parasol
  middleSpan: number; // triplanes only, else 0
  chord: number; // upper wing chord, m
  lowerChord: number;
  gap: number; // vertical gap between wings, m
  stagger: number; // upper wing forward offset, m (positive = upper ahead)
  dihedralDeg: number;
  length: number; // overall length, m
  height: number;
  fuselageWidth: number; // max width, m
  fuselageShape: 'slab' | 'round' | 'plywood-oval';
  tailShape: 'comma' | 'rounded' | 'squared' | 'triangular';
  /**
   * Crew carried: 1 for a single-seater, 2 for a two-seater, 3 or 4 for the heavy bombers
   * (Gotha G.V 3, Handley Page O/400 4). Test `crew >= 2` for "has a gunner", not `=== 2`.
   */
  crew: 1 | 2 | 3 | 4;
  wheelTrack: number;
  /**
   * Twin-engine types: how far each engine nacelle sits from the centre line, m. Absent or 0
   * means the engine is on the centre line. The flight model, hit boxes and models share it.
   */
  nacelleOffsetX?: number;
}

export interface AircraftPerformance {
  /**
   * Loaded (combat) mass, kg, including the full bomb load in `AircraftSpec.bombs`. The flight
   * model subtracts the mass of bombs released or not carried (`AircraftEntity.bombs`).
   */
  massLoaded: number;
  massEmpty: number;
  wingArea: number; // m^2 total
  /** Total for all engines (a Gotha G.V's two 260 hp Mercedes are 520). */
  enginePowerHp: number;
  /** Engines fitted; absent means 1. Twins split `enginePowerHp` evenly between them. */
  engineCount?: number;
  engineType: EngineType;
  engineName: string;
  /** Historical figures used to tune/validate the flight model. */
  maxSpeedKmh: number; // at the altitude below
  maxSpeedAltM: number;
  ceilingM: number;
  climbTo3000mMin: number; // minutes to 3000 m
  enduranceHours: number;
  /** Handling notes, 0..1 relative scales. */
  rollRate: number; // 1 = Camel-class, 0.5 = sluggish two-seater
  pitchRate: number;
  structuralStrength: number; // 1 = sturdy (SPAD), 0.6 = fragile (Albatros lower wing, Nieuport)
  /** Mean rate of fuel burn, litres/hour at cruise. */
  fuelCapacityL: number;
}

export interface AircraftSpec {
  id: AircraftId;
  name: string; // "Fokker Dr.I"
  shortName: string; // "Dr.I"
  manufacturer: string;
  nation: Nation; // primary user; 'britain' for Camel, etc.
  /** Other nations that flew it (e.g. SPAD XIII used by France, Britain, USA). */
  alsoUsedBy: Nation[];
  role: AircraftRole;
  flyable: boolean;
  /** Service window, ISO dates. */
  introduced: string;
  retired: string;
  description: string;
  geometry: AircraftGeometry;
  performance: AircraftPerformance;
  guns: GunMount[];
  /**
   * Every crew position, pilot first. Absent: `crewStations(spec)` in src/data/crew.ts
   * derives the pilot and, for a type with a flexible gun, one observer. Always read the
   * stations through that helper, never this field directly.
   */
  crewStations?: CrewStation[];
  /** The bomb load for a bombing sortie. Absent means no bomb racks. */
  bombs?: BombStore[];
}

// ---------------------------------------------------------------------------
// Crew stations and bombs (docs/bombers.md)
// ---------------------------------------------------------------------------

export type CrewStationId = 'pilot' | 'observer' | 'nose' | 'dorsal' | 'ventral' | 'rear';

/**
 * A box of directions in the body frame. Azimuth 0 is dead ahead, +90 right, -90 left and
 * ±180 astern. The box runs clockwise from `azimuthDeg[0]` to `azimuthDeg[1]` and may wrap
 * through astern ([150, -150] is a 60° cone over the tail). Elevation +90 is straight up,
 * relative to the aircraft's own wings, not the horizon.
 */
export interface FireArc {
  azimuthDeg: [number, number];
  elevationDeg: [number, number];
}

/** A place a crew member works from: the pilot's seat, a gun ring, the ventral tunnel. */
export interface CrewStation {
  id: CrewStationId;
  /** For the HUD and the Quick Mission seat picker: "Pilot", "Rear gunner", "Nose gunner". */
  label: string;
  /**
   * The crew member who works this station, 0 for the pilot. One man can move between
   * stations (the Gotha's rear gunner works the dorsal gun and the ventral tunnel gun), so
   * stations that share an index fire one at a time, and his wound silences all of them.
   */
  crewIndex: number;
  /** Indices into `spec.guns` fired from this station. */
  guns: number[];
  /**
   * Where this station's flexible guns can bear: a direction is in the field of fire when
   * it lies inside any arc. Empty for the pilot, whose fixed guns fire along the nose.
   */
  arcs: FireArc[];
  /**
   * Eye point, body frame, m. Absent: the model's EyePoint for the pilot, and for a gunner
   * 0.45 m above and 0.35 m behind his first gun's mount.
   */
  eye?: [number, number, number];
  /** Aims and releases the bombs (the D.H.4's observer, the Gotha's nose gunner). */
  bombAimer?: boolean;
}

/** One kind of bomb in a load, e.g. six 50 kg P.u.W. bombs. */
export interface BombStore {
  /** Period name: "P.u.W. 50 kg", "112 lb R.L. HE". */
  name: string;
  massKg: number;
  /** Charge mass, kg; sets the blast radius. */
  explosiveKg: number;
  count: number;
}

export type AircraftId =
  // Central Powers
  | 'fokker_eiii'
  | 'albatros_dii'
  | 'albatros_diii'
  | 'albatros_dv'
  | 'pfalz_diiia'
  | 'fokker_dri'
  | 'fokker_dvii'
  | 'fokker_dviii'
  | 'halberstadt_clii'
  | 'rumpler_civ'
  | 'albatros_ciii'
  // Allies
  | 'airco_dh2'
  | 'nieuport_11'
  | 'nieuport_17'
  | 'sopwith_pup'
  | 'sopwith_triplane'
  | 'spad_vii'
  | 'spad_xiii'
  | 'se5a'
  | 'sopwith_camel'
  | 'nieuport_28'
  | 'bristol_f2b'
  | 're8'
  | 'dh4'
  | 'be2c'
  | 'fe2b'
  | 'farman_f40';

// ---------------------------------------------------------------------------
// Liveries
// ---------------------------------------------------------------------------

export interface Livery {
  /** Main fuselage colour (CSS hex). */
  fuselage: string;
  /** Wing upper surface colour. */
  wingTop: string;
  wingBottom: string;
  tail: string;
  cowling: string;
  /** Nose/spinner or trim colour. */
  accent: string;
  /** National insignia style. */
  insignia: 'iron-cross-patee' | 'balkenkreuz' | 'roundel-rfc' | 'roundel-france' | 'roundel-usa';
  /** Optional identifying marking: letter/number painted on fuselage. */
  marking?: string;
  /** Optional pattern key (e.g. 'lozenge', 'streaked', 'stripes'); renderer may ignore. */
  pattern?: 'plain' | 'lozenge' | 'streaked' | 'clear-doped' | 'pc10' | 'stripes';
}

// ---------------------------------------------------------------------------
// Runtime flight state
// ---------------------------------------------------------------------------

export interface ControlInputs {
  /** -1..1, positive = nose up (stick back). */
  pitch: number;
  /** -1..1, positive = roll right. */
  roll: number;
  /** -1..1, positive = yaw right (right rudder). */
  yaw: number;
  /** 0..1 */
  throttle: number;
  /** Rotary-engine blip switch: cuts ignition while held. */
  blip: boolean;
  fireGuns: boolean;
  /** Pressed to hammer at a jammed gun. Edge-triggered by the input layer. */
  clearJam: boolean;
  /**
   * Release the next bomb (edge-triggered): the pilot's release, or an AI bomb aimer's.
   * The player working the bombsight uses `StationInputs.releaseBomb` instead.
   */
  releaseBomb?: boolean;
}

/**
 * The player working a crew station other than the pilot's. The AI flies the aircraft
 * (writing `controls` as usual); these inputs drive the guns, and for a bomb aimer the
 * release, at `station`. Station inputs override the AI gunner at that station only.
 */
export interface StationInputs {
  station: CrewStationId;
  /** World-frame unit vector the player aims the station's guns along. */
  aim: Vector3;
  fire: boolean;
  /** Edge-triggered, for a bomb-aimer station. */
  releaseBomb: boolean;
  /** Edge-triggered, like `ControlInputs.clearJam`. */
  clearJam: boolean;
}

export interface FlightState {
  position: Vector3; // world, m
  velocity: Vector3; // world, m/s
  orientation: Quaternion; // body -> world
  angularVelocity: Vector3; // body frame, rad/s (x = pitch rate, y = yaw rate, z = roll rate)
  /** Derived each step, for HUD/AI convenience. */
  airspeed: number; // m/s true airspeed
  altitude: number; // m above sea level
  heightAboveGround: number;
  aoa: number; // angle of attack, rad
  sideslip: number; // rad
  gLoad: number; // normal load factor
  engineRpm: number;
  fuelL: number;
  onGround: boolean;
  stalled: boolean;
}

export interface GunState {
  mountIndex: number;
  roundsLeft: number; // in current belt/drum
  sparesLeft: number; // Lewis drums remaining
  jammed: boolean;
  /** Clear-jam progress 0..1, advanced by clearJam presses. */
  jamClearProgress: number;
  heat: number; // 0..1
  cooldown: number; // s until next round can fire
  reloading: number; // s remaining on drum change
}

export type DamageZone =
  | 'engine'
  | 'fuelTank'
  | 'pilot'
  | 'gunner'
  | 'leftWing'
  | 'rightWing'
  | 'tail'
  | 'fuselage'
  | 'controls'
  | 'guns';

export interface DamageState {
  /** 0 = pristine, 1 = destroyed, per zone. */
  zones: Record<DamageZone, number>;
  onFire: boolean;
  smoking: boolean;
  fuelLeak: boolean;
  engineDead: boolean;
  pilotWounded: boolean;
  pilotKilled: boolean;
  /** Structure failed (wing folded / tail off): aircraft is out of control. */
  structuralFailure: boolean;
  destroyed: boolean;
  /** Entity id of the last aircraft that damaged us (for kill credit). */
  lastAttackerId: number | null;
  /**
   * Wounds per crew member (`CrewStation.crewIndex`), 0..1, 1 killed. Index 0 mirrors the
   * pilot. Absent: the `gunner` zone stands for the whole rear crew, as for the two-seaters.
   */
  crewWounds?: number[];
  /** Damage per engine, 0..1, for multi-engine types. The `engine` zone holds the worst. */
  engines?: number[];
}

export type PilotController = 'player' | 'ai' | 'none';

/** Runtime aircraft. Owned by the flight session; mutated by sim/ai/combat systems. */
export interface AircraftEntity {
  id: number;
  kind: 'aircraft';
  spec: AircraftSpec;
  side: Side;
  nation: Nation;
  livery: Livery;
  /** Display name: "Ltn. M. von Richthofen" or "Albatros D.V #3". */
  callsign: string;
  /** Historical ace id if this is a named ace (see src/data/aces.ts). */
  aceId?: string;
  skill: SkillLevel;
  flightId: string; // MissionFlight.id this aircraft belongs to
  controller: PilotController;
  controls: ControlInputs;
  state: FlightState;
  guns: GunState[];
  damage: DamageState;
  /** Mission time the aircraft was removed from play (crashed/landed/etc). */
  outcome: AircraftOutcome | null;
  /** Bombs still aboard, one count per `spec.bombs` store. Absent: the sortie carries none. */
  bombs?: number[];
  /**
   * Set by the game layer only while the player works a crew station other than the
   * pilot's. The player's aircraft keeps `controller: 'player'`; the station is here.
   */
  stationInputs?: StationInputs;
}

export type AircraftOutcome =
  | 'shot-down'
  | 'crashed'
  | 'collided'
  | 'landed-friendly'
  | 'landed-enemy'
  | 'ditched'
  | 'pilot-killed'
  | 'disengaged';

export interface BalloonEntity {
  id: number;
  kind: 'balloon';
  side: Side;
  position: Vector3; // envelope centre
  anchor: Vector3; // winch on the ground
  health: number; // 0..1; hydrogen burns when <= 0
  burning: boolean;
  destroyed: boolean;
  observerBailed: boolean;
}

export type GroundTargetType =
  | 'aa-gun'
  | 'truck'
  | 'artillery'
  | 'hangar'
  | 'tent-hangar'
  | 'supply-dump'
  | 'trench-mg'
  | 'train';

export interface GroundTargetEntity {
  id: number;
  kind: 'ground';
  type: GroundTargetType;
  side: Side;
  position: Vector3;
  heading: number;
  health: number; // 0..1
  destroyed: boolean;
}

export type Entity = AircraftEntity | BalloonEntity | GroundTargetEntity;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface Weather {
  /** 0 = clear, 1 = overcast. */
  cloudCover: number;
  cloudBaseM: number;
  cloudTopM: number;
  /** Wind vector in world frame at 1000 m, m/s. */
  wind: [number, number, number];
  /** Metres of visibility (haze). */
  visibilityM: number;
  turbulence: number; // 0..1
}

export type TimeOfDay = 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk';

/** Environment passed to the flight model each step. */
export interface FlightEnvironment {
  groundHeightAt(x: number, z: number): number;
  /** Air density kg/m^3 at altitude m (ISA). */
  airDensityAt(altitudeM: number): number;
  windAt(position: Vector3, out: Vector3): Vector3;
  turbulence: number;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export type MissionType =
  | 'patrol' // offensive/defensive patrol over the lines
  | 'escort' // protect friendly two-seaters/bombers
  | 'intercept' // stop enemy two-seaters/bombers
  | 'balloon-attack'
  | 'balloon-defense'
  | 'ground-attack' // strafe trenches/transport
  | 'airfield-attack'
  | 'free-hunt' // Jagd: look for trouble
  | 'dogfight' // quick-combat / instant action
  | 'bombing'; // fly a bomber to a target and bomb it

export type WaypointAction =
  | 'fly'
  | 'patrol' // orbit here for `duration` s engaging enemies
  | 'attack-ground'
  | 'attack-balloon'
  /** Bomb run: fly straight and level over `targetIds` and release. */
  | 'bomb'
  | 'rendezvous'
  | 'land';

export interface Waypoint {
  x: number;
  z: number;
  altitude: number; // m ASL
  action: WaypointAction;
  /** Seconds to hold for patrol actions. */
  duration?: number;
  /** Target entity refs (by MissionGroundTarget/MissionBalloon id) for attack actions. */
  targetIds?: string[];
  label?: string;
}

export type FlightRole = 'player-flight' | 'friendly' | 'enemy';

export interface MissionFlightMember {
  /** Named pilot, e.g. the player or a historical ace; generic if absent. */
  pilotName?: string;
  aceId?: string;
  skill: SkillLevel;
  livery: Livery;
  /** True for exactly one member in the player's flight. */
  isPlayer?: boolean;
  /** The player's crew station at the start (player member only); absent means the pilot's seat. */
  station?: CrewStationId;
}

export interface MissionFlight {
  id: string;
  role: FlightRole;
  side: Side;
  nation: Nation;
  aircraftId: AircraftId;
  squadronId?: string;
  members: MissionFlightMember[];
  /** Start position of the flight leader. */
  start: { x: number; z: number; altitude: number; heading: number; airspeed: number };
  /** True if the flight begins parked on an aerodrome runway. */
  startOnGround?: boolean;
  waypoints: Waypoint[];
  /** Seconds after mission start before this flight spawns. */
  spawnDelay?: number;
  /** Behaviour hint for AI. */
  task: 'fighter-sweep' | 'escort' | 'recon' | 'bomb' | 'ground-attack' | 'balloon-attack' | 'defend';
  /** For escort missions: the flight id to protect. */
  escortFlightId?: string;
}

export interface MissionBalloon {
  id: string;
  side: Side;
  x: number;
  z: number;
  altitude: number; // m above ground
}

export interface MissionGroundTarget {
  id: string;
  type: GroundTargetType;
  side: Side;
  x: number;
  z: number;
  heading: number;
}

export type ObjectiveKind =
  | 'destroy-aircraft' // destroy N aircraft of flight(s)
  | 'protect-flight' // at least N members of flight survive, having been out over the lines
  | 'destroy-balloons'
  | 'protect-balloons'
  | 'destroy-ground'
  | 'reach-waypoint'
  /**
   * Hold a patrol line: targetIds = ["<flightId>:<wpA>", "<flightId>:<wpB>"] (the line's ends,
   * or one waypoint for a patrol point); count = seconds on station within ~3 km. Also
   * satisfied as soon as the player's flight engages enemy aircraft there.
   */
  | 'patrol-area'
  | 'survive';

export interface MissionObjective {
  id: string;
  kind: ObjectiveKind;
  description: string;
  targetIds: string[]; // flight ids, balloon ids or ground target ids
  count: number;
  primary: boolean;
}

export interface MissionDefinition {
  id: string;
  type: MissionType;
  title: string;
  /** Multi-paragraph briefing text in period voice. */
  briefing: string;
  date: string; // ISO
  timeOfDay: TimeOfDay;
  weather: Weather;
  flights: MissionFlight[];
  balloons: MissionBalloon[];
  groundTargets: MissionGroundTarget[];
  objectives: MissionObjective[];
  /** Aerodrome id where the player's squadron is based (land here). */
  homeAerodromeId: string;
  /** Career missions record results; quick missions don't. */
  isCareer: boolean;
}

// ---------------------------------------------------------------------------
// Mission results
// ---------------------------------------------------------------------------

export type PilotFate = 'returned' | 'landed-elsewhere' | 'wounded' | 'captured' | 'killed';

export interface VictoryClaim {
  /** Mission time, s. */
  time: number;
  victimAircraftId: AircraftId | 'balloon' | GroundTargetType;
  victimName: string;
  victimAceId?: string;
  victimSide: Side;
  /** Position where the kill happened (for confirmation: behind friendly lines is easier to confirm). */
  x: number;
  z: number;
  /** Whether a witness (wingman/ground observer) saw it; campaign decides confirmation. */
  witnessed: boolean;
  shared: boolean;
}

export interface MissionResult {
  missionId: string;
  playerFate: PilotFate;
  playerOutcome: AircraftOutcome | 'in-flight';
  /** True if the player ended the mission via "end flight" while safe. */
  endedByPlayer: boolean;
  claims: VictoryClaim[];
  objectives: { id: string; completed: boolean }[];
  missionSuccess: boolean;
  friendlyLosses: { name: string; aceId?: string; fate: PilotFate }[];
  enemyLosses: number;
  flightTimeS: number;
  roundsFired: number;
  hits: number;
  /** Squadron-mates' victories for the squadron record. */
  wingmanClaims: { pilotName: string; count: number }[];
  /** The player abandoned the mission from the pause menu (not a safe "end flight"). Always a failure. */
  aborted?: boolean;
  /** Every historical ace lost in the mission, either side (killed, captured, or wounded and forced down). */
  acesDown?: { aceId: string; side: Side; fate: PilotFate }[];
  /** What the flight recorder saw (src/game/flightRecorder.ts), for the flight report. Additive. */
  telemetry?: FlightTelemetry;
  /** Bombs the player's aircraft released, whoever aimed them. */
  bombsDropped?: number;
  /** Of those, bombs that damaged a ground target. */
  bombHits?: number;
}

/** An enemy aircraft in the flight report, with the geometry of its first firing pass. */
export interface EnemyEntryTelemetry {
  aircraftId: AircraftId;
  flightId: string;
  callsign: string;
  aceId?: string;
  skill: SkillLevel;
  outcome: AircraftOutcome | 'in-flight';
  /** Null when he never fired. */
  firstPass: {
    /** Mission time, s. */
    t: number;
    /** Aimed at the player (not a wingman or another friendly). */
    atPlayer: boolean;
    /** Height above his target when he closed inside 600 m, m. */
    heightAdvM: number;
    /** Began at least 100 m above the target. */
    above: boolean;
    /** Within 15° of the sun as seen from the target. */
    upSun: boolean;
    /** Did the target know about him when the pass began (the HUD's awareness for the player)? */
    seen: boolean | null;
  } | null;
}

/** Flight statistics the MissionResult doesn't carry, recorded for the flight report. */
export interface FlightTelemetry {
  /** Bullets that hit the player's aircraft. */
  hitsTaken: number;
  /** What took the player out (src/game/lossCause.ts), or null. */
  lossCause: string | null;
  /** Mission seconds with the player alive and an enemy aircraft within 1.5 km. */
  combatTimeS: number;
  /** Time compression: real seconds and mission seconds spent above 1x, and the highest factor used. */
  timeCompression: { realS: number; simS: number; maxScale: number };
  /**
   * Frame rate from rendered frame times (null headless): the median, and the rate at the
   * 95th-percentile frame time (the slow end: 95% of frames were at least this fast).
   */
  fps: { p50: number; p95: number; frames: number } | null;
  enemies: EnemyEntryTelemetry[];
}

// ---------------------------------------------------------------------------
// Game events (flight session event bus)
// ---------------------------------------------------------------------------

export type GameEvent =
  /** `mountIndex` (additive) is the index into the shooter's `spec.guns`, e.g. to tell a flexible rear gun from the pilot's. */
  | { type: 'gun-fired'; shooterId: number; gun: GunType; position: Vector3; mountIndex?: number }
  | { type: 'bullet-hit'; targetId: number; shooterId: number; position: Vector3; zone: DamageZone | 'balloon' | 'ground' }
  | { type: 'bullet-impact-ground'; position: Vector3 }
  | { type: 'gun-jammed'; aircraftId: number; mountIndex: number }
  | { type: 'gun-cleared'; aircraftId: number; mountIndex: number }
  | { type: 'drum-change'; aircraftId: number; mountIndex: number }
  | { type: 'out-of-ammo'; aircraftId: number; mountIndex: number }
  | { type: 'engine-damaged'; aircraftId: number }
  | { type: 'engine-dead'; aircraftId: number }
  | { type: 'fire-started'; aircraftId: number }
  | { type: 'pilot-hit'; aircraftId: number; killed: boolean }
  | { type: 'structural-failure'; aircraftId: number; part: 'leftWing' | 'rightWing' | 'tail' }
  | { type: 'aircraft-destroyed'; victimId: number; killerId: number | null; outcome: AircraftOutcome; position: Vector3 }
  | { type: 'aircraft-landed'; aircraftId: number; friendlyTerritory: boolean }
  | { type: 'balloon-destroyed'; balloonId: number; killerId: number | null; position: Vector3 }
  | { type: 'ground-destroyed'; targetId: number; killerId: number | null; position: Vector3 }
  | { type: 'explosion'; position: Vector3; size: number }
  /** `storeIndex` is into the aircraft's `spec.bombs`. */
  | { type: 'bomb-released'; aircraftId: number; storeIndex: number; position: Vector3 }
  /** A bomb burst on the ground; `damagedTargetIds` are the ground targets its blast reached. */
  | { type: 'bomb-exploded'; shooterId: number; position: Vector3; explosiveKg: number; damagedTargetIds: number[] }
  | { type: 'flak-burst'; position: Vector3 }
  | { type: 'collision'; aId: number; bId: number; position: Vector3 }
  | { type: 'objective-complete'; objectiveId: string }
  /** An objective can no longer be achieved (escort charges lost, targets escaped...). */
  | { type: 'objective-failed'; objectiveId: string }
  | { type: 'radio'; from: string; text: string }
  | { type: 'mission-end'; result: MissionResult };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type FlightModelLevel = 'relaxed' | 'standard' | 'authentic';

export interface RealismSettings {
  flightModel: FlightModelLevel;
  /** Rotary torque & gyroscopic precession (Camel/Dr.I). */
  engineTorque: boolean;
  gunJams: boolean;
  limitedAmmo: boolean;
  limitedFuel: boolean;
  midairCollisions: boolean;
  invulnerable: boolean;
  /** Auto-coordinate rudder with ailerons. */
  autoRudder: boolean;
  /** Screen darkens under sustained high g. */
  gEffects: boolean;
  /** Enemy labels / target boxes in the HUD. */
  targetLabels: boolean;
  /** Relative enemy skill: -1 easier .. +1 harder. */
  enemySkillBias: number;
}

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface ControlSettings {
  /** Mouse-aim instructor style vs direct stick. */
  mouseMode: 'off' | 'direct-stick' | 'mouse-aim';
  invertPitch: boolean;
  mouseSensitivity: number; // 0.1..3
  gamepadEnabled: boolean;
  gamepadDeadzone: number;
  /** Action -> KeyboardEvent.code bindings. */
  keyBindings: Record<string, string[]>;
}

export interface GameSettings {
  realism: RealismSettings;
  graphics: GraphicsQuality;
  fov: number; // degrees vertical
  masterVolume: number; // 0..1
  musicVolume: number;
  effectsVolume: number;
  controls: ControlSettings;
  /** Imperial (mph/ft) vs metric HUD units; RB2 used period-appropriate per nation. */
  units: 'auto' | 'metric' | 'imperial';
  showTutorialHints: boolean;
}
