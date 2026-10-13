import { describe, expect, it } from 'vitest';
import { createUnknownMap, parseGroundTruth } from './grid';
import { scanScout } from './sensor';
import type { CellState, GroundTruthGrid, Heading, Position, ScoutState } from './types';

function scout(terrain: GroundTruthGrid, position: Position, heading: Heading) {
  return { id: 'scout-a' as const, position, heading, localMap: createUnknownMap(terrain) };
}

function positions(path: string, origin: Position = { x: 0, y: 0 }): Position[] {
  return path.split(' ').map(pair => {
    const [x, y] = pair.split(',').map(Number);
    if (x === undefined || y === undefined) throw new Error('Invalid test path.');
    return { x: origin.x + x, y: origin.y + y };
  });
}

// Hand-authored supercover paths, relative to the origin. These fixtures also
// specify the left-to-right order independently of the traversal algorithm.
const openFanCases: readonly { heading: Heading; paths: readonly string[] }[] = [
  { heading: 'east', paths: [
    '0,0 1,0 0,-1 1,-1 2,-1 1,-2 2,-2 3,-2 2,-3 3,-3 4,-3 3,-4 4,-4',
    '0,0 1,0 1,-1 2,-1 3,-1 3,-2 4,-2',
    '0,0 1,0 2,0 3,0 4,0',
    '0,0 1,0 1,1 2,1 3,1 3,2 4,2',
    '0,0 1,0 0,1 1,1 2,1 1,2 2,2 3,2 2,3 3,3 4,3 3,4 4,4',
  ] },
  { heading: 'north', paths: [
    '0,0 0,-1 -1,0 -1,-1 -1,-2 -2,-1 -2,-2 -2,-3 -3,-2 -3,-3 -3,-4 -4,-3 -4,-4',
    '0,0 0,-1 -1,-1 -1,-2 -1,-3 -2,-3 -2,-4',
    '0,0 0,-1 0,-2 0,-3 0,-4',
    '0,0 0,-1 1,-1 1,-2 1,-3 2,-3 2,-4',
    '0,0 0,-1 1,0 1,-1 1,-2 2,-1 2,-2 2,-3 3,-2 3,-3 3,-4 4,-3 4,-4',
  ] },
  { heading: 'south', paths: [
    '0,0 0,1 1,0 1,1 1,2 2,1 2,2 2,3 3,2 3,3 3,4 4,3 4,4',
    '0,0 0,1 1,1 1,2 1,3 2,3 2,4',
    '0,0 0,1 0,2 0,3 0,4',
    '0,0 0,1 -1,1 -1,2 -1,3 -2,3 -2,4',
    '0,0 0,1 -1,0 -1,1 -1,2 -2,1 -2,2 -2,3 -3,2 -3,3 -3,4 -4,3 -4,4',
  ] },
  { heading: 'west', paths: [
    '0,0 -1,0 0,1 -1,1 -2,1 -1,2 -2,2 -3,2 -2,3 -3,3 -4,3 -3,4 -4,4',
    '0,0 -1,0 -1,1 -2,1 -3,1 -3,2 -4,2',
    '0,0 -1,0 -2,0 -3,0 -4,0',
    '0,0 -1,0 -1,-1 -2,-1 -3,-1 -3,-2 -4,-2',
    '0,0 -1,0 0,-1 -1,-1 -2,-1 -1,-2 -2,-2 -3,-2 -2,-3 -3,-3 -4,-3 -3,-4 -4,-4',
  ] },
];

describe('sensor geometry', () => {
  const terrain = parseGroundTruth(Array<string>(11).fill('...........'));
  const origin = { x: 5, y: 5 };

  it.each(openFanCases.flatMap(({ heading, paths }) =>
    paths.map((path, index) => ({ heading, path, index })),
  ))('traces $heading ray $index in exact order to maximum range', ({ heading, path, index }) => {
    const ray = scanScout(terrain, scout(terrain, origin, heading), 1).rays[index];
    const expected = positions(path, origin);
    const endpoint = expected.at(-1);
    if (!ray || !endpoint) throw new Error('Missing test ray.');
    expect(ray.index).toBe(index);
    expect(ray.cells).toEqual(expected.map(position => ({ position, cell: 'clear' })));
    expect(ray.endpointOffset).toEqual({ x: endpoint.x - origin.x, y: endpoint.y - origin.y });
    expect(ray.endPoint).toEqual({ x: endpoint.x * 4, y: endpoint.y * 4 });
    expect(ray.termination).toBe('maximum-range');
    expect(ray.firstBlockedCell).toBeNull();
    expect(Math.max(Math.abs(ray.endpointOffset.x), Math.abs(ray.endpointOffset.y))).toBe(4);
  });

  it('reports only the five sampled rays rather than filling the fan or looking behind', () => {
    const result = scanScout(terrain, scout(terrain, origin, 'east'), 1);
    expect(result.observations.some(({ position }) => position.x < origin.x)).toBe(false);
    // This cell lies between the center and inner ray but neither ray touches it.
    expect(result.observations).not.toContainEqual(expect.objectContaining({ position: { x: 9, y: 4 } }));
    expect(result.observations.some(({ position }) => position.x > 9)).toBe(false);
  });

  it.each([
    { heading: 'east' as const, origin: { x: 4, y: 2 }, ends: '18,6 18,7 18,8 18,9 18,10' },
    { heading: 'north' as const, origin: { x: 2, y: 0 }, ends: '6,-2 7,-2 8,-2 9,-2 10,-2' },
    { heading: 'south' as const, origin: { x: 2, y: 4 }, ends: '10,18 9,18 8,18 7,18 6,18' },
    { heading: 'west' as const, origin: { x: 0, y: 2 }, ends: '-2,10 -2,9 -2,8 -2,7 -2,6' },
  ])('stops all $heading rays exactly at the outward boundary', ({ heading, origin: start, ends }) => {
    const small = parseGroundTruth(Array<string>(5).fill('.....'));
    const result = scanScout(small, scout(small, start, heading), 1);
    expect(result.rays.map(ray => ray.endPoint)).toEqual(positions(ends));
    for (const ray of result.rays) {
      expect(ray.cells).toEqual([{ position: start, cell: 'clear' }]);
      expect(ray.termination).toBe('boundary');
      expect(ray.firstBlockedCell).toBeNull();
    }
    expect(result.observedCellCount).toBe(1);
    expect(result.blockedHitCount).toBe(0);
  });

  it('stops on a lateral boundary after recording the forward corner-side cell', () => {
    const small = parseGroundTruth(['.....', '.....', '.....']);
    const ray = scanScout(small, scout(small, { x: 1, y: 0 }, 'east'), 1).rays[0];
    expect(ray.cells.map(cell => cell.position)).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(ray.termination).toBe('boundary');
    expect(ray.endPoint).toEqual({ x: 6, y: -2 });
  });
});

describe('occlusion and corner crossings', () => {
  it('records the first wall once, counts every stopped ray, and exposes no cells beyond it', () => {
    const terrain = parseGroundTruth(Array<string>(7).fill('...#...'));
    const current = scout(terrain, { x: 2, y: 3 }, 'east');
    const result = scanScout(terrain, current, 7);
    expect(result.rays.map(ray => ray.endPoint)).toEqual(positions('10,10 10,11 10,12 10,13 10,14'));
    for (const ray of result.rays) {
      expect(ray.cells).toEqual([
        { position: { x: 2, y: 3 }, cell: 'clear' },
        { position: { x: 3, y: 3 }, cell: 'blocked' },
      ]);
      expect(ray.firstBlockedCell).toEqual({ x: 3, y: 3 });
      expect(ray.termination).toBe('obstacle');
    }
    expect(result.observations).toEqual([
      { scoutId: 'scout-a', tick: 7, position: { x: 2, y: 3 }, cell: 'clear' },
      { scoutId: 'scout-a', tick: 7, position: { x: 3, y: 3 }, cell: 'blocked' },
    ]);
    expect(result).toMatchObject({ rayCount: 5, observedCellCount: 2, newCellCount: 2, blockedHitCount: 5 });
    expect(result.newlyDiscoveredPositions).toEqual(positions('2,3 3,3'));
    expect(current.localMap.cells.every(cell => cell === 'unknown')).toBe(true);
  });

  it.each([
    { name: 'forward-side', rows: ['.....', '.....', '...#.', '.....', '.....'], path: '2,2 3,2', wall: { x: 3, y: 2 } },
    { name: 'lateral-side', rows: ['.....', '..#..', '.....', '.....', '.....'], path: '2,2 3,2 2,1', wall: { x: 2, y: 1 } },
    { name: 'diagonal', rows: ['.....', '...#.', '.....', '.....', '.....'], path: '2,2 3,2 2,1 3,1', wall: { x: 3, y: 1 } },
    { name: 'both side cells', rows: ['.....', '..#..', '...#.', '.....', '.....'], path: '2,2 3,2', wall: { x: 3, y: 2 } },
  ])('stops at the $name wall at an exact corner', ({ rows, path, wall }) => {
    const terrain = parseGroundTruth(rows);
    const ray = scanScout(terrain, scout(terrain, { x: 2, y: 2 }, 'east'), 1).rays[0];
    expect(ray.cells.map(cell => cell.position)).toEqual(positions(path));
    expect(ray.firstBlockedCell).toEqual(wall);
    expect(ray.termination).toBe('obstacle');
    expect(ray.endPoint).toEqual({ x: 10, y: 6 });
  });

  it('keeps forward-side priority when the heading turns north', () => {
    const terrain = parseGroundTruth(['.....', '..#..', '.#...', '.....', '.....']);
    const ray = scanScout(terrain, scout(terrain, { x: 2, y: 2 }, 'north'), 1).rays[0];
    expect(ray.cells.map(cell => cell.position)).toEqual(positions('2,2 2,1'));
    expect(ray.firstBlockedCell).toEqual({ x: 2, y: 1 });
    expect(ray.endPoint).toEqual({ x: 6, y: 6 });
  });

  it('records an inner ray hitting a horizontal obstacle face at an exact quarter coordinate', () => {
    const terrain = parseGroundTruth(['.......', '.......', '.......', '...#...', '.......', '.......', '.......']);
    const ray = scanScout(terrain, scout(terrain, { x: 2, y: 4 }, 'east'), 1).rays[1];
    expect(ray.cells.map(cell => cell.position)).toEqual(positions('2,4 3,4 3,3'));
    expect(ray.endPoint).toEqual({ x: 12, y: 14 });
    expect(ray.termination).toBe('obstacle');
  });
});

describe('scan bookkeeping and purity', () => {
  it('coalesces duplicate cells in first-encounter order and counts new cells against the pre-scan map', () => {
    const terrain = parseGroundTruth(['.....', '.....', '.....']);
    const current = scout(terrain, { x: 1, y: 1 }, 'east');
    (current.localMap.cells as CellState[])[6] = 'clear';
    const result = scanScout(terrain, current, 1);
    // Outer-left contributes through (3,0); inner-left then adds (4,0).
    // Inner-right encounters (2,2) before outer-right finally adds (1,2).
    const ordered = positions('1,1 2,1 1,0 2,0 3,0 4,0 3,1 4,1 2,2 3,2 4,2 1,2');
    expect(result.observations.map(observation => observation.position)).toEqual(ordered);
    expect(result.newlyDiscoveredPositions).toEqual(ordered.slice(1));
    expect(result).toMatchObject({ observedCellCount: 12, newCellCount: 11 });
    const cells = [...current.localMap.cells];
    for (const observation of result.observations) {
      cells[observation.position.y * terrain.width + observation.position.x] = observation.cell;
    }
    const repeated = scanScout(terrain, { ...current, localMap: { ...current.localMap, cells } }, 2);
    expect(repeated.observations.map(observation => observation.position)).toEqual(ordered);
    expect(repeated.newlyDiscoveredPositions).toEqual([]);
    expect(repeated.newCellCount).toBe(0);
    expect(repeated.observedCellCount).toBe(12);
  });

  it('preserves inputs, has no input aliases, strips extra position metadata, and returns deterministic JSON', () => {
    const terrain = parseGroundTruth(['.....', '.....', '.....']);
    const origin = { x: 1, y: 1, secret: terrain };
    const current = scout(terrain, origin, 'east');
    const before = JSON.stringify(current);
    const first = scanScout(terrain, current, 1);
    const second = scanScout(terrain, current, 1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(current)).toBe(before);
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(JSON.stringify(first)).not.toContain('ground-truth');
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    origin.x = 3;
    expect(first.origin).toEqual({ x: 1, y: 1 });
    expect(first.rays[0].cells[0]?.position).toEqual({ x: 1, y: 1 });
  });

  it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid completed tick %s', tick => {
    const terrain = parseGroundTruth(['...']);
    expect(() => scanScout(terrain, scout(terrain, { x: 0, y: 0 }, 'east'), tick)).toThrow(RangeError);
  });

  it.each([{ x: -1, y: 0 }, { x: 3, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }])(
    'rejects invalid or blocked origin $x,$y', origin => {
      const terrain = parseGroundTruth(['.#.']);
      expect(() => scanScout(terrain, scout(terrain, origin, 'east'), 1)).toThrow(RangeError);
    },
  );

  it('rejects an invalid heading instead of tracing an unintended direction', () => {
    const terrain = parseGroundTruth(['...']);
    const current = scout(terrain, { x: 0, y: 0 }, 'northeast' as ScoutState['heading']);
    expect(() => scanScout(terrain, current, 1)).toThrow(TypeError);
  });

  it('rejects mismatched dimensions and incomplete map storage', () => {
    const terrain = parseGroundTruth(['...', '...']);
    const current = scout(terrain, { x: 0, y: 0 }, 'east');
    expect(() => scanScout(terrain, { ...current, localMap: createUnknownMap({ width: 2, height: 3 }) }, 1)).toThrow(TypeError);
    expect(() => scanScout(terrain, { ...current, localMap: { ...current.localMap, cells: ['unknown'] } }, 1)).toThrow(TypeError);
    expect(() => scanScout({ ...terrain, cells: ['clear'] }, current, 1)).toThrow(TypeError);
  });
});
