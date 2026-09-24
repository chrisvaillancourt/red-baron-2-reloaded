/** Aircraft picker cards and spec sheets (shared by HQ and Quick Mission). */
import type { AircraftSpec, Livery } from '../core/types';
import { GUNS } from '../data/aircraft';
import { h, svg } from './dom';
import { formatAltitude, formatSpeed, type UnitPrefs } from './format';
import { aircraftProfile } from './insignia';

export function gunSummary(spec: AircraftSpec): string {
  const counts = new Map<string, number>();
  for (const g of spec.guns) {
    const key = `${GUNS[g.type].name.split(' "')[0].replace(/ \.303| MG 14/, '')}${g.mount === 'flexible' ? ' (observer)' : ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? `${n}× ${k}` : k)).join(' + ');
}

export function aircraftCard(spec: AircraftSpec, selected: boolean, onClick: () => void): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: 'choice ac-card', 'aria-pressed': String(selected), onClick },
    svg(aircraftProfile(spec, { width: 120 })),
    h('div', { class: 'ac-name' }, spec.name),
    h('div', { class: 'ac-sub' }, `${spec.performance.enginePowerHp} hp ${spec.performance.engineType} · ${gunSummary(spec)}`),
  );
}

function bar(label: string, frac: number, value: string): HTMLElement[] {
  const f = Math.max(0.04, Math.min(1, frac));
  return [
    h('span', { class: 'lbl' }, label),
    h('div', { class: 'bar' }, h('div', { style: { width: `${(f * 100).toFixed(0)}%` } })),
    h('span', { class: 'val' }, value),
  ];
}

/** Relative manoeuvrability estimate for display: roll/pitch authority and wing loading. */
export function agility(spec: AircraftSpec): number {
  const p = spec.performance;
  const loading = p.massLoaded / p.wingArea; // kg/m^2, ~25..45
  const loadingScore = 1 - (loading - 24) / 26;
  return Math.max(0, Math.min(1, 0.45 * ((p.rollRate + p.pitchRate) / 2) + 0.55 * loadingScore + (spec.geometry.layout === 'triplane' ? 0.1 : 0)));
}

export function specSheet(spec: AircraftSpec, units: UnitPrefs, livery?: Livery): HTMLElement {
  const p = spec.performance;
  const kmh = p.maxSpeedKmh / 3.6;
  return h(
    'div',
    { class: 'spec-sheet' },
    h('div', { class: 'profile-big' }, svg(aircraftProfile(spec, livery ? { livery, width: 400 } : { width: 400 }))),
    h(
      'div',
      { class: 'spec-bars' },
      ...bar('Speed', (p.maxSpeedKmh - 120) / 110, formatSpeed(kmh, units.speed)),
      ...bar('Climb', (32 - p.climbTo3000mMin) / 25, `${p.climbTo3000mMin.toFixed(1)} min to ${formatAltitude(3000, units.system)}`),
      ...bar('Ceiling', (p.ceilingM - 3000) / 4200, formatAltitude(p.ceilingM, units.system)),
      ...bar('Agility', agility(spec), agility(spec) > 0.72 ? 'superb' : agility(spec) > 0.55 ? 'good' : agility(spec) > 0.4 ? 'fair' : 'poor'),
      ...bar('Firepower', spec.guns.filter((g) => g.mount !== 'flexible').length / 2, gunSummary(spec)),
      ...bar('Strength', p.structuralStrength, p.structuralStrength > 0.9 ? 'rugged' : p.structuralStrength > 0.7 ? 'sound' : 'fragile'),
    ),
    h('p', { class: 'spec-desc' }, spec.description),
    h('p', { class: 'typed muted', style: 'font-size:.75em;margin:.4em 0 0' }, `${spec.manufacturer} · ${p.engineName}, ${p.enginePowerHp} hp · span ${spec.geometry.span.toFixed(2)} m · ${p.massLoaded} kg loaded`),
  );
}
