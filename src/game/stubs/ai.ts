/**
 * STUB AI: pursue the nearest enemy with lead, fire when lined up, hold
 * formation on the leader otherwise, fly waypoints as leader. Replaced by
 * src/ai via src/game/modules.ts.
 */
import { Vector3 } from 'three';
import type { AIController, WingmanCommand, WorldQuery } from '../../core/interfaces';
import type { AircraftEntity } from '../../core/types';
import { createMouseAimState, mouseAimControls } from '../input';
import type { AIControllerOptions } from '../moduleTypes';
import { formationOffset } from '../world';
import { stubSetGunnerTarget } from './combat';

const ENGAGE_RANGE = 3500;

export function stubCreateAIController(self: AircraftEntity, opts: AIControllerOptions): AIController {
  const aimState = createMouseAimState();
  let order: WingmanCommand = 'engage-at-will';
  let orderTarget: number | undefined;
  let wpIndex = 0;
  let debug = 'idle';
  const out = { pitch: 0, roll: 0, yaw: 0 };
  const aim = new Vector3();

  function nearestEnemy(world: WorldQuery): AircraftEntity | null {
    let best: AircraftEntity | null = null;
    let bd = ENGAGE_RANGE;
    for (const a of world.aircraft) {
      if (a.side === self.side || a.outcome !== null) continue;
      const d = a.state.position.distanceTo(self.state.position);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  return {
    entityId: self.id,
    get debugState() {
      return debug;
    },
    command(cmd, targetId) {
      order = cmd;
      orderTarget = targetId;
    },
    update(ac, world, dt) {
      const s = ac.state;
      ac.controls.fireGuns = false;
      ac.controls.throttle = 0.9;
      if (ac.outcome !== null || ac.damage.pilotKilled) return;
      let target: AircraftEntity | null = null;
      if (order === 'attack-my-target' && orderTarget !== undefined) {
        const t = world.getEntity(orderTarget);
        if (t?.kind === 'aircraft' && t.outcome === null) target = t;
      }
      if (!target && order !== 'form-up' && order !== 'return-home') target = nearestEnemy(world);
      stubSetGunnerTarget(ac, target?.id ?? null);

      const leader = world.getEntity(opts.leaderId);
      if (target && ac.spec.role === 'fighter') {
        debug = `pursue #${target.id}`;
        const rel = target.state.position.clone().sub(s.position);
        const dist = rel.length();
        const tof = dist / 800;
        aim.copy(target.state.position).addScaledVector(target.state.velocity, tof).sub(s.position).normalize();
        const skillErr = { novice: 0.06, regular: 0.035, veteran: 0.02, ace: 0.01 }[ac.skill];
        const fwd = new Vector3(0, 0, -1).applyQuaternion(s.orientation);
        if (dist < 350 && fwd.angleTo(aim) < 0.05 + skillErr) ac.controls.fireGuns = true;
        ac.controls.throttle = 1;
      } else if (leader && leader.kind === 'aircraft' && leader.id !== ac.id && leader.outcome === null && order !== 'return-home') {
        debug = 'formation';
        const o = formationOffset(opts.slot);
        const lq = leader.state.orientation;
        const slotPos = new Vector3(o.right, o.up, o.back).applyQuaternion(lq).add(leader.state.position);
        const lfwd = new Vector3(0, 0, -1).applyQuaternion(lq);
        slotPos.addScaledVector(lfwd, 120);
        aim.copy(slotPos).sub(s.position).normalize();
        const behind = slotPos.clone().addScaledVector(lfwd, -120).sub(s.position).dot(lfwd);
        ac.controls.throttle = Math.max(0.4, Math.min(1, 0.75 + behind * 0.01));
      } else {
        const wps = opts.flight.waypoints;
        if (wps.length > 0) {
          const wp = wps[Math.min(wpIndex, wps.length - 1)];
          const d = Math.hypot(wp.x - s.position.x, wp.z - s.position.z);
          if (d < 800 && wpIndex < wps.length - 1) wpIndex++;
          debug = `waypoint ${wpIndex}`;
          aim.set(wp.x - s.position.x, (wp.altitude - s.position.y) * 0.5, wp.z - s.position.z).normalize();
        } else {
          debug = 'cruise';
          aim.set(0, 0, -1).applyQuaternion(s.orientation).setY(0).normalize();
        }
      }
      if (s.heightAboveGround < 300) aim.y = Math.max(aim.y, 0.25);
      mouseAimControls(ac, aim.normalize(), aimState, dt, out);
      ac.controls.pitch = out.pitch;
      ac.controls.roll = out.roll;
      ac.controls.yaw = out.yaw * 0.5;
    },
  };
}
