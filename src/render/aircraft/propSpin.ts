/**
 * Which way a propeller spins in the visual (+1: positive rotation about the pivot's local Z),
 * matching the generator's blade handedness (tools/blender/aircraft_gen.py `build_propeller`):
 * a pusher propeller turns the other way from a tractor, and a twin's two propellers are
 * handed (left and right opposite).
 *
 * Whether a propeller pushes comes from where the model puts it, not from
 * `geometry.pusher`: the Gotha's nacelles push although its fuselage is a tractor layout. A
 * pusher's hub is behind the centre of gravity (body z > 0), a tractor's ahead of the wing.
 */
export type PropNode = 'Propeller' | 'Propeller_L' | 'Propeller_R';

export function propSpinSign(node: PropNode, hubBodyZ: number): number {
  const base = hubBodyZ > 0 ? -1 : 1;
  if (node === 'Propeller') return base;
  return node === 'Propeller_L' ? -base : base;
}
