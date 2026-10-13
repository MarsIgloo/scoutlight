import { describe, expect, it } from 'vitest';
import { TEST_SCENARIO } from '../engine/scenario';
import { cloneSnapshot } from '../engine/snapshot';
import type { ScoutState, SimulationState } from '../engine/types';
import { comparePositionRoutes } from './route-diagnostics';
import { firstMovementDifference, runBaseline } from './relay-placement';

describe('physical route comparison', () => {
  function changeA(snapshot: SimulationState, changes: Partial<ScoutState>): SimulationState {
    return { ...snapshot, scouts: [{ ...snapshot.scouts[0], ...changes }, snapshot.scouts[1], snapshot.scouts[2]] };
  }

  it('ignores target and heading changes, but reports divergence and reconvergence of positions', () => {
    const original = runBaseline(TEST_SCENARIO, 'site-a', 3);
    const snapshots = original.snapshots.map(cloneSnapshot);
    const originalOutcome = snapshots[1]!.scouts[0].lastMovement!.outcome;
    snapshots[1] = changeA(snapshots[1]!, { target: { x: 0, y: 0 }, heading: 'north',
      lastMovement: { ...snapshots[1]!.scouts[0].lastMovement!, outcome: originalOutcome === 'moved' ? 'blocked' : 'moved' } });
    const changed = { ...original, siteId: 'site-b' as const, snapshots };
    expect(firstMovementDifference(original, changed)).toEqual({ tick: 1, scoutId: 'scout-a' });
    expect(comparePositionRoutes(original, changed).every(result => result.firstTick === null)).toBe(true);
    snapshots[1] = changeA(snapshots[1]!, { position: { ...snapshots[1]!.scouts[0].position,
      x: snapshots[1]!.scouts[0].position.x + 1 } });
    snapshots[2] = changeA(snapshots[2]!, { position: { ...snapshots[2]!.scouts[0].position,
      x: snapshots[2]!.scouts[0].position.x + 1 } });
    expect(comparePositionRoutes(original, changed)[0]).toEqual({
      scoutId: 'scout-a', firstTick: 1, divergentTicks: 2,
      intervals: [{ startTick: 1, endTick: 2, reconvergedAt: 3 }],
    });
  });

  it('rejects mismatched caps, scenarios, and starting positions', () => {
    const original = runBaseline(TEST_SCENARIO, 'site-a', 2);
    const other = runBaseline(TEST_SCENARIO, 'site-b', 1);
    expect(() => comparePositionRoutes(original, other)).toThrow('same scenario and tick cap');
    const snapshots = original.snapshots.map(cloneSnapshot);
    snapshots[0] = changeA(snapshots[0]!, { position: { ...snapshots[0]!.scouts[0].position,
      x: snapshots[0]!.scouts[0].position.x + 1 } });
    expect(() => comparePositionRoutes(original, { ...original, snapshots })).toThrow('starting positions');
  });
});
