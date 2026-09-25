import { describe, expect, it } from 'vitest';
import { groupWaypoints } from './mapRenderer';

describe('briefing map waypoint grouping', () => {
  it('shares one circle between waypoints on the same spot, keeping route order', () => {
    // Cross the lines, hunting ground, recross at the crossing point, home.
    const pts = [{ x: 400, y: 300 }, { x: 470, y: 280 }, { x: 402, y: 301 }, { x: 100, y: 120 }];
    expect(groupWaypoints(pts, 16)).toEqual([[0, 2], [1], [3]]);
  });

  it('leaves well-separated waypoints alone', () => {
    expect(groupWaypoints([{ x: 0, y: 0 }, { x: 40, y: 0 }], 16)).toEqual([[0], [1]]);
  });
});
