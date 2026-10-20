import { describe, expect, it } from 'vitest';
import { createUnknownMap, fromIndex, parseGroundTruth } from '../engine/grid';
import { createInitialState } from '../engine/initial-state';
import { TEST_SCENARIO } from '../engine/scenario';
import { stepSimulation } from '../engine/step';
import type {
  CellState, CommunicationState, DiscoveryRecord, KnowledgeMap, NodeId, Scenario,
  ScoutId, ScoutState, SimulationState,
} from '../engine/types';
import { evaluateRun, reachableSurveyIndices } from './metrics';
import { RunMetricsAccumulator } from './metrics-accumulator';

const IDS = ['scout-a', 'scout-b', 'scout-c'] as const;
const LINE: Scenario = {
  id: 'metric-line', version: 1, groundTruth: parseGroundTruth(['..........']), communicationRange: 2,
  scouts: [
    { id: 'scout-a', position: { x: 0, y: 0 }, heading: 'east' },
    { id: 'scout-b', position: { x: 1, y: 0 }, heading: 'east' },
    { id: 'scout-c', position: { x: 2, y: 0 }, heading: 'east' },
  ],
  relaySites: [
    { id: 'site-a', position: { x: 3, y: 0 } },
    { id: 'site-b', position: { x: 4, y: 0 } },
    { id: 'site-c', position: { x: 5, y: 0 } },
  ],
};
const ISLANDS: Scenario = {
  ...LINE, id: 'metric-islands', groundTruth: parseGroundTruth(['..#..#..']),
  scouts: [LINE.scouts[0], LINE.scouts[1], { ...LINE.scouts[2], position: { x: 3, y: 0 } }],
  relaySites: [
    { id: 'site-a', position: { x: 4, y: 0 } },
    { id: 'site-b', position: { x: 6, y: 0 } },
    { id: 'site-c', position: { x: 7, y: 0 } },
  ],
};

function knownMap(scenario: Scenario, known: readonly number[]): KnowledgeMap {
  const map = createUnknownMap(scenario.groundTruth);
  const cells: CellState[] = [...map.cells];
  for (const index of known) cells[index] = scenario.groundTruth.cells[index]!;
  return { ...map, cells };
}

interface SnapshotOptions {
  readonly local?: Partial<Readonly<Record<ScoutId, readonly number[]>>>;
  readonly relay?: readonly number[];
  readonly connected?: readonly ScoutId[];
  readonly records?: Partial<Readonly<Record<NodeId, readonly DiscoveryRecord[]>>>;
}

/** Hand-authored evaluator inputs; no sensing algorithm determines expectations. */
function snapshot(scenario: Scenario, tick: number, options: SnapshotOptions = {}): SimulationState {
  const initial = createInitialState(scenario, 'site-a');
  const connected = IDS.filter(id => options.connected?.includes(id));
  const communication = (id: NodeId): CommunicationState => tick === 0
    ? { status: 'not-evaluated' }
    : {
      status: 'evaluated', tick, peerIds: [],
      componentId: id === 'relay' || connected.includes(id) ? 'relay' : id,
      relayReachable: id === 'relay' || connected.includes(id),
    };
  const scout = (index: number): ScoutState => {
    const original = initial.scouts[index]!;
    return {
      ...original, localMap: knownMap(scenario, options.local?.[original.id] ?? []),
      communication: communication(original.id), discoveries: options.records?.[original.id] ?? [],
    };
  };
  return {
    ...initial, tick, scouts: [scout(0), scout(1), scout(2)],
    relay: {
      ...initial.relay, sharedMap: knownMap(scenario, options.relay ?? []),
      communication: communication('relay'), connectivityEvaluatedAtTick: tick === 0 ? null : tick,
      connectedScoutIds: connected, discoveries: options.records?.relay ?? [],
    },
  };
}

function record(
  scenario: Scenario, index: number, sourceId: ScoutId, discoveredAtTick = 1, receivedAtTick = discoveredAtTick,
): DiscoveryRecord {
  return {
    sourceId, position: fromIndex(scenario.groundTruth, index), cell: scenario.groundTruth.cells[index]!,
    discoveredAtTick, receivedAtTick,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('reachable survey denominator', () => {
  it('unions multiple spawn components once and excludes unseeded clear islands and walls', () => {
    expect(reachableSurveyIndices(ISLANDS)).toEqual([0, 1, 3, 4]);
  });

  it('does not connect clear regions diagonally', () => {
    const scenario: Scenario = {
      ...LINE, groundTruth: parseGroundTruth(['..#', '.#.', '#..']),
      scouts: [LINE.scouts[0], LINE.scouts[1], { ...LINE.scouts[2], position: { x: 0, y: 1 } }],
    };
    expect(reachableSurveyIndices(scenario)).toEqual([0, 1, 3]);
  });

  it('rejects invalid terrain or a blocked spawn instead of producing a misleading denominator', () => {
    expect(() => reachableSurveyIndices({ ...LINE, groundTruth: { ...LINE.groundTruth, cells: [] } })).toThrow();
    expect(() => reachableSurveyIndices({ ...LINE, groundTruth: parseGroundTruth(['#.........']) })).toThrow('spawns must be clear');
  });
});

describe('coverage and time to relay target', () => {
  it('uses the union of scout knowledge, excluding unreachable clear cells and known walls', () => {
    const run = [snapshot(ISLANDS, 0), snapshot(ISLANDS, 1, {
      local: { 'scout-a': [0, 1, 2, 6], 'scout-b': [1, 3], 'scout-c': [7] }, relay: [0, 2, 6, 7],
    })];
    const metrics = evaluateRun(ISLANDS, run);
    expect(metrics.reachableCellCount).toBe(4);
    expect(metrics.coverage).toEqual([
      { tick: 0, fleetKnownCount: 0, relayKnownCount: 0, fleetCoverage: 0, relayCoverage: 0, communicationGap: 0 },
      { tick: 1, fleetKnownCount: 3, relayKnownCount: 1, fleetCoverage: 75, relayCoverage: 25, communicationGap: 50 },
    ]);
  });

  it('records the first exact 90% relay tick, regardless of earlier fleet coverage', () => {
    const all = Array.from({ length: 10 }, (_, index) => index);
    const run = [snapshot(LINE, 0), ...[8, 9, 10].map((knownCount, index) => snapshot(LINE, index + 1, {
      local: { 'scout-a': all }, relay: all.slice(0, knownCount),
    }))];
    const metrics = evaluateRun(LINE, run);
    expect(metrics.timeTo90).toBe(2);
    expect(metrics.coverage.map(row => row.relayCoverage)).toEqual([0, 80, 90, 100]);
    expect(evaluateRun(LINE, run.slice(0, 2)).timeTo90).toBeNull();
  });

  it('returns unrounded percentages and requires the next whole cell for a noninteger threshold', () => {
    const clear = reachableSurveyIndices(TEST_SCENARIO);
    const below = Math.ceil(clear.length * 0.9) - 1;
    const run = [snapshot(TEST_SCENARIO, 0), snapshot(TEST_SCENARIO, 1, {
      local: { 'scout-a': clear }, relay: clear.slice(0, below),
    }), snapshot(TEST_SCENARIO, 2, { local: { 'scout-a': clear }, relay: clear.slice(0, below + 1) })];
    expect(evaluateRun(TEST_SCENARIO, run.slice(0, 2)).timeTo90).toBeNull();
    const metrics = evaluateRun(TEST_SCENARIO, run);
    expect(metrics.timeTo90).toBe(2);
    expect(metrics.coverage[1]!.relayCoverage).toBe(100 * below / clear.length);
  });
});

describe('duplicate discoveries', () => {
  it('counts two sources once and three sources twice, regardless of copied receipts', () => {
    const a = record(ISLANDS, 0, 'scout-a');
    const b = record(ISLANDS, 0, 'scout-b');
    const wall = IDS.map(id => record(ISLANDS, 2, id));
    const island = [record(ISLANDS, 6, 'scout-a'), record(ISLANDS, 6, 'scout-c')];
    const initial = snapshot(ISLANDS, 0);
    const first = snapshot(ISLANDS, 1, { records: { 'scout-a': [a], 'scout-b': [b] } });
    expect(evaluateRun(ISLANDS, [initial, first]).duplicateDiscoveries).toBe(1);
    const second = snapshot(ISLANDS, 2, { records: {
      'scout-a': [a, ...wall, ...island], 'scout-b': [b, ...wall, ...island],
      relay: [a, b, ...wall, ...island].map(item => ({ ...item, receivedAtTick: 2 })),
    } });
    // Clear cell 0: 1; blocked cell 2: 2; unseeded clear island cell 6: 1.
    expect(evaluateRun(ISLANDS, [initial, first, second]).duplicateDiscoveries).toBe(4);
  });

  it('counts only discoveries, not repeated knowledge or sensor receipts', () => {
    const a = record(LINE, 0, 'scout-a');
    const run = [snapshot(LINE, 0), snapshot(LINE, 1, { records: { 'scout-a': [a] } }),
      snapshot(LINE, 2, {
        local: { 'scout-a': [0], 'scout-b': [0], 'scout-c': [0] }, relay: [0],
        records: { 'scout-b': [{ ...a, receivedAtTick: 2 }], relay: [{ ...a, receivedAtTick: 2 }] },
      })];
    expect(evaluateRun(LINE, run).duplicateDiscoveries).toBe(0);
  });
});

describe('connectivity and empty work', () => {
  it('divides saved relay membership by completed ticks, excluding initial state', () => {
    const run = [snapshot(LINE, 0), snapshot(LINE, 1, { connected: ['scout-a', 'scout-b'] }),
      snapshot(LINE, 2, { connected: ['scout-a'] }), snapshot(LINE, 3, { connected: ['scout-c'] })];
    const metrics = evaluateRun(LINE, run);
    expect(metrics.completedTicks).toBe(3);
    expect(metrics.connectedTicks).toEqual({ 'scout-a': 2, 'scout-b': 1, 'scout-c': 1 });
    expect(metrics.connectivityFraction).toEqual({ 'scout-a': 2 / 3, 'scout-b': 1 / 3, 'scout-c': 1 / 3 });
    expect(metrics.meanConnectivityFraction).toBeCloseTo(4 / 9);
  });

  it('defines a zero-tick run without division by zero or a reached target', () => {
    const metrics = evaluateRun(LINE, [snapshot(LINE, 0)]);
    expect(metrics.completedTicks).toBe(0);
    expect(metrics.timeTo90).toBeNull();
    expect(metrics.duplicateDiscoveries).toBe(0);
    expect(metrics.connectedTicks).toEqual({ 'scout-a': 0, 'scout-b': 0, 'scout-c': 0 });
    expect(metrics.connectivityFraction).toEqual(metrics.connectedTicks);
    expect(metrics.meanConnectivityFraction).toBe(0);
  });
});

describe('run validation and purity', () => {
  it('rejects missing, skipped, repeated, and reordered ticks', () => {
    const zero = snapshot(LINE, 0);
    const one = snapshot(LINE, 1);
    const two = snapshot(LINE, 2);
    for (const run of [[], [one], [zero, two], [zero, one, one], [zero, two, one]]) {
      expect(() => evaluateRun(LINE, run)).toThrow();
    }
  });

  it('rejects mixed configurations, relay sites, map dimensions, and scout order', () => {
    const initial = snapshot(LINE, 0);
    const first = snapshot(LINE, 1);
    const invalid: SimulationState[] = [
      { ...first, config: { ...first.config, scenarioVersion: 2 } },
      { ...first, config: { ...first.config, relaySiteId: 'site-b' } },
      { ...first, config: { ...first.config, communicationRange: 4 } },
      { ...first, scouts: [first.scouts[1], first.scouts[0], first.scouts[2]] },
      { ...first, relay: { ...first.relay, position: { x: 4, y: 0 } } },
      { ...first, relay: { ...first.relay, sharedMap: { ...first.relay.sharedMap, width: 9 } } },
    ];
    for (const state of invalid) expect(() => evaluateRun(LINE, [initial, state])).toThrow();
  });

  it('rejects missing, stale, and inconsistent communication evaluations', () => {
    const initial = snapshot(LINE, 0);
    const first = snapshot(LINE, 1, { connected: ['scout-a'] });
    const invalid: SimulationState[] = [
      { ...first, scouts: [{ ...first.scouts[0], communication: { status: 'not-evaluated' } }, first.scouts[1], first.scouts[2]] },
      { ...first, relay: { ...first.relay, connectivityEvaluatedAtTick: 0 } },
      { ...first, relay: { ...first.relay, connectedScoutIds: [] } },
      { ...first, relay: { ...first.relay, communication: {
        status: 'evaluated', tick: 2, peerIds: [], componentId: 'relay', relayReachable: true,
      } } },
    ];
    for (const state of invalid) expect(() => evaluateRun(LINE, [initial, state])).toThrow();
  });

  it('rejects future, reversed, zero, and fractional discovery timestamps', () => {
    for (const timestamps of [[2, 2], [2, 1], [0, 1], [1, 0], [0.5, 1], [1, 1.5]]) {
      const item = record(LINE, 0, 'scout-a', timestamps[0]!, timestamps[1]!);
      expect(() => evaluateRun(LINE, [snapshot(LINE, 0), snapshot(LINE, 1, { records: { relay: [item] } })])).toThrow();
    }
  });

  it('rejects conflicting source discovery ticks across holders or time', () => {
    const early = record(LINE, 0, 'scout-a');
    const late = record(LINE, 0, 'scout-a', 2);
    expect(() => evaluateRun(LINE, [snapshot(LINE, 0), snapshot(LINE, 1, { records: { 'scout-a': [early] } }),
      snapshot(LINE, 2, { records: { relay: [late] } })])).toThrow('Conflicting first-discovery');
  });

  it('rejects false map or discovery terrain instead of counting it as knowledge', () => {
    const first = snapshot(LINE, 1);
    const falseMap: SimulationState = { ...first, relay: { ...first.relay, sharedMap: {
      ...first.relay.sharedMap, cells: ['blocked', ...first.relay.sharedMap.cells.slice(1)],
    } } };
    expect(() => evaluateRun(LINE, [snapshot(LINE, 0), falseMap])).toThrow('truthful terrain');
    const falseRecord = { ...record(LINE, 0, 'scout-a'), cell: 'blocked' as const };
    expect(() => evaluateRun(LINE, [snapshot(LINE, 0), snapshot(LINE, 1, { records: { relay: [falseRecord] } })]))
      .toThrow('static ground truth');
  });

  it('accepts real engine snapshots and leaves frozen input and earlier results unchanged', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const stay = { 'scout-a': { kind: 'stay' }, 'scout-b': { kind: 'stay' }, 'scout-c': { kind: 'stay' } } as const;
    const next = stepSimulation(TEST_SCENARIO, initial, stay);
    const run = deepFreeze([initial, next]);
    const before = JSON.stringify(run);
    const first = evaluateRun(TEST_SCENARIO, run);
    const second = evaluateRun(TEST_SCENARIO, run);
    expect(first).toEqual(second);
    expect(JSON.stringify(run)).toBe(before);
    expect(first.coverage).not.toBe(second.coverage);
    expect(first.connectedTicks).not.toBe(second.connectedTicks);
    expect(first.connectivityFraction).not.toBe(second.connectivityFraction);
  });
});

describe('incremental run metrics against the unchanged batch reference', () => {
  function comparePrefixes(scenario: Scenario, history: readonly SimulationState[]): void {
    const accumulator = new RunMetricsAccumulator(scenario, history[0]!);
    for (let tick = 0; tick < history.length; tick++) {
      const actual = tick === 0 ? accumulator.getMetrics() : accumulator.append(history[tick]!);
      expect(actual).toStrictEqual(evaluateRun(scenario, history.slice(0, tick + 1)));
    }
  }

  it('matches every small prefix with copied discoveries, distinct sources, walls and connectivity', () => {
    const a = record(ISLANDS, 0, 'scout-a');
    const b = record(ISLANDS, 0, 'scout-b');
    const walls = IDS.map(id => record(ISLANDS, 2, id));
    const island = [record(ISLANDS, 6, 'scout-a'), record(ISLANDS, 6, 'scout-c')];
    const history = deepFreeze([
      snapshot(ISLANDS, 0),
      snapshot(ISLANDS, 1, { local: { 'scout-a': [0, 1, 2, 6], 'scout-b': [1, 3] },
        relay: [0, 2, 7], connected: ['scout-a', 'scout-c'],
        records: { 'scout-a': [a, ...walls], 'scout-b': [b, ...island] } }),
      snapshot(ISLANDS, 2, { local: { 'scout-a': [0, 1], 'scout-c': [3, 4, 7] },
        relay: [0, 1, 3, 4], connected: ['scout-a'], records: {
          relay: [a, b, ...walls, ...island].map(item => ({ ...item, receivedAtTick: 2 })),
          'scout-c': [a, b, ...walls, ...island],
        } }),
      snapshot(ISLANDS, 3, { connected: ['scout-b'], records: { relay: [a, b] } }),
    ]);
    comparePrefixes(ISLANDS, history);
    expect(evaluateRun(ISLANDS, history).duplicateDiscoveries).toBe(4);
  });

  it('matches first time-to-90, tick-zero targets and noninteger thresholds at every prefix', () => {
    const all = Array.from({ length: 10 }, (_, index) => index);
    comparePrefixes(LINE, [snapshot(LINE, 0), ...[8, 9, 0, 10].map((count, index) =>
      snapshot(LINE, index + 1, { local: { 'scout-a': all }, relay: all.slice(0, count) }))]);
    comparePrefixes(LINE, [snapshot(LINE, 0, { relay: all }), snapshot(LINE, 1)]);
    const clear = reachableSurveyIndices(TEST_SCENARIO);
    const below = Math.ceil(clear.length * 0.9) - 1;
    comparePrefixes(TEST_SCENARIO, [snapshot(TEST_SCENARIO, 0),
      snapshot(TEST_SCENARIO, 1, { relay: clear.slice(0, below) }),
      snapshot(TEST_SCENARIO, 2, { relay: clear.slice(0, below + 1) })]);
  });

  it('rejects malformed appends like the batch reference, then remains usable at the same tick', () => {
    const zero = snapshot(LINE, 0);
    const valid = snapshot(LINE, 1, { connected: ['scout-a'], records: { relay: [record(LINE, 0, 'scout-a')] } });
    const invalid: SimulationState[] = [
      zero, snapshot(LINE, 2), { ...valid, tick: 0.5 },
      { ...valid, schemaVersion: 1 as 2 },
      { ...valid, config: { ...valid.config, rulesVersion: 1 as 2 } },
      { ...valid, config: { ...valid.config, scenarioId: 'other' } },
      { ...valid, config: { ...valid.config, scenarioVersion: 2 } },
      { ...valid, config: { ...valid.config, communicationRange: 3 } },
      { ...valid, config: { ...valid.config, relaySiteId: 'site-b' } },
      { ...valid, scouts: [valid.scouts[1], valid.scouts[0], valid.scouts[2]] },
      { ...valid, relay: { ...valid.relay, position: { x: 4, y: 0 } } },
      { ...valid, relay: { ...valid.relay, connectivityEvaluatedAtTick: 0 } },
      { ...valid, relay: { ...valid.relay, connectedScoutIds: [] } },
      { ...valid, relay: { ...valid.relay, communication: { status: 'not-evaluated' } } },
      { ...valid, scouts: [{ ...valid.scouts[0], communication: {
        status: 'evaluated', tick: 0, peerIds: [], componentId: 'relay', relayReachable: true,
      } }, valid.scouts[1], valid.scouts[2]] },
      { ...valid, relay: { ...valid.relay, sharedMap: { ...valid.relay.sharedMap, width: 9 } } },
      { ...valid, scouts: [{ ...valid.scouts[0], localMap: {
        ...valid.scouts[0].localMap, cells: ['blocked', ...valid.scouts[0].localMap.cells.slice(1)],
      } }, valid.scouts[1], valid.scouts[2]] },
      ...[[2, 2], [2, 1], [0, 1], [1, 0], [0.5, 1], [1, 1.5]].map(([discovered, received]) =>
        snapshot(LINE, 1, { records: { relay: [record(LINE, 0, 'scout-a', discovered!, received!)] } })),
      snapshot(LINE, 1, { records: { relay: [{ ...record(LINE, 0, 'scout-a'), cell: 'blocked' }] } }),
      snapshot(LINE, 1, { records: { relay: [{ ...record(LINE, 0, 'scout-a'), sourceId: 'other' as ScoutId }] } }),
      snapshot(LINE, 1, { records: { relay: [{ ...record(LINE, 0, 'scout-a'), position: { x: 10, y: 0 } }] } }),
    ];
    for (const bad of invalid) {
      const accumulator = new RunMetricsAccumulator(LINE, zero);
      const before = accumulator.getMetrics();
      expect(() => evaluateRun(LINE, [zero, bad])).toThrow();
      expect(() => accumulator.append(bad)).toThrow();
      expect(accumulator.getMetrics()).toStrictEqual(before);
      expect(accumulator.append(valid)).toStrictEqual(evaluateRun(LINE, [zero, valid]));
      expect(() => accumulator.append(valid)).toThrow();
      expect(accumulator.append(snapshot(LINE, 2))).toStrictEqual(evaluateRun(LINE, [zero, valid, snapshot(LINE, 2)]));
    }
  });

  it('rolls back staged discoveries on conflicts within a snapshot or across time', () => {
    const a = record(LINE, 0, 'scout-a');
    const zero = snapshot(LINE, 0);
    const one = snapshot(LINE, 1, { records: { relay: [a] } });
    for (const records of [
      { relay: [record(LINE, 1, 'scout-b', 2)], 'scout-c': [{ ...a, discoveredAtTick: 2, receivedAtTick: 2 }] },
      { relay: [record(LINE, 1, 'scout-b', 2)], 'scout-c': [record(LINE, 1, 'scout-b')] },
    ]) {
      const accumulator = new RunMetricsAccumulator(LINE, zero);
      accumulator.append(one);
      const before = accumulator.getMetrics();
      const bad = snapshot(LINE, 2, { connected: IDS, relay: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], records });
      expect(() => evaluateRun(LINE, [zero, one, bad])).toThrow('Conflicting first-discovery');
      expect(() => accumulator.append(bad)).toThrow('Conflicting first-discovery');
      expect(accumulator.getMetrics()).toStrictEqual(before);
      const valid = snapshot(LINE, 2, { records: { relay: [record(LINE, 1, 'scout-c', 2)] } });
      expect(accumulator.append(valid)).toStrictEqual(evaluateRun(LINE, [zero, one, valid]));
      expect(accumulator.getMetrics().duplicateDiscoveries).toBe(0);
    }
  });

  it('validates static context and tick zero before accepting a run', () => {
    const zero = snapshot(LINE, 0);
    for (const scenario of [
      { ...LINE, id: '' }, { ...LINE, version: 0 }, { ...LINE, communicationRange: 0 },
      { ...LINE, groundTruth: { ...LINE.groundTruth, cells: [] } },
      { ...LINE, groundTruth: parseGroundTruth(['#.........']) },
      { ...LINE, groundTruth: parseGroundTruth(['...#......']) },
    ]) {
      expect(() => evaluateRun(scenario, [zero])).toThrow();
      expect(() => new RunMetricsAccumulator(scenario, zero)).toThrow();
    }
    for (const invalid of [snapshot(LINE, 1), { ...zero, relay: { ...zero.relay,
      communication: { status: 'evaluated', tick: 0, peerIds: [], componentId: 'relay', relayReachable: true } as const,
    } }]) {
      expect(() => evaluateRun(LINE, [invalid])).toThrow();
      expect(() => new RunMetricsAccumulator(LINE, invalid)).toThrow();
    }
  });

  it('detaches static context, prepared values, publications, and coverage rows', () => {
    const scenario = structuredClone(LINE);
    const zero = deepFreeze(snapshot(LINE, 0));
    const accumulator = new RunMetricsAccumulator(scenario, zero);
    const published = accumulator.getMetrics();
    const saved = JSON.stringify(published);
    const one = snapshot(LINE, 1, { relay: [0], connected: ['scout-a'], records: { relay: [record(LINE, 0, 'scout-a')] } });
    const commit = accumulator.prepareAppend(one);
    expect(accumulator.getMetrics()).toStrictEqual(published);
    // Runtime mutation by a caller must not alter retained evaluator context or prepared data.
    (scenario.groundTruth.cells as string[])[0] = 'blocked';
    (scenario.relaySites[0].position as { x: number }).x = 9;
    (one.relay.sharedMap.cells as string[])[0] = 'blocked';
    const current = commit();
    expect(current).toStrictEqual(evaluateRun(LINE, [zero, snapshot(LINE, 1, {
      relay: [0], connected: ['scout-a'], records: { relay: [record(LINE, 0, 'scout-a')] },
    })]));
    expect(JSON.stringify(published)).toBe(saved);
    expect(current.coverage[0]).not.toBe(published.coverage[0]);
    expect(current.connectedTicks).not.toBe(published.connectedTicks);
    (published.coverage[0] as { fleetKnownCount: number }).fleetKnownCount = 99;
    (published.connectedTicks as Record<ScoutId, number>)['scout-a'] = 99;
    expect(accumulator.getMetrics()).toStrictEqual(current);
    deepFreeze(current);
    accumulator.append(snapshot(LINE, 2));
    expect(current.completedTicks).toBe(1);
    expect(current.coverage).toHaveLength(2);
    expect(() => commit()).toThrow('stale');
  });
});
