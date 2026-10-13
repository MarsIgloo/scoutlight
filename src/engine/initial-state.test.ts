import { describe, expect, it } from 'vitest';
import { createInitialState } from './initial-state';
import { parseGroundTruth } from './grid';
import { TEST_SCENARIO } from './scenario';
import type {
  CellState, FrontierClaim, Observation, RelaySiteId, Scenario, SimulationState,
} from './types';

/** Collect every nested object to catch aliases beyond just map buffers. */
function objectsIn(value: unknown): object[] {
  if (value === null || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(objectsIn)];
}

describe('initial state', () => {
  it('creates three correctly placed scouts before any simulation work', () => {
    const state = createInitialState(TEST_SCENARIO, 'site-a');
    expect(state.schemaVersion).toBe(2);
    expect(state.tick).toBe(0);
    expect(state.config).toEqual({
      scenarioId: 'm0-test-grid', scenarioVersion: 1, relaySiteId: 'site-a',
      communicationRange: 1, rulesVersion: 2,
    });
    expect(state.scouts.map(scout => scout.id)).toEqual(['scout-a', 'scout-b', 'scout-c']);

    for (const [index, scout] of state.scouts.entries()) {
      expect(scout.position).toEqual(TEST_SCENARIO.scouts[index]?.position);
      expect(scout.heading).toBe('east');
      expect(scout.localMap.width).toBe(9);
      expect(scout.localMap.height).toBe(7);
      expect(scout.localMap.cells).toHaveLength(63);
      expect(scout.localMap.cells.every(cell => cell === 'unknown')).toBe(true);
      expect(scout.target).toBeNull();
      expect(scout.claims).toEqual({ lastIssuedRevision: 0, knownClaims: [] });
      expect(scout.communication).toEqual({ status: 'not-evaluated' });
      expect(scout.sensorTelemetry).toBeNull();
      expect(scout.discoveries).toEqual([]);
    }

    expect(state.relay.id).toBe('relay');
    expect(state.relay.sharedMap.cells).toHaveLength(63);
    expect(state.relay.sharedMap.cells.every(cell => cell === 'unknown')).toBe(true);
    expect(state.relay.connectivityEvaluatedAtTick).toBeNull();
    expect(state.relay.connectedScoutIds).toEqual([]);
    expect(state.relay.knownClaims).toEqual([]);
    expect(state.relay.discoveries).toEqual([]);
    expect(state).not.toHaveProperty('groundTruth');
  });

  it.each(TEST_SCENARIO.relaySites)('places the relay at $id', site => {
    const state = createInitialState(TEST_SCENARIO, site.id);
    expect(state.relay.position).toEqual(site.position);
    expect(state.config.relaySiteId).toBe(site.id);
    expect(state.scouts).toEqual(createInitialState(TEST_SCENARIO, 'site-a').scouts);
  });

  it('shares no nested objects within a run, across runs, or with the scenario', () => {
    const first = createInitialState(TEST_SCENARIO, 'site-a');
    const second = createInitialState(TEST_SCENARIO, 'site-a');
    const firstObjects = objectsIn(first);
    const otherObjects = new Set([...objectsIn(second), ...objectsIn(TEST_SCENARIO)]);
    expect(new Set(firstObjects).size).toBe(firstObjects.length);
    expect(firstObjects.some(object => otherObjects.has(object))).toBe(false);

    // Simulate an accidental future write; other scouts, relay, and runs stay isolated.
    (first.scouts[0].localMap.cells as CellState[])[10] = 'clear';
    expect(first.scouts[1].localMap.cells[10]).toBe('unknown');
    expect(first.relay.sharedMap.cells[10]).toBe('unknown');
    expect(second.scouts[0].localMap.cells[10]).toBe('unknown');
    expect(TEST_SCENARIO.groundTruth.cells[10]).toBe('clear');
  });

  it('does not copy unseen terrain into any part of run state', () => {
    const otherTerrain = parseGroundTruth([
      '#########',
      '#......##', // Changes a cell away from spawns and relay sites.
      '#..#....#',
      '#..#.#..#',
      '#....#..#',
      '#.......#',
      '#########',
    ]);
    const alternate = { ...TEST_SCENARIO, groundTruth: otherTerrain };
    expect(createInitialState(alternate, 'site-a')).toStrictEqual(
      createInitialState(TEST_SCENARIO, 'site-a'),
    );
  });

  it('copies only x/y from positions, excluding extra authoring metadata', () => {
    // Structural typing permits richer input objects; terrain must still stay outside state.
    const scoutPosition = {
      ...TEST_SCENARIO.scouts[0].position, groundTruth: TEST_SCENARIO.groundTruth,
    };
    const relayPosition = {
      ...TEST_SCENARIO.relaySites[0].position, groundTruth: TEST_SCENARIO.groundTruth,
    };
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      scouts: [{ ...TEST_SCENARIO.scouts[0], position: scoutPosition },
        TEST_SCENARIO.scouts[1], TEST_SCENARIO.scouts[2]],
      relaySites: [{ ...TEST_SCENARIO.relaySites[0], position: relayPosition },
        TEST_SCENARIO.relaySites[1], TEST_SCENARIO.relaySites[2]],
    };
    expect(createInitialState(scenario, 'site-a')).toStrictEqual(
      createInitialState(TEST_SCENARIO, 'site-a'),
    );
  });

  it('initializes deterministically in canonical ID order without changing the input', () => {
    const before = JSON.stringify(TEST_SCENARIO);
    const reordered: Scenario = {
      ...TEST_SCENARIO,
      scouts: [TEST_SCENARIO.scouts[2], TEST_SCENARIO.scouts[0], TEST_SCENARIO.scouts[1]],
      relaySites: [TEST_SCENARIO.relaySites[1], TEST_SCENARIO.relaySites[2], TEST_SCENARIO.relaySites[0]],
    };
    const first = JSON.stringify(createInitialState(TEST_SCENARIO, 'site-b'));
    expect(JSON.stringify(createInitialState(TEST_SCENARIO, 'site-b'))).toBe(first);
    expect(JSON.stringify(createInitialState(reordered, 'site-b'))).toBe(first);
    expect(JSON.stringify(TEST_SCENARIO)).toBe(before);
  });

  it('round-trips through JSON without losing initial state', () => {
    const state = createInitialState(TEST_SCENARIO, 'site-c');
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });

  it('can represent observation provenance and versioned releases as JSON data', () => {
    const initial = createInitialState(TEST_SCENARIO, 'site-a');
    const observation: Observation = {
      scoutId: 'scout-a', tick: 1, position: { x: 1, y: 1 }, cell: 'clear',
    };
    const active: FrontierClaim = {
      ownerId: 'scout-b', revision: 1, issuedAtTick: 1,
      status: 'active', target: { x: 2, y: 3 }, expiresAtTick: 5,
    };
    const released: FrontierClaim = {
      ownerId: 'scout-a', revision: 2, issuedAtTick: 2,
      status: 'released', target: null, expiresAtTick: null,
    };
    // Data fixtures only: issuing, exchanging, and reconciling records are M2.
    const state: SimulationState = {
      ...initial,
      tick: 2,
      relay: {
        ...initial.relay,
        knownClaims: [released, active],
        discoveries: [{
          sourceId: observation.scoutId, position: observation.position, cell: observation.cell,
          discoveredAtTick: observation.tick, receivedAtTick: 2,
        }],
      },
    };
    expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
  });
});

describe('authored scenario validation', () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid communication range %s', communicationRange => {
      expect(() => createInitialState({ ...TEST_SCENARIO, communicationRange }, 'site-a'))
        .toThrow(RangeError);
    },
  );

  it.each([
    { x: 0, y: 0 }, // Wall.
    { x: 9, y: 1 }, // Out of bounds.
    { x: 1.5, y: 1 }, // Not a grid cell.
  ])('rejects an invalid scout spawn at $x, $y', position => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      scouts: [{ ...TEST_SCENARIO.scouts[0], position }, TEST_SCENARIO.scouts[1], TEST_SCENARIO.scouts[2]],
    };
    expect(() => createInitialState(scenario, 'site-a')).toThrow(RangeError);
  });

  it('validates all relay sites, including an unselected site', () => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      relaySites: [TEST_SCENARIO.relaySites[0], TEST_SCENARIO.relaySites[1], {
        ...TEST_SCENARIO.relaySites[2], position: { x: 0, y: 0 },
      }],
    };
    expect(() => createInitialState(scenario, 'site-a')).toThrow('clear cell');
  });

  it('rejects duplicate scout IDs', () => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      scouts: [TEST_SCENARIO.scouts[0], TEST_SCENARIO.scouts[0], TEST_SCENARIO.scouts[2]],
    };
    expect(() => createInitialState(scenario, 'site-a')).toThrow('exactly scout-a');
  });

  it('rejects duplicate relay IDs', () => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      relaySites: [TEST_SCENARIO.relaySites[0], TEST_SCENARIO.relaySites[0], TEST_SCENARIO.relaySites[2]],
    };
    expect(() => createInitialState(scenario, 'site-a')).toThrow('exactly site-a');
  });

  it('rejects different relay IDs at the same location', () => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      relaySites: [TEST_SCENARIO.relaySites[0], {
        ...TEST_SCENARIO.relaySites[1], position: TEST_SCENARIO.relaySites[0].position,
      }, TEST_SCENARIO.relaySites[2]],
    };
    expect(() => createInitialState(scenario, 'site-a')).toThrow('different cells');
  });

  it('rejects an unknown selected relay ID', () => {
    expect(() => createInitialState(TEST_SCENARIO, 'missing' as RelaySiteId)).toThrow('Unknown relay site');
  });

  it.each([
    { id: '', version: 1 }, { id: 'test', version: 0 }, { id: 'test', version: 1.5 },
  ])('rejects invalid scenario identity $id / $version', identity => {
    expect(() => createInitialState({ ...TEST_SCENARIO, ...identity }, 'site-a')).toThrow('ID');
  });

  it('rejects malformed ground-truth storage', () => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      groundTruth: { ...TEST_SCENARIO.groundTruth, cells: ['clear'] },
    };
    expect(() => createInitialState(scenario, 'site-a')).toThrow('representation');
  });

  it('rejects unknown terrain even if an external caller bypasses types', () => {
    const scenario = {
      ...TEST_SCENARIO,
      groundTruth: {
        ...TEST_SCENARIO.groundTruth,
        cells: Array<CellState>(63).fill('unknown'),
      },
    } as unknown as Scenario;
    expect(() => createInitialState(scenario, 'site-a')).toThrow('clear or blocked');
  });
});
