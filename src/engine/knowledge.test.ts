import { describe, expect, it } from 'vitest';
import { createUnknownMap, fromIndex } from './grid';
import { mergeDiscoveries, mergeDiscoveriesIntoMap, recordScanDiscoveries } from './knowledge';
import type {
  CellState, Discovery, DiscoveryRecord, KnowledgeMap, Observation, Position, ScoutId,
} from './types';

const size = { width: 3, height: 2 };

function record(overrides: Partial<DiscoveryRecord> = {}): DiscoveryRecord {
  return {
    sourceId: 'scout-a', position: { x: 1, y: 0 }, cell: 'clear',
    discoveredAtTick: 1, receivedAtTick: 1, ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    scoutId: 'scout-a', tick: 1, position: { x: 1, y: 0 }, cell: 'clear', ...overrides,
  };
}

describe('bounded first discoveries', () => {
  it('retains first sensing and receipt ticks while later scans remain observations', () => {
    const initial = recordScanDiscoveries(size, [], [observation()], 'scout-a', 1);
    const latestScan = [observation({ tick: 12 })];
    expect(recordScanDiscoveries(size, initial, latestScan, 'scout-a', 12)).toEqual(initial);
    expect(latestScan[0]!.tick).toBe(12);
  });

  it('records this source even if another source already discovered the cell', () => {
    const received = [record({ sourceId: 'scout-b', receivedAtTick: 2 })];
    expect(recordScanDiscoveries(size, received, [observation({ tick: 5 })], 'scout-a', 5))
      .toEqual([
        record({ discoveredAtTick: 5, receivedAtTick: 5 }),
        record({ sourceId: 'scout-b', receivedAtTick: 2 }),
      ]);
  });

  it('coalesces duplicate observations within a scan', () => {
    expect(recordScanDiscoveries(size, [], [observation(), observation()], 'scout-a', 1))
      .toEqual([record()]);
  });

  it('rejects contradictory rescans instead of silently skipping them', () => {
    expect(() => recordScanDiscoveries(
      size, [record()], [observation({ tick: 2, cell: 'blocked' })], 'scout-a', 2,
    )).toThrow('rescan conflicts');
  });

  it('rejects contradictory observations within a first scan', () => {
    expect(() => recordScanDiscoveries(
      size, [], [observation(), observation({ cell: 'blocked' })], 'scout-a', 1,
    )).toThrow('Conflicting discovery states');
  });

  it('rejects a new source observation contradicting received knowledge', () => {
    expect(() => recordScanDiscoveries(
      size, [record({ sourceId: 'scout-b' })], [observation({ cell: 'blocked' })], 'scout-a', 1,
    )).toThrow('Conflicting discovery states');
  });

  it.each([
    observation({ scoutId: 'scout-b' }), observation({ tick: 2 }), observation({ tick: 0 }),
  ])('rejects an observation from another scout or tick: %j', invalid => {
    expect(() => recordScanDiscoveries(size, [], [invalid], 'scout-a', 1)).toThrow();
  });

  it('never grows past three source records per cell through repeated full-grid scans', () => {
    let retained: readonly DiscoveryRecord[] = [];
    const ids: readonly ScoutId[] = ['scout-a', 'scout-b', 'scout-c'];
    for (let tick = 1; tick <= 100; tick++) {
      for (const scoutId of ids) {
        const scan = Array.from({ length: size.width * size.height }, (_, index): Observation => ({
          scoutId, tick, position: fromIndex(size, index), cell: index === 4 ? 'blocked' : 'clear',
        }));
        retained = recordScanDiscoveries(size, retained, scan, scoutId, tick);
      }
      expect(retained).toHaveLength(3 * size.width * size.height);
      expect(retained.every(item => item.discoveredAtTick === 1 && item.receivedAtTick === 1)).toBe(true);
    }
  });

  it('returns detached records and leaves frozen scan input unchanged', () => {
    const old = Object.freeze(record({ position: Object.freeze({ x: 1, y: 0 }) }));
    const scan = Object.freeze(observation({ position: Object.freeze({ x: 2, y: 1 }), tick: 2 }));
    const result = recordScanDiscoveries(size, Object.freeze([old]), Object.freeze([scan]), 'scout-a', 2);
    expect(result[0]).not.toBe(old);
    expect(result[0]!.position).not.toBe(old.position);
    expect(result[1]!.position).not.toBe(scan.position);
    (result[0]!.position as { x: number }).x = 0;
    (result[1]!.position as { x: number }).x = 0;
    expect(old.position.x).toBe(1);
    expect(scan.position.x).toBe(2);
  });
});

describe('recipient discovery merging', () => {
  it('preserves source time and records this recipient arrival, ignoring sender receipt', () => {
    const incoming = record({ discoveredAtTick: 2, receivedAtTick: 4 });
    expect(mergeDiscoveries(size, [], [incoming], 7))
      .toEqual([record({ discoveredAtTick: 2, receivedAtTick: 7 })]);
    // A receipt field is not a source fact; even an invalid sender field is ignored.
    expect(mergeDiscoveries(size, [], [{ ...incoming, receivedAtTick: NaN } as Discovery], 7))
      .toEqual([record({ discoveredAtTick: 2, receivedAtTick: 7 })]);
  });

  it('preserves an existing recipient receipt when a discovery circulates back', () => {
    const retained = record({ discoveredAtTick: 2, receivedAtTick: 3 });
    const returning = record({ discoveredAtTick: 2, receivedAtTick: 8 });
    expect(mergeDiscoveries(size, [retained], [returning, returning], 9)).toEqual([retained]);
  });

  it('coalesces existing duplicate receipts to the earliest receipt independent of order', () => {
    const early = record({ receivedAtTick: 2 });
    const late = record({ receivedAtTick: 4 });
    expect(mergeDiscoveries(size, [late, early], [], 5)).toEqual([early]);
    expect(mergeDiscoveries(size, [early, late], [], 5)).toEqual([early]);
  });

  it('sorts source first, then row-major coordinates, independent of input order', () => {
    const records = [
      record({ sourceId: 'scout-c', position: { x: 0, y: 0 } }),
      record({ sourceId: 'scout-a', position: { x: 0, y: 1 } }),
      record({ sourceId: 'scout-b', position: { x: 0, y: 0 } }),
      record({ sourceId: 'scout-a', position: { x: 2, y: 0 } }),
    ];
    const expected = [records[3], records[1], records[2], records[0]];
    expect(mergeDiscoveries(size, records, [], 1)).toEqual(expected);
    expect(mergeDiscoveries(size, [], [...records].reverse(), 1)).toEqual(expected);
  });

  it.each(['scout-a', 'scout-b'] as const)('rejects contradictory states from %s', sourceId => {
    expect(() => mergeDiscoveries(size, [record()], [record({ sourceId, cell: 'blocked' })], 1))
      .toThrow('Conflicting discovery states');
  });

  it('rejects conflicting source discovery ticks rather than choosing a version', () => {
    expect(() => mergeDiscoveries(size, [record()], [record({ discoveredAtTick: 2 })], 3))
      .toThrow('Conflicting first-discovery ticks');
    expect(() => mergeDiscoveries(size, [], [record(), record({ discoveredAtTick: 2 })], 3))
      .toThrow('Conflicting first-discovery ticks');
  });

  it('does not mutate or retain references to either input', () => {
    const old = Object.freeze(record({ position: Object.freeze({ x: 1, y: 0 }) }));
    const incoming = Object.freeze(record({ sourceId: 'scout-b', position: Object.freeze({ x: 2, y: 1 }) }));
    const merged = mergeDiscoveries(size, Object.freeze([old]), Object.freeze([incoming]), 2);
    expect(merged[0]).not.toBe(old);
    expect(merged[1]).not.toBe(incoming);
    (merged[0]!.position as { x: number }).x = 0;
    (merged[1]!.position as { x: number }).x = 0;
    expect(old.position).toEqual({ x: 1, y: 0 });
    expect(incoming.position).toEqual({ x: 2, y: 1 });
  });
});

describe('discovery validation', () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid current tick %s even with no discoveries', tick => {
      expect(() => mergeDiscoveries(size, [], [], tick)).toThrow(RangeError);
      expect(() => recordScanDiscoveries(size, [], [], 'scout-a', tick)).toThrow(RangeError);
    },
  );

  it.each([
    record({ discoveredAtTick: 0 }), record({ discoveredAtTick: 1.5 }),
    record({ discoveredAtTick: NaN }), record({ discoveredAtTick: 6 }),
    record({ receivedAtTick: 0 }), record({ receivedAtTick: 1.5 }),
    record({ receivedAtTick: NaN }), record({ receivedAtTick: 6 }),
    record({ discoveredAtTick: 3, receivedAtTick: 2 }),
  ])('rejects invalid retained timestamp ordering: %j', invalid => {
    expect(() => mergeDiscoveries(size, [invalid], [], 5)).toThrow(RangeError);
  });

  it.each([0, 1.5, NaN, 6])('rejects invalid incoming source tick %s', discoveredAtTick => {
    expect(() => mergeDiscoveries(size, [], [record({ discoveredAtTick })], 5)).toThrow(RangeError);
  });

  it.each([
    { x: -1, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 2 },
    { x: 0.5, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity },
  ])('rejects invalid record and scan position %j', position => {
    expect(() => mergeDiscoveries(size, [], [record({ position })], 1)).toThrow(RangeError);
    expect(() => recordScanDiscoveries(size, [], [observation({ position })], 'scout-a', 1))
      .toThrow(RangeError);
  });

  it('rejects unknown source IDs and unknown or invalid observed states', () => {
    expect(() => mergeDiscoveries(size, [], [record({ sourceId: 'scout-z' as ScoutId })], 1))
      .toThrow(TypeError);
    expect(() => recordScanDiscoveries(size, [], [], 'scout-z' as ScoutId, 1)).toThrow(TypeError);
    for (const cell of ['unknown', 'wall']) {
      expect(() => mergeDiscoveries(size, [], [{ ...record(), cell } as Discovery], 1))
        .toThrow(TypeError);
      expect(() => recordScanDiscoveries(size, [], [{ ...observation(), cell } as Observation], 'scout-a', 1))
        .toThrow(TypeError);
    }
  });
});

describe('discovery projection into knowledge maps', () => {
  it('fills only recorded cells and preserves all other unknowns', () => {
    const map = createUnknownMap(size);
    const records = [record(), record({ sourceId: 'scout-b', position: { x: 0, y: 1 }, cell: 'blocked' })];
    const updated = mergeDiscoveriesIntoMap(map, records);
    expect(updated.cells).toEqual(['unknown', 'clear', 'unknown', 'blocked', 'unknown', 'unknown']);
    expect(map.cells).toEqual(Array(6).fill('unknown'));
  });

  it('preserves known cells and returns independent map storage even without records', () => {
    const map: KnowledgeMap = { ...createUnknownMap(size), cells: ['clear', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'] };
    const updated = mergeDiscoveriesIntoMap(map, []);
    expect(updated).toEqual(map);
    expect(updated).not.toBe(map);
    expect(updated.cells).not.toBe(map.cells);
    (updated.cells as CellState[])[0] = 'blocked';
    expect(map.cells[0]).toBe('clear');
  });

  it('rejects contradictions with known map cells and between source records', () => {
    const map = mergeDiscoveriesIntoMap(createUnknownMap(size), [record()]);
    expect(() => mergeDiscoveriesIntoMap(map, [record({ cell: 'blocked' })]))
      .toThrow('recipient\'s known map cell');
    expect(() => mergeDiscoveriesIntoMap(createUnknownMap(size), [record(), record({ sourceId: 'scout-b', cell: 'blocked' })]))
      .toThrow('Conflicting discovery states');
    expect(map.cells[1]).toBe('clear');
  });

  it('validates timestamps and coordinates before map projection', () => {
    const invalid = [record({ discoveredAtTick: 2, receivedAtTick: 1 }), record({ position: { x: 9, y: 0 } })];
    for (const item of invalid) {
      expect(() => mergeDiscoveriesIntoMap(createUnknownMap(size), [item])).toThrow(RangeError);
    }
  });

  it('rejects malformed, sparse, and wrong-kind map storage', () => {
    const malformed = [
      { ...createUnknownMap(size), cells: ['unknown'] },
      { ...createUnknownMap(size), cells: Array<CellState>(6) },
      { ...createUnknownMap(size), cells: ['invalid', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'] },
      { ...createUnknownMap(size), kind: 'ground-truth' },
    ];
    for (const map of malformed) {
      expect(() => mergeDiscoveriesIntoMap(map as KnowledgeMap, [])).toThrow(TypeError);
    }
  });

  it('leaves frozen input maps and record coordinates detached', () => {
    const map = Object.freeze({ ...createUnknownMap(size), cells: Object.freeze(Array<CellState>(6).fill('unknown')) });
    const source = Object.freeze(record({ position: Object.freeze({ x: 1, y: 0 }) }));
    const result = mergeDiscoveriesIntoMap(map, Object.freeze([source]));
    (result.cells as CellState[])[1] = 'blocked';
    expect(map.cells[1]).toBe('unknown');
    expect(source.cell).toBe('clear');
    expect(source.position).toEqual<Position>({ x: 1, y: 0 });
  });
});
