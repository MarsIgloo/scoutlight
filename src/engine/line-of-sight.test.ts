import { describe, expect, it } from 'vitest';
import { parseGroundTruth } from './grid';
import { hasLineOfSight } from './line-of-sight';
import type { GroundTruthGrid, Position, TerrainCell } from './types';

function gridWithWall(position: Position): GroundTruthGrid {
  const rows = Array<string>(9).fill('.........');
  rows[position.y] = '.'.repeat(position.x) + '#' + '.'.repeat(8 - position.x);
  return parseGroundTruth(rows);
}

describe('center-to-center line of sight', () => {
  const open = parseGroundTruth(Array<string>(9).fill('.........'));
  const start = { x: 1, y: 1 };

  it.each([
    { x: 1, y: 1 }, { x: 8, y: 1 }, { x: 1, y: 8 }, { x: 8, y: 8 },
    { x: 7, y: 3 }, { x: 3, y: 7 }, { x: 8, y: 4 }, { x: 4, y: 8 },
  ])('connects clear endpoints at $x,$y in both directions', end => {
    expect(hasLineOfSight(open, start, end)).toBe(true);
    expect(hasLineOfSight(open, end, start)).toBe(true);
  });

  it.each([
    { start: { x: 0, y: 4 }, end: { x: 8, y: 4 }, wall: { x: 4, y: 4 } },
    { start: { x: 4, y: 0 }, end: { x: 4, y: 8 }, wall: { x: 4, y: 4 } },
    { start: { x: 1, y: 7 }, end: { x: 7, y: 1 }, wall: { x: 4, y: 4 } },
    { start: { x: 1, y: 1 }, end: { x: 7, y: 3 }, wall: { x: 4, y: 2 } },
    { start: { x: 1, y: 1 }, end: { x: 3, y: 7 }, wall: { x: 2, y: 4 } },
  ])('blocks a wall crossing from $start to $end in both directions', ({ start: from, end, wall }) => {
    const terrain = gridWithWall(wall);
    expect(hasLineOfSight(terrain, from, end)).toBe(false);
    expect(hasLineOfSight(terrain, end, from)).toBe(false);
  });

  it.each([
    { end: { x: 3, y: 3 }, wall: { x: 2, y: 1 } },
    { end: { x: 3, y: 3 }, wall: { x: 1, y: 2 } },
    // Slope 1/3 crosses the corner (2.5, 1.5), touching both side cells.
    { end: { x: 7, y: 3 }, wall: { x: 3, y: 1 } },
    { end: { x: 7, y: 3 }, wall: { x: 2, y: 2 } },
    // The transposed slope 3 crosses the corner (1.5, 2.5).
    { end: { x: 3, y: 7 }, wall: { x: 1, y: 3 } },
    { end: { x: 3, y: 7 }, wall: { x: 2, y: 2 } },
  ])('blocks either corner-side cell $wall on the line to $end', ({ end, wall }) => {
    const terrain = gridWithWall(wall);
    expect(hasLineOfSight(terrain, start, end)).toBe(false);
    expect(hasLineOfSight(terrain, end, start)).toBe(false);
  });

  it('does not block cells adjacent to but untouched by a shallow segment', () => {
    // (1,1) -> (7,3) touches (3,1), but never (4,1) or (1,2).
    for (const wall of [{ x: 4, y: 1 }, { x: 1, y: 2 }]) {
      const terrain = gridWithWall(wall);
      expect(hasLineOfSight(terrain, start, { x: 7, y: 3 })).toBe(true);
      expect(hasLineOfSight(terrain, { x: 7, y: 3 }, start)).toBe(true);
    }
  });

  it('is symmetric across every clear endpoint pair around a corner obstacle', () => {
    const terrain = parseGroundTruth(['....', '.#..', '....', '....']);
    const positions: Position[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (x !== 1 || y !== 1) positions.push({ x, y });
      }
    }
    for (const from of positions) {
      for (const end of positions) {
        expect(hasLineOfSight(terrain, from, end)).toBe(hasLineOfSight(terrain, end, from));
      }
    }
  });

  it('requires clear endpoints even for a zero-length segment', () => {
    const terrain = parseGroundTruth(['.#.']);
    expect(hasLineOfSight(terrain, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(() => hasLineOfSight(terrain, { x: 1, y: 0 }, { x: 1, y: 0 })).toThrow(RangeError);
    expect(() => hasLineOfSight(terrain, { x: 0, y: 0 }, { x: 1, y: 0 })).toThrow(RangeError);
    expect(() => hasLineOfSight(terrain, { x: 1, y: 0 }, { x: 2, y: 0 })).toThrow(RangeError);
  });

  it.each([
    { x: -1, y: 0 }, { x: 9, y: 0 }, { x: 0.5, y: 0 },
    { x: 0, y: Infinity }, { x: NaN, y: 0 }, { x: Number.MAX_SAFE_INTEGER + 1, y: 0 },
  ])('rejects invalid endpoint $x,$y', position => {
    expect(() => hasLineOfSight(open, start, position)).toThrow(RangeError);
    expect(() => hasLineOfSight(open, position, start)).toThrow(RangeError);
  });

  it('rejects incomplete terrain and invalid encountered cell states', () => {
    expect(() => hasLineOfSight({ ...open, cells: ['clear'] }, start, start)).toThrow(TypeError);
    const invalid = {
      kind: 'ground-truth' as const, width: 3, height: 1,
      cells: ['clear', 'unknown', 'clear'] as unknown as TerrainCell[],
    };
    expect(() => hasLineOfSight(invalid, { x: 0, y: 0 }, { x: 2, y: 0 })).toThrow(TypeError);
  });

  it('preserves the frozen terrain and endpoint inputs', () => {
    const from = Object.freeze({ x: 1, y: 1 });
    const end = Object.freeze({ x: 7, y: 3 });
    const before = JSON.stringify({ open, from, end });
    hasLineOfSight(open, from, end);
    expect(JSON.stringify({ open, from, end })).toBe(before);
  });
});
