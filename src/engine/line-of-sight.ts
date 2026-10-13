import { assertGridSize, getCell, isInBounds } from './grid';
import type { GroundTruthGrid, Position } from './types';

/**
 * Center-to-center supercover traversal: any touched blocked cell occludes,
 * including either side cell at an exact corner. Clear endpoints are required.
 * Boundary times are odd/(2*axisDistance). BigInt cross-products compare them
 * exactly without overflowing the safe-integer coordinates accepted by grids.
 *
 * Sensing keeps its reviewed heading-relative visit order and quarter-cell hit
 * geometry. This utility shares its conservative corner rule, but supports
 * arbitrary segment slopes and only returns a symmetric visibility decision.
 */
export function hasLineOfSight(
  terrain: GroundTruthGrid, start: Position, end: Position,
): boolean {
  assertGridSize(terrain);
  if (terrain.kind !== 'ground-truth' || terrain.cells.length !== terrain.width * terrain.height) {
    throw new TypeError('Line of sight requires complete ground-truth storage.');
  }
  for (const endpoint of [start, end]) {
    if (!isInBounds(terrain, endpoint) || getCell(terrain, endpoint) !== 'clear') {
      throw new RangeError('Line-of-sight endpoints must be clear cells inside the grid.');
    }
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distanceX = BigInt(Math.abs(dx));
  const distanceY = BigInt(Math.abs(dy));
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let x = start.x;
  let y = start.y;
  let crossingsX = 0n;
  let crossingsY = 0n;

  function clear(nextX: number, nextY: number): boolean {
    const cell = getCell(terrain, { x: nextX, y: nextY });
    if (cell !== 'clear' && cell !== 'blocked') {
      throw new TypeError('Ground truth can only contain clear or blocked cells.');
    }
    return cell === 'clear';
  }

  while (x !== end.x || y !== end.y) {
    // Zero-distance axes have no crossing; avoid a special infinity sentinel.
    const comparison = distanceX === 0n ? 1n : distanceY === 0n ? -1n :
      (2n * crossingsX + 1n) * distanceY - (2n * crossingsY + 1n) * distanceX;
    if (comparison < 0n) {
      x += stepX;
      crossingsX++;
      if (!clear(x, y)) return false;
    } else if (comparison > 0n) {
      y += stepY;
      crossingsY++;
      if (!clear(x, y)) return false;
    } else {
      if (!clear(x + stepX, y) || !clear(x, y + stepY)) return false;
      x += stepX;
      y += stepY;
      crossingsX++;
      crossingsY++;
      if (!clear(x, y)) return false;
    }
  }
  return true;
}
