/**
 * UI harness (dev/ui.html). Query parameters:
 *   ?screen=title|roster|create-pilot|hq|briefing|debrief|quick|options|controls|credits|aces|hud
 *   &pilot=p-hartmann   (hq/briefing/debrief)
 *   &fate=returned|wounded|killed|captured   (debrief)
 *   &tab=N   (click the Nth folder tab after load)
 */
import { createUi, type ScreenId } from '../index';
import { createMockServices, fakeResult } from './mockServices';
import type { PilotFate } from '../../core/types';

const q = new URLSearchParams(location.search);
const screen = (q.get('screen') ?? 'title') as ScreenId | 'hud';
const services = createMockServices();
const root = document.getElementById('app')!;
const pilotId = q.get('pilot') ?? 'p-hartmann';

if (screen === 'hud') {
  const pilot = services.campaign.loadPilot(pilotId)!;
  const mission = services.campaign.generateMission(pilot);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0';
  document.body.append(host);
  void services.launcher.fly(mission, services.getSettings(), host);
} else {
  const params: Record<string, unknown> = {};
  if (screen === 'hq') params.pilotId = pilotId;
  if (screen === 'briefing' || screen === 'debrief') {
    const pilot = services.campaign.loadPilot(pilotId)!;
    const mission = services.campaign.generateMission(pilot);
    params.mission = mission;
    params.pilotId = pilotId;
    if (screen === 'debrief') {
      const fate = (q.get('fate') ?? 'returned') as PilotFate;
      const result = fakeResult(mission, fate);
      params.result = result;
      params.report = services.campaign.applyMissionResult(pilot, mission, result);
    }
  }
  createUi(root, services, { initialScreen: screen, initialParams: params });
  const tab = q.get('tab');
  if (tab) setTimeout(() => document.querySelectorAll<HTMLElement>('.tab')[Number(tab)]?.click(), 300);
}
