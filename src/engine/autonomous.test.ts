import { describe, expect, it } from 'vitest';
import { planBaseline } from './frontier';
import { getCell, parseGroundTruth } from './grid';
import { createInitialState } from './initial-state';
import { serializeSnapshot } from './snapshot';
import { stepBaselineAutonomous, stepSimulation } from './step';
import type { Scenario, ScoutState } from './types';

const scenario: Scenario = {
  id: 'autonomy-test', version: 1, communicationRange: 1,
  groundTruth: parseGroundTruth(['.......', '.......', '.......', '.......', '.......']),
  scouts: [
    { id: 'scout-a', position: { x: 2, y: 2 }, heading: 'east' },
    { id: 'scout-b', position: { x: 0, y: 0 }, heading: 'west' },
    { id: 'scout-c', position: { x: 6, y: 4 }, heading: 'east' },
  ],
  relaySites: [
    { id: 'site-a', position: { x: 0, y: 4 } },
    { id: 'site-b', position: { x: 6, y: 0 } },
    { id: 'site-c', position: { x: 3, y: 0 } },
  ],
};

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}

describe('autonomous tick pipeline', () => {
  it('chooses the same unknown attempt for hidden clear and blocked terrain; only a later scan reveals rejection', () => {
    const blocked: Scenario = {
      ...scenario,
      groundTruth: parseGroundTruth(['.......', '.......', '.#.....', '.......', '.......']),
    };
    const openFirst = stepBaselineAutonomous(scenario, createInitialState(scenario, 'site-a'));
    const blockedFirst = stepBaselineAutonomous(blocked, createInitialState(blocked, 'site-a'));
    const a = openFirst.scouts[0];
    const b = blockedFirst.scouts[0];
    expect(a.sensorTelemetry).toEqual(b.sensorTelemetry);
    expect(a.localMap).toEqual(b.localMap);
    expect(a.target).toEqual({ x: 1, y: 2 });
    expect(b.target).toEqual(a.target);
    expect(a.lastMovement!.intent).toEqual({ kind: 'move', direction: 'west' });
    expect(b.lastMovement!.intent).toEqual(a.lastMovement!.intent);
    expect(a.lastMovement!.outcome).toBe('moved');
    expect(b.lastMovement!.outcome).toBe('blocked');
    expect(b.heading).toBe('west');
    expect(getCell(b.localMap, { x: 1, y: 2 })).toBe('unknown');
    const next = stepBaselineAutonomous(blocked, blockedFirst);
    expect(getCell(next.scouts[0].localMap, { x: 1, y: 2 })).toBe('blocked');
    expect(next.scouts[0].target).not.toEqual(b.target);
  });

  it('uses newly exchanged map data for the current decision, without using connection status as a preference', () => {
    const separated: Scenario = {
      ...scenario,
      scouts: [scenario.scouts[0], { ...scenario.scouts[1], position: { x: 0, y: 2 }, heading: 'east' }, scenario.scouts[2]],
    };
    const connected = { ...separated, communicationRange: 2 };
    const isolatedA = stepBaselineAutonomous(separated, createInitialState(separated, 'site-a')).scouts[0];
    const connectedA = stepBaselineAutonomous(connected, createInitialState(connected, 'site-a')).scouts[0];
    expect(isolatedA.sensorTelemetry!.observations).toEqual(connectedA.sensorTelemetry!.observations);
    expect(getCell(isolatedA.localMap, { x: 1, y: 2 })).toBe('unknown');
    expect(getCell(connectedA.localMap, { x: 1, y: 2 })).toBe('clear');
    expect(isolatedA.target).toEqual({ x: 1, y: 2 });
    expect(connectedA.target).not.toEqual(isolatedA.target);
    const view = (scout: ScoutState) => ({
      id: scout.id, position: scout.sensorTelemetry!.origin, heading: scout.sensorTelemetry!.heading,
      localMap: scout.localMap, target: null, tick: 1, communication: scout.communication,
    });
    expect(planBaseline(view(connectedA)).target).toEqual(connectedA.target);
    expect(planBaseline({ ...view(connectedA), communication: isolatedA.communication }))
      .toEqual(planBaseline(view(connectedA)));
  });

  it('preserves frozen snapshots and keeps the explicit-intent API available', () => {
    const initial = createInitialState(scenario, 'site-a');
    const before = serializeSnapshot(initial);
    freezeDeep(initial);
    const autonomous = stepBaselineAutonomous(scenario, initial);
    const explicit = stepSimulation(scenario, initial, {
      'scout-a': { kind: 'stay' }, 'scout-b': { kind: 'stay' }, 'scout-c': { kind: 'stay' },
    });
    expect(serializeSnapshot(initial)).toBe(before);
    expect(explicit.scouts[0].position).toEqual(initial.scouts[0].position);
    expect(explicit.scouts[0].target).toBeNull();
    expect(autonomous.scouts[0].position).not.toEqual(initial.scouts[0].position);
    const retained = serializeSnapshot(autonomous);
    freezeDeep(autonomous);
    const later = stepBaselineAutonomous(scenario, autonomous);
    expect(serializeSnapshot(autonomous)).toBe(retained);
    expect(later.scouts.every(scout => scout.claims.lastIssuedRevision === 0 && scout.claims.knownClaims.length === 0)).toBe(true);
    expect(later.relay.knownClaims).toEqual([]);
  });
});
