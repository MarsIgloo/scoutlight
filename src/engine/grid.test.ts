import { describe, expect, it } from 'vitest';
import {
  createUnknownMap, fromIndex, getCell, isInBounds, parseGroundTruth, toIndex,
} from './grid';
import type { CellState, TerrainCell } from './types';

describe('ground-truth representation', () => {
  it('parses a non-square grid in row-major order', () => {
    const grid = parseGroundTruth(['.#.', '##.']);
    expect(grid).toEqual({
      kind: 'ground-truth', width: 3, height: 2,
      cells: ['clear', 'blocked', 'clear', 'blocked', 'blocked', 'clear'],
    });
    expect(getCell(grid, { x: 1, y: 0 })).toBe('blocked');
    expect(getCell(grid, { x: 2, y: 1 })).toBe('clear');
  });

  it.each([
    { name: 'no rows', rows: [] },
    { name: 'empty row', rows: [''] },
    { name: 'ragged rows', rows: ['..', '.'] },
    { name: 'an unknown cell', rows: ['.?'] },
    { name: 'whitespace', rows: ['. '] },
    { name: 'an unsupported symbol', rows: ['.X'] },
  ])('rejects $name', ({ rows }) => {
    expect(() => parseGroundTruth(rows)).toThrow();
  });

  it('protects terrain at runtime and does not retain the input array', () => {
    const rows = ['.#'];
    const grid = parseGroundTruth(rows);
    rows[0] = '..';
    expect(grid.cells).toEqual(['clear', 'blocked']);
    expect(Object.isFrozen(grid)).toBe(true);
    expect(Object.isFrozen(grid.cells)).toBe(true);
    // Deliberately bypass readonly to verify runtime protection too.
    expect(() => { (grid.cells as TerrainCell[])[0] = 'blocked'; }).toThrow(TypeError);
    expect(() => { (grid as { width: number }).width = 99; }).toThrow(TypeError);
  });
});

describe('coordinates', () => {
  const size = { width: 3, height: 2 };

  it('uses x horizontally, y vertically, with no row wrapping', () => {
    expect(toIndex(size, { x: 0, y: 0 })).toBe(0);
    expect(toIndex(size, { x: 2, y: 0 })).toBe(2);
    expect(toIndex(size, { x: 0, y: 1 })).toBe(3);
    expect(fromIndex(size, 5)).toEqual({ x: 2, y: 1 });
    expect(() => toIndex(size, { x: 3, y: 0 })).toThrow(RangeError);
  });

  it.each([{ width: 1, height: 1 }, size, { width: 2, height: 5 }])(
    'round-trips every cell of a $width by $height grid', dimensions => {
      for (let index = 0; index < dimensions.width * dimensions.height; index++) {
        const position = fromIndex(dimensions, index);
        expect(isInBounds(dimensions, position)).toBe(true);
        expect(toIndex(dimensions, position)).toBe(index);
      }
    },
  );

  it.each([
    { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 3, y: 0 }, { x: 0, y: 2 },
    { x: 0.5, y: 0 }, { x: 0, y: 0.5 }, { x: NaN, y: 0 }, { x: 0, y: Infinity },
  ])('rejects invalid position $x, $y', position => {
    expect(isInBounds(size, position)).toBe(false);
    expect(() => toIndex(size, position)).toThrow(RangeError);
    expect(() => getCell(createUnknownMap(size), position)).toThrow(RangeError);
  });

  it.each([-1, 6, 1.5, NaN, Infinity])('rejects invalid index %s', index => {
    expect(() => fromIndex(size, index)).toThrow(RangeError);
  });

  it.each([
    { width: 0, height: 1 }, { width: 1, height: -1 },
    { width: 1.5, height: 2 }, { width: 1, height: NaN },
    { width: Infinity, height: 1 }, { width: Number.MAX_SAFE_INTEGER, height: 2 },
  ])('rejects invalid dimensions $width by $height', dimensions => {
    expect(() => createUnknownMap(dimensions)).toThrow(RangeError);
    expect(() => toIndex(dimensions, { x: 0, y: 0 })).toThrow(RangeError);
    expect(() => fromIndex(dimensions, 0)).toThrow(RangeError);
  });
});

describe('knowledge maps', () => {
  it('starts every cell unknown, including terrain boundaries and obstacles', () => {
    const terrain = parseGroundTruth(['###', '#.#']);
    const map = createUnknownMap(terrain);
    expect(map).toEqual({
      kind: 'knowledge', width: 3, height: 2,
      cells: ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'],
    });
  });

  it('allocates independent cell storage', () => {
    const first = createUnknownMap({ width: 2, height: 1 });
    const second = createUnknownMap(first);
    (first.cells as CellState[])[0] = 'clear';
    expect(second.cells).toEqual(['unknown', 'unknown']);
  });
});
