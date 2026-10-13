import { describe, expect, it } from 'vitest';
import { getCell, parseGroundTruth } from './grid';
import { createInitialState } from './initial-state';
import { TEST_SCENARIO } from './scenario';
import { cloneSnapshot, hashSnapshot, serializeSnapshot } from './snapshot';
import { stepSimulation } from './step';
import type { CellState, Scenario, ScoutIntents } from './types';

const stay: ScoutIntents = {
  'scout-a': { kind: 'stay' }, 'scout-b': { kind: 'stay' }, 'scout-c': { kind: 'stay' },
};

const openScenario: Scenario = {
  id: 'open-test-grid', version: 1,
  communicationRange: 1,
  groundTruth: parseGroundTruth([
    '.........', '.........', '.........', '.........', '.........',
    '.........', '.........', '.........', '.........',
  ]),
  scouts: [
    { id: 'scout-a', position: { x: 4, y: 4 }, heading: 'east' },
    { id: 'scout-b', position: { x: 1, y: 1 }, heading: 'north' },
    { id: 'scout-c', position: { x: 7, y: 7 }, heading: 'west' },
  ],
  relaySites: [
    { id: 'site-a', position: { x: 0, y: 0 } },
    { id: 'site-b', position: { x: 8, y: 0 } },
    { id: 'site-c', position: { x: 0, y: 8 } },
  ],
};

function freezeDeep(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeDeep(child);
  Object.freeze(value);
}

function objectsIn(value: unknown): object[] {
  if (value === null || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(objectsIn)];
}

describe('completed simulation ticks', () => {
  it('shares retained discoveries on the tick after moving into range and keeps relay knowledge after departure', () => {
    const scenario: Scenario = {
      id: 'reconnect-test-grid', version: 1, communicationRange: 1,
      groundTruth: parseGroundTruth(['.............']),
      scouts: [
        { id: 'scout-a', position: { x: 2, y: 0 }, heading: 'east' },
        { id: 'scout-b', position: { x: 9, y: 0 }, heading: 'east' },
        { id: 'scout-c', position: { x: 12, y: 0 }, heading: 'east' },
      ],
      relaySites: [
        { id: 'site-a', position: { x: 0, y: 0 } },
        { id: 'site-b', position: { x: 6, y: 0 } },
        { id: 'site-c', position: { x: 8, y: 0 } },
      ],
    };
    const approach: ScoutIntents = { ...stay, 'scout-a': { kind: 'move', direction: 'west' } };
    const depart: ScoutIntents = { ...stay, 'scout-a': { kind: 'move', direction: 'east' } };
    const first = stepSimulation(scenario, createInitialState(scenario, 'site-a'), approach);
    expect(first.scouts[0].position).toEqual({ x: 1, y: 0 });
    expect(first.relay.connectedScoutIds).toEqual([]);
    expect(first.relay.discoveries).toEqual([]);
    expect(first.relay.sharedMap.cells.every(cell => cell === 'unknown')).toBe(true);
    const oldDiscovery = {
      sourceId: 'scout-a', position: { x: 6, y: 0 }, cell: 'clear',
      discoveredAtTick: 1, receivedAtTick: 1,
    };
    expect(first.scouts[0].discoveries).toContainEqual(oldDiscovery);

    // Authored order cannot change the complete transition or its fingerprint.
    const reordered: Scenario = {
      ...scenario, scouts: [scenario.scouts[2], scenario.scouts[0], scenario.scouts[1]],
    };
    const reorderedFirst = stepSimulation(reordered, createInitialState(reordered, 'site-a'), approach);
    expect(reorderedFirst).toEqual(first);
    expect(hashSnapshot(reorderedFirst)).toBe(hashSnapshot(first));

    const before = serializeSnapshot(first);
    freezeDeep(first);
    const second = stepSimulation(scenario, first, depart);
    expect(second.scouts[0].position).toEqual({ x: 2, y: 0 });
    expect(second.relay.connectedScoutIds).toEqual(['scout-a']);
    // The current west-facing scan cannot see x=6; it arrives from retained knowledge.
    expect(second.scouts[0].sensorTelemetry!.observations.some(item => item.position.x === 6)).toBe(false);
    expect(second.relay.discoveries).toContainEqual({ ...oldDiscovery, receivedAtTick: 2 });
    expect(second.scouts[0].discoveries).toContainEqual(oldDiscovery);
    expect(getCell(second.relay.sharedMap, { x: 6, y: 0 })).toBe('clear');
    expect(serializeSnapshot(first)).toBe(before);

    const third = stepSimulation(scenario, second, depart);
    const fourth = stepSimulation(scenario, third, stay);
    expect(third.relay.connectedScoutIds).toEqual([]);
    expect(fourth.scouts[0].discoveries).toContainEqual({
      sourceId: 'scout-a', position: { x: 7, y: 0 }, cell: 'clear',
      discoveredAtTick: 4, receivedAtTick: 4,
    });
    expect(fourth.relay.discoveries).toEqual(second.relay.discoveries);
    expect(fourth.relay.sharedMap).toEqual(second.relay.sharedMap);
    expect(getCell(fourth.relay.sharedMap, { x: 7, y: 0 })).toBe('unknown');
  });

  it('exchanges only within the pre-movement connected components, including multi-hop relay reachability', () => {
    const scenario: Scenario = {
      id: 'component-test-grid', version: 1, communicationRange: 1,
      groundTruth: parseGroundTruth(['.........']),
      scouts: [
        { id: 'scout-a', position: { x: 1, y: 0 }, heading: 'east' },
        { id: 'scout-b', position: { x: 2, y: 0 }, heading: 'east' },
        { id: 'scout-c', position: { x: 7, y: 0 }, heading: 'west' },
      ],
      relaySites: [
        { id: 'site-a', position: { x: 0, y: 0 } },
        { id: 'site-b', position: { x: 4, y: 0 } },
        { id: 'site-c', position: { x: 8, y: 0 } },
      ],
    };
    const next = stepSimulation(scenario, createInitialState(scenario, 'site-a'), stay);
    const scoutCommunications = next.scouts.map(scout => {
      if (scout.communication.status !== 'evaluated') throw new Error('Missing communication result.');
      return scout.communication;
    });
    if (next.relay.communication.status !== 'evaluated') throw new Error('Missing relay communication result.');
    expect(scoutCommunications.map(communication => communication.componentId)).toEqual([
      'relay', 'relay', 'scout-c',
    ]);
    expect(scoutCommunications.map(communication => communication.relayReachable)).toEqual([true, true, false]);
    expect(next.relay.connectedScoutIds).toEqual(['scout-a', 'scout-b']);
    expect(next.relay.communication.peerIds).toEqual(['scout-a']);
    expect(next.scouts[0]!.discoveries.map(discovery => discovery.sourceId)).toContain('scout-b');
    expect(next.scouts[1]!.discoveries.map(discovery => discovery.sourceId)).toContain('scout-a');
    expect([...new Set(next.relay.discoveries.map(discovery => discovery.sourceId))]).toEqual(['scout-a', 'scout-b']);
    expect(next.scouts[2]!.discoveries.every(discovery => discovery.sourceId === 'scout-c')).toBe(true);
    expect(next.relay.discoveries.every(discovery => discovery.receivedAtTick === 1)).toBe(true);
    expect(next.scouts[2]!.discoveries.every(discovery => discovery.receivedAtTick === 1)).toBe(true);
  });

  it('keeps tick zero unscanned and labels the first scan and movement tick 1', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const next = stepSimulation(TEST_SCENARIO, initial, stay);
    expect(initial.tick).toBe(0);
    expect(initial.scouts.every(scout => scout.sensorTelemetry === null && scout.lastMovement === null)).toBe(true);
    expect(next.tick).toBe(1);
    for (const scout of next.scouts) {
      expect(scout.sensorTelemetry?.tick).toBe(1);
      expect(scout.sensorTelemetry?.scoutId).toBe(scout.id);
      expect(scout.lastMovement?.tick).toBe(1);
      expect(scout.lastMovement?.outcome).toBe('stayed');
      expect(scout.discoveries.every(discovery => discovery.discoveredAtTick === 1)).toBe(true);
    }
    expect(next.relay.communication).toEqual({
      status: 'evaluated', tick: 1, peerIds: ['scout-a'],
      componentId: 'relay', relayReachable: true,
    });
    expect(next.relay.connectivityEvaluatedAtTick).toBe(1);
    expect(next.relay.connectedScoutIds).toEqual(['scout-a']);
    expect(next.scouts.map(scout => scout.communication)).toEqual([
      { status: 'evaluated', tick: 1, peerIds: ['relay'], componentId: 'relay', relayReachable: true },
      { status: 'evaluated', tick: 1, peerIds: [], componentId: 'scout-b', relayReachable: false },
      { status: 'evaluated', tick: 1, peerIds: [], componentId: 'scout-c', relayReachable: false },
    ]);
    expect(next.scouts.every(scout => scout.target === null && scout.claims.knownClaims.length === 0)).toBe(true);
  });

  it('scans the old origin and heading before moving and turning', () => {
    const initial = createInitialState(openScenario, 'site-a');
    const next = stepSimulation(openScenario, initial, {
      ...stay, 'scout-a': { kind: 'move', direction: 'west' },
    });
    const scout = next.scouts[0];
    expect(scout.position).toEqual({ x: 3, y: 4 });
    expect(scout.heading).toBe('west');
    expect(scout.sensorTelemetry?.origin).toEqual({ x: 4, y: 4 });
    expect(scout.sensorTelemetry?.heading).toBe('east');
    // Collision checks don't reveal the destination to the scout's map.
    expect(getCell(scout.localMap, { x: 3, y: 4 })).toBe('unknown');
    const again = stepSimulation(openScenario, next, stay);
    expect(again.scouts[0].sensorTelemetry?.origin).toEqual({ x: 3, y: 4 });
    expect(again.scouts[0].sensorTelemetry?.heading).toBe('west');
    expect(getCell(again.scouts[0].localMap, { x: 3, y: 4 })).toBe('clear');
  });

  it('updates each local map exactly from that scout’s deduplicated ray observations', () => {
    const initial = createInitialState(openScenario, 'site-a');
    const next = stepSimulation(openScenario, initial, stay);
    for (const scout of next.scouts) {
      const scan = scout.sensorTelemetry!;
      const expected: CellState[] = Array<CellState>(81).fill('unknown');
      const observed = new Set<string>();
      for (const ray of scan.rays) {
        for (const { position, cell } of ray.cells) {
          expected[position.y * 9 + position.x] = cell;
          observed.add(`${position.x},${position.y}`);
        }
      }
      expect(scout.localMap.cells).toEqual(expected);
      expect(scan.observations).toHaveLength(observed.size);
      expect(scan.observedCellCount).toBe(observed.size);
      expect(scan.newCellCount).toBe(observed.size);
      expect(scan.newlyDiscoveredPositions).toEqual(scan.observations.map(observation => observation.position));
      expect(scan.blockedHitCount).toBe(scan.rays.filter(ray => ray.termination === 'obstacle').length);
      expect(scout.discoveries).toHaveLength(scan.observations.length);
      expect(scout.discoveries).toEqual(expect.arrayContaining(scan.observations.map(observation => ({
        sourceId: observation.scoutId, position: observation.position, cell: observation.cell,
        discoveredAtTick: observation.tick, receivedAtTick: observation.tick,
      }))));
      expect(scout.discoveries.every(discovery => discovery.sourceId === scout.id)).toBe(true);
    }
    expect(getCell(next.scouts[0].localMap, { x: 8, y: 4 })).toBe('clear');
    expect(getCell(next.scouts[1].localMap, { x: 8, y: 4 })).toBe('unknown');
    expect(next.relay.sharedMap.cells.every(cell => cell === 'unknown')).toBe(true);
    expect(next.relay.discoveries).toEqual([]);
  });

  it('leaves unseen cells beyond a wall unknown and ignores changes there', () => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      groundTruth: parseGroundTruth([
        '#########', '#..#....#', '#..#....#', '#..#....#',
        '#..#....#', '#..#....#', '#########',
      ]),
    };
    const alternate: Scenario = {
      ...scenario,
      groundTruth: parseGroundTruth([
        '#########', '#..######', '#..#....#', '#..#....#',
        '#..#....#', '#..#....#', '#########',
      ]),
    };
    const next = stepSimulation(scenario, createInitialState(scenario, 'site-a'), stay);
    const other = stepSimulation(alternate, createInitialState(alternate, 'site-a'), stay);
    for (const scout of next.scouts) {
      expect(getCell(scout.localMap, { x: 4, y: 1 })).toBe('unknown');
      expect(scout.sensorTelemetry?.observations.every(observation => observation.position.x <= 3)).toBe(true);
    }
    expect(serializeSnapshot(other)).toBe(serializeSnapshot(next));
  });

  it('reports no new discoveries on an unchanged repeated scan', () => {
    const first = stepSimulation(TEST_SCENARIO, createInitialState(TEST_SCENARIO, 'site-a'), stay);
    const second = stepSimulation(TEST_SCENARIO, first, stay);
    for (const [index, scout] of second.scouts.entries()) {
      expect(scout.sensorTelemetry?.newCellCount).toBe(0);
      expect(scout.sensorTelemetry?.newlyDiscoveredPositions).toEqual([]);
      expect(scout.localMap).toEqual(first.scouts[index]?.localMap);
      expect(scout.sensorTelemetry?.observedCellCount).toBe(first.scouts[index]?.sensorTelemetry?.observedCellCount);
    }
  });

  it('records a blocked move after scanning without revealing anything behind the wall', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const next = stepSimulation(TEST_SCENARIO, initial, {
      ...stay, 'scout-a': { kind: 'move', direction: 'north' },
    });
    expect(next.scouts[0].position).toEqual(initial.scouts[0].position);
    expect(next.scouts[0].heading).toBe('north');
    expect(next.scouts[0].lastMovement?.outcome).toBe('blocked');
    expect(next.scouts[0].sensorTelemetry?.heading).toBe('east');
  });

  it('allows later scout overlap and movement onto the nonblocking relay', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const relayStep = stepSimulation(TEST_SCENARIO, initial, {
      ...stay, 'scout-a': { kind: 'move', direction: 'east' },
    });
    expect(relayStep.scouts[0].position).toEqual(relayStep.relay.position);
    expect(relayStep.scouts[0].lastMovement?.outcome).toBe('moved');
    const overlap = stepSimulation(TEST_SCENARIO, initial, {
      ...stay,
      'scout-a': { kind: 'move', direction: 'south' },
      'scout-b': { kind: 'move', direction: 'north' },
    });
    expect(overlap.scouts[0].position).toEqual({ x: 1, y: 2 });
    expect(overlap.scouts[1].position).toEqual({ x: 1, y: 2 });
    expect(overlap.scouts[0].lastMovement?.outcome).toBe('moved');
    expect(overlap.scouts[1].lastMovement?.outcome).toBe('moved');
    expect(() => stepSimulation(TEST_SCENARIO, overlap, stay)).not.toThrow();
  });
});

describe('snapshot transitions and deterministic runs', () => {
  it('preserves frozen earlier snapshots, including nested maps, telemetry, and history', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const first = stepSimulation(TEST_SCENARIO, initial, stay);
    const before = serializeSnapshot(first);
    freezeDeep(first);
    freezeDeep(stay);
    const second = stepSimulation(TEST_SCENARIO, first, {
      ...stay, 'scout-a': { kind: 'move', direction: 'east' },
    });
    expect(second).not.toBe(first);
    expect(serializeSnapshot(first)).toBe(before);
    const olderObjects = new Set(objectsIn(first));
    expect(objectsIn(second).some(object => olderObjects.has(object))).toBe(false);
    // Even unauthorized mutations of the result cannot affect older snapshots.
    (second.scouts[0].localMap.cells as CellState[])[0] = 'clear';
    (second.scouts[0].sensorTelemetry!.rays[0].cells[0]!.position as { x: number }).x = 8;
    (second.scouts[0].discoveries[0]!.position as { x: number }).x = 8;
    (second.relay.sharedMap.cells as CellState[])[0] = 'clear';
    expect(serializeSnapshot(first)).toBe(before);
    expect(initial.scouts[0].sensorTelemetry).toBeNull();
  });

  it('produces identical states and hashes at every tick of the same explicit intent sequence', () => {
    let runA = createInitialState(TEST_SCENARIO, 'site-a');
    let runB = cloneSnapshot(runA);
    const sequence: readonly ScoutIntents[] = [
      stay,
      { ...stay, 'scout-a': { kind: 'move', direction: 'east' } },
      { ...stay, 'scout-a': { kind: 'move', direction: 'east' }, 'scout-b': { kind: 'move', direction: 'south' } },
      { ...stay, 'scout-c': { kind: 'move', direction: 'west' } },
      stay,
    ];
    const tickHashes = [hashSnapshot(runA)];
    for (const intents of sequence) {
      runA = stepSimulation(TEST_SCENARIO, runA, intents);
      runB = stepSimulation(TEST_SCENARIO, runB, intents);
      expect(serializeSnapshot(runA)).toBe(serializeSnapshot(runB));
      expect(hashSnapshot(runA)).toBe(hashSnapshot(runB));
      tickHashes.push(hashSnapshot(runA));
    }
    expect(runA.tick).toBe(5);
    expect(new Set(tickHashes).size).toBe(6);
  });

  it('distinguishes different movement outcomes at the same tick', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const stationary = stepSimulation(TEST_SCENARIO, initial, stay);
    const moving = stepSimulation(TEST_SCENARIO, initial, {
      ...stay, 'scout-a': { kind: 'move', direction: 'east' },
    });
    expect(hashSnapshot(stationary)).not.toBe(hashSnapshot(moving));
    expect(stationary.tick).toBe(moving.tick);
  });

  it('does not share any state between two runs with different relay sites', () => {
    const a = stepSimulation(TEST_SCENARIO, createInitialState(TEST_SCENARIO, 'site-a'), stay);
    const b = stepSimulation(TEST_SCENARIO, createInitialState(TEST_SCENARIO, 'site-c'), stay);
    expect(a.scouts.map(scout => scout.localMap)).toEqual(b.scouts.map(scout => scout.localMap));
    expect(a.scouts.map(scout => scout.sensorTelemetry)).toEqual(b.scouts.map(scout => scout.sensorTelemetry));
    expect(a.scouts[0]?.communication).not.toEqual(b.scouts[0]?.communication);
    const aObjects = new Set(objectsIn(a));
    expect(objectsIn(b).some(object => aObjects.has(object))).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid/exhausted tick %s', tick => {
    const state = { ...createInitialState(TEST_SCENARIO, 'site-a'), tick };
    expect(() => stepSimulation(TEST_SCENARIO, state, stay)).toThrow('tick counter');
  });

  it('rejects mismatched scenario identity and missing intents before a transition', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const before = serializeSnapshot(initial);
    expect(() => stepSimulation({ ...TEST_SCENARIO, version: 2 }, initial, stay)).toThrow('configuration');
    expect(() => stepSimulation(TEST_SCENARIO, initial, {} as ScoutIntents)).toThrow('explicit');
    expect(serializeSnapshot(initial)).toBe(before);
  });
});
