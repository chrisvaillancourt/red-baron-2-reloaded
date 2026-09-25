import { describe, expect, it } from 'vitest';
import { pinToEdge } from './hudView';

describe('pinToEdge', () => {
  it('leaves on-screen points alone', () => {
    const p = { x: 0.3, y: 0.6, onScreen: true };
    expect(pinToEdge(p)).toBe(p);
  });

  it('moves an off-screen point to the edge in its direction', () => {
    const up = pinToEdge({ x: 0.5, y: -2, onScreen: false, edgeAngle: 0 });
    expect(up.onScreen).toBe(true);
    expect(up.x).toBeCloseTo(0.5);
    expect(up.y).toBeCloseTo(0.1); // clear of the heading tape
    const right = pinToEdge({ x: 3, y: 0.5, onScreen: false, edgeAngle: Math.PI / 2 });
    expect(right.x).toBeCloseTo(0.96);
    expect(right.y).toBeCloseTo(0.5);
  });
});
