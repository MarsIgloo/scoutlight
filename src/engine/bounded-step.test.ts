import { expect, it } from 'vitest';
import { createInitialState } from './initial-state';
import { TEST_SCENARIO } from './scenario';
import { cloneSnapshot } from './snapshot';
import { stepSimulation } from './step';
import type { ScoutIntents } from './types';

const stay: ScoutIntents = {
  'scout-a': { kind: 'stay' }, 'scout-b': { kind: 'stay' }, 'scout-c': { kind: 'stay' },
};

it('bounds persistent storage across 50 repeated scans while retaining complete latest telemetry', () => {
  let state = stepSimulation(TEST_SCENARIO, createInitialState(TEST_SCENARIO, 'site-a'), stay);
  const first = cloneSnapshot(state);
  for (let tick = 2; tick <= 50; tick++) state = stepSimulation(TEST_SCENARIO, state, stay);
  for (const [index, scout] of state.scouts.entries()) {
    expect(scout.discoveries).toEqual(first.scouts[index]!.discoveries);
    expect(scout.discoveries.length).toBeLessThanOrEqual(3 * 9 * 7);
    expect(scout.sensorTelemetry!.tick).toBe(50);
    expect(scout.sensorTelemetry!.observations.length).toBe(first.scouts[index]!.sensorTelemetry!.observations.length);
    expect(scout.sensorTelemetry!.observations.every(observation => observation.tick === 50)).toBe(true);
    expect(scout.sensorTelemetry!.newCellCount).toBe(0);
    expect(first.scouts[index]!.sensorTelemetry!.tick).toBe(1);
  }
  expect(state.relay.discoveries).toEqual(first.relay.discoveries);
  expect(state.relay.discoveries.length).toBeLessThanOrEqual(3 * 9 * 7);
});
