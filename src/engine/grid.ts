import type {
  CellState, GridSize, GroundTruthGrid, KnowledgeMap, Position, TerrainCell,
} from './types';

export function assertGridSize(size: GridSize): void {
  if (
    !Number.isSafeInteger(size.width) || size.width <= 0 ||
    !Number.isSafeInteger(size.height) || size.height <= 0 ||
    !Number.isSafeInteger(size.width * size.height)
  ) {
    throw new RangeError('Grid dimensions must be positive safe integers.');
  }
}

export function isInBounds(size: GridSize, position: Position): boolean {
  return Number.isSafeInteger(position.x) && Number.isSafeInteger(position.y) &&
    position.x >= 0 && position.x < size.width &&
    position.y >= 0 && position.y < size.height;
}

export function toIndex(size: GridSize, position: Position): number {
  assertGridSize(size);
  if (!isInBounds(size, position)) {
    throw new RangeError(`Invalid grid position (${position.x}, ${position.y}).`);
  }
  return position.y * size.width + position.x;
}

export function fromIndex(size: GridSize, index: number): Position {
  assertGridSize(size);
  if (!Number.isSafeInteger(index) || index < 0 || index >= size.width * size.height) {
    throw new RangeError(`Invalid grid index ${index}.`);
  }
  return { x: index % size.width, y: Math.floor(index / size.width) };
}

export function getCell<T extends CellState>(
  grid: GridSize & { readonly cells: readonly T[] },
  position: Position,
): T {
  const cell = grid.cells[toIndex(grid, position)];
  if (cell === undefined) {
    throw new RangeError('Grid storage does not contain this cell.');
  }
  return cell;
}

/** Strict authored format: '.' = clear, '#' = blocked; no implicit padding. */
export function parseGroundTruth(rows: readonly string[]): GroundTruthGrid {
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  assertGridSize({ width, height });
  const cells: TerrainCell[] = [];

  for (const [y, row] of rows.entries()) {
    if (row.length !== width) {
      throw new RangeError(`Row ${y} has width ${row.length}; expected ${width}.`);
    }
    for (const [x, symbol] of [...row].entries()) {
      if (symbol !== '.' && symbol !== '#') {
        throw new TypeError(`Invalid terrain symbol '${symbol}' at (${x}, ${y}).`);
      }
      cells.push(symbol === '.' ? 'clear' : 'blocked');
    }
  }

  return Object.freeze({
    kind: 'ground-truth', width, height, cells: Object.freeze(cells),
  });
}

/** Each call allocates independent storage, without reading any terrain. */
export function createUnknownMap(size: GridSize): KnowledgeMap {
  assertGridSize(size);
  return {
    kind: 'knowledge', width: size.width, height: size.height,
    cells: Array<CellState>(size.width * size.height).fill('unknown'),
  };
}
