import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine/initial-state';
import { planBaseline } from '../engine/frontier';
import { stepBaselineAutonomous } from '../engine/step';
import { comparePositionRoutes } from './route-diagnostics';
import { runBaseline } from './relay-placement';
import { RELAY_BRIDGE_FIXTURE, WEST_ROOM_BRIDGE_VARIANT } from './route-investigation';

describe('relay placement changes movement through ordinary exchange', () => {
  it('bridges an unseen cell before Scout A plans, then the fixture routes reconverge', () => {
    const scenario = RELAY_BRIDGE_FIXTURE;
    const initialA = createInitialState(scenario, 'site-a');
    const initialB = createInitialState(scenario, 'site-b');
    expect(initialA.scouts[0].localMap.cells.every(cell => cell === 'unknown')).toBe(true);
    expect(initialB.scouts[1].localMap.cells.every(cell => cell === 'unknown')).toBe(true);
    const alone = stepBaselineAutonomous(scenario, initialA);
    const bridged = stepBaselineAutonomous(scenario, initialB);
    const index = 2 * scenario.groundTruth.width + 1;
    expect(alone.scouts[0].localMap.cells[index]).toBe('unknown');
    expect(bridged.scouts[0].sensorTelemetry!.observations.some(o => o.position.x === 1 && o.position.y === 2)).toBe(false);
    expect(bridged.scouts[1].sensorTelemetry!.observations.some(o => o.position.x === 1 && o.position.y === 2 && o.cell === 'clear')).toBe(true);
    expect(bridged.relay.communication).toMatchObject({ status: 'evaluated', peerIds: ['scout-a', 'scout-b'] });
    expect(bridged.scouts[0].communication).toMatchObject({ status: 'evaluated', peerIds: ['relay'] });
    expect(bridged.scouts[0].discoveries.find(d => d.position.x === 1 && d.position.y === 2))
      .toMatchObject({ sourceId: 'scout-b', cell: 'clear', discoveredAtTick: 1, receivedAtTick: 1 });
    expect(alone.scouts[0].lastMovement).toMatchObject({ intent: { kind: 'move', direction: 'west' }, destination: { x: 1, y: 2 } });
    expect(bridged.scouts[0].lastMovement).toMatchObject({ intent: { kind: 'move', direction: 'north' }, destination: { x: 2, y: 1 } });
    expect(comparePositionRoutes(runBaseline(scenario, 'site-a', 4), runBaseline(scenario, 'site-b', 4))[0])
      .toMatchObject({ firstTick: 1, divergentTicks: 3, intervals: [{ startTick: 1, endTick: 3, reconvergedAt: 4 }] });
  });

  it('reproduces the first physical divergence on the authored west-room variant', () => {
    const scenario = WEST_ROOM_BRIDGE_VARIANT;
    const isolated = runBaseline(scenario, 'site-a', 1);
    const bridged = runBaseline(scenario, 'site-b', 1);
    const a = isolated.snapshots[1]!.scouts[0];
    const b = bridged.snapshots[1]!.scouts[0];
    expect(a.sensorTelemetry!.observations).toEqual(b.sensorTelemetry!.observations);
    expect(b.discoveries.find(d => d.position.x === 3 && d.position.y === 2))
      .toMatchObject({ sourceId: 'scout-b', discoveredAtTick: 1, receivedAtTick: 1 });
    expect(a.lastMovement).toMatchObject({ origin: { x: 4, y: 2 }, destination: { x: 3, y: 2 }, headingBefore: 'east' });
    expect(b.lastMovement).toMatchObject({ origin: { x: 4, y: 2 }, destination: { x: 4, y: 1 }, headingBefore: 'east' });
    expect(comparePositionRoutes(isolated, bridged)[0]).toMatchObject({ firstTick: 1, divergentTicks: 1 });

    // Planner-only counterfactual: toggle the actual B-sourced observation,
    // without altering either natural run or providing ground truth to a scout.
    const index = 2 * scenario.groundTruth.width + 3;
    const decisionWith = (scout: typeof a, cell: 'unknown' | 'clear') => {
      const cells = [...scout.localMap.cells];
      cells[index] = cell;
      return planBaseline({ id: scout.id, position: scout.lastMovement!.origin,
        heading: scout.lastMovement!.headingBefore, localMap: { ...scout.localMap, cells },
        target: null, tick: 1, communication: scout.communication }).intent;
    };
    expect(decisionWith(a, 'clear')).toEqual({ kind: 'move', direction: 'north' });
    expect(decisionWith(b, 'unknown')).toEqual({ kind: 'move', direction: 'west' });
  });
});
