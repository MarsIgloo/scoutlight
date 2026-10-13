import { assertGridSize, getCell, isInBounds } from './grid';
import type {
  GroundTruthGrid, Heading, Observation, Position, QuarterCellPoint, RayCell,
  RayResult, ScoutState, SensorTelemetry, Tick,
} from './types';

type SensingScout = Pick<ScoutState, 'id' | 'position' | 'heading' | 'localMap'>;

/** Forward/right coordinates rotate clockwise in the screen's x/y system. */
function rotate(forward: number, right: number, heading: Heading): Position {
  switch (heading) {
    case 'north': return { x: right, y: 0 - forward };
    case 'east': return { x: forward, y: right };
    case 'south': return { x: 0 - right, y: forward };
    case 'west': return { x: 0 - forward, y: 0 - right };
    default: throw new TypeError('A scan requires a cardinal heading.');
  }
}

function validateScan(terrain: GroundTruthGrid, scout: SensingScout, tick: Tick): void {
  assertGridSize(terrain);
  assertGridSize(scout.localMap);
  if (terrain.kind !== 'ground-truth' || terrain.cells.length !== terrain.width * terrain.height) {
    throw new TypeError('A scan requires complete ground-truth storage.');
  }
  if (
    scout.localMap.kind !== 'knowledge' ||
    scout.localMap.width !== terrain.width || scout.localMap.height !== terrain.height ||
    scout.localMap.cells.length !== terrain.cells.length
  ) {
    throw new TypeError('The scout map must match the ground-truth dimensions.');
  }
  if (!Number.isSafeInteger(tick) || tick < 1) {
    throw new RangeError('Completed scans require a positive safe-integer tick.');
  }
  if (!['scout-a', 'scout-b', 'scout-c'].includes(scout.id)) {
    throw new TypeError('A scan requires a known scout ID.');
  }
  rotate(0, 0, scout.heading);
  if (!isInBounds(terrain, scout.position) || getCell(terrain, scout.position) !== 'clear') {
    throw new RangeError('A scan must start on a clear cell inside the grid.');
  }
}

/**
 * Integer supercover DDA in the scout's forward/right frame. Boundary times
 * are odd/(2*axisRange); cross-products compare these rationals exactly.
 * At a corner, visit forward-side, lateral-side, then diagonal, stopping at
 * the first obstacle/boundary even when that cell is only corner-touched.
 */
function traceRay(
  terrain: GroundTruthGrid, origin: Position, heading: Heading,
  index: number, lateralRange: number,
): RayResult {
  const forwardRange = 4;
  const absoluteLateralRange = Math.abs(lateralRange);
  const lateralSign = Math.sign(lateralRange);
  const endpointOffset = rotate(forwardRange, lateralRange, heading);
  const cells: RayCell[] = [{ position: { x: origin.x, y: origin.y }, cell: 'clear' }];
  let forward = 0;
  let lateralSteps = 0;

  // All possible intersections for slopes 0, 1/2 and 1 lie on quarter cells.
  function intersection(numerator: number, denominator: number): QuarterCellPoint {
    const offset = rotate(
      4 * forwardRange * numerator / denominator,
      4 * lateralRange * numerator / denominator,
      heading,
    );
    return { x: 4 * origin.x + offset.x, y: 4 * origin.y + offset.y };
  }

  function visit(
    nextForward: number, nextLateralSteps: number, numerator: number, denominator: number,
  ): RayResult | null {
    const offset = rotate(nextForward, nextLateralSteps * lateralSign, heading);
    const position = { x: origin.x + offset.x, y: origin.y + offset.y };
    if (!isInBounds(terrain, position)) {
      return {
        index, endpointOffset, cells, firstBlockedCell: null,
        termination: 'boundary', endPoint: intersection(numerator, denominator),
      };
    }
    const cell = getCell(terrain, position);
    if (cell !== 'clear' && cell !== 'blocked') {
      throw new TypeError('Ground truth can only contain clear or blocked cells.');
    }
    cells.push({ position, cell });
    if (cell === 'blocked') {
      return {
        index, endpointOffset, cells,
        firstBlockedCell: { x: position.x, y: position.y },
        termination: 'obstacle', endPoint: intersection(numerator, denominator),
      };
    }
    return null;
  }

  while (true) {
    const nextForwardNumerator = 2 * forward + 1;
    const nextLateralNumerator = 2 * lateralSteps + 1;
    const comparison = absoluteLateralRange === 0 ? -1 :
      nextForwardNumerator * absoluteLateralRange - nextLateralNumerator * forwardRange;

    if (comparison <= 0) {
      const denominator = 2 * forwardRange;
      if (nextForwardNumerator > denominator) break;
      const forwardHit = visit(forward + 1, lateralSteps, nextForwardNumerator, denominator);
      if (forwardHit) return forwardHit;
      if (comparison === 0) {
        const lateralHit = visit(forward, lateralSteps + 1, nextForwardNumerator, denominator);
        if (lateralHit) return lateralHit;
        const diagonalHit = visit(forward + 1, lateralSteps + 1, nextForwardNumerator, denominator);
        if (diagonalHit) return diagonalHit;
        lateralSteps++;
      }
      forward++;
    } else {
      const denominator = 2 * absoluteLateralRange;
      if (nextLateralNumerator > denominator) break;
      const lateralHit = visit(forward, lateralSteps + 1, nextLateralNumerator, denominator);
      if (lateralHit) return lateralHit;
      lateralSteps++;
    }
  }

  return {
    index, endpointOffset, cells, firstBlockedCell: null, termination: 'maximum-range',
    endPoint: { x: 4 * (origin.x + endpointOffset.x), y: 4 * (origin.y + endpointOffset.y) },
  };
}

/** Pure scan; the step function applies observations after all rays finish. */
export function scanScout(
  groundTruth: GroundTruthGrid, scout: SensingScout, tick: Tick,
): SensorTelemetry {
  validateScan(groundTruth, scout, tick);
  const rays = [
    traceRay(groundTruth, scout.position, scout.heading, 0, -4),
    traceRay(groundTruth, scout.position, scout.heading, 1, -2),
    traceRay(groundTruth, scout.position, scout.heading, 2, 0),
    traceRay(groundTruth, scout.position, scout.heading, 3, 2),
    traceRay(groundTruth, scout.position, scout.heading, 4, 4),
  ] as const;
  const observedIndices = new Set<number>();
  const observations: Observation[] = [];
  const newlyDiscoveredPositions: Position[] = [];
  for (const ray of rays) {
    for (const { position, cell } of ray.cells) {
      const index = position.y * groundTruth.width + position.x;
      if (observedIndices.has(index)) continue;
      observedIndices.add(index);
      observations.push({
        scoutId: scout.id, tick, position: { x: position.x, y: position.y }, cell,
      });
      if (scout.localMap.cells[index] === 'unknown') {
        newlyDiscoveredPositions.push({ x: position.x, y: position.y });
      }
    }
  }
  return {
    tick, scoutId: scout.id,
    origin: { x: scout.position.x, y: scout.position.y }, heading: scout.heading,
    rays, observations, newlyDiscoveredPositions,
    rayCount: rays.length, observedCellCount: observations.length,
    newCellCount: newlyDiscoveredPositions.length,
    blockedHitCount: rays.filter(ray => ray.termination === 'obstacle').length,
  };
}
