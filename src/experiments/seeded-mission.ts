import { parseGroundTruth } from '../engine/grid';
import type { Heading, Position, Scenario } from '../engine/types';

export const MISSION_GENERATOR_VERSION = 1;
export const DEFAULT_MISSION_SEED = 12345;
export const MAX_MISSION_SEED = 0xffff_ffff;

const WIDTH = 25;
const HEIGHT = 16;
const HEADINGS: readonly Heading[] = ['north', 'east', 'south', 'west'];

/** Unsigned 32-bit LCG: state = 1664525 * state + 1013904223 (mod 2^32). */
function randomFrom(seed: number): (limit: number) => number {
  let state = seed >>> 0;
  return limit => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

interface DoorSegment {
  readonly vertical: boolean;
  readonly fixed: number;
  readonly low: number;
  readonly high: number;
  readonly first: number;
}

/**
 * One 25×16 family: six variable-size rooms in a 3×2 arrangement. Every
 * neighboring pair has one door; at most one pair gains a second door.
 * This connected construction uses a fixed number of draws and no retries.
 */
export function generateSeededMission(seed: number): Scenario {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_MISSION_SEED) {
    throw new RangeError('Mission seed must be an unsigned 32-bit integer.');
  }
  const random = randomFrom(seed);
  const wallsX = [7 + random(3), 15 + random(3)] as const;
  const wallY = 7 + random(3);
  const rows = Array.from({ length: HEIGHT }, () => Array<string>(WIDTH).fill('#'));
  const carve = (position: Position) => { rows[position.y]![position.x] = '.'; };

  for (let y = 1; y < HEIGHT - 1; y++) {
    for (let x = 1; x < WIDTH - 1; x++) {
      if (x !== wallsX[0] && x !== wallsX[1] && y !== wallY) carve({ x, y });
    }
  }

  const xBounds = [[1, wallsX[0] - 1], [wallsX[0] + 1, wallsX[1] - 1], [wallsX[1] + 1, WIDTH - 2]] as const;
  const yBounds = [[1, wallY - 1], [wallY + 1, HEIGHT - 2]] as const;
  const segments: DoorSegment[] = [];
  for (const x of wallsX) {
    for (const [top, bottom] of yBounds) {
      const low = top + 1;
      const high = bottom - 1;
      const first = low + random(high - low + 1);
      segments.push({ vertical: true, fixed: x, low, high, first });
      carve({ x, y: first });
    }
  }
  for (const [left, right] of xBounds) {
    const low = left + 1;
    const high = right - 1;
    const first = low + random(high - low + 1);
    segments.push({ vertical: false, fixed: wallY, low, high, first });
    carve({ x: first, y: wallY });
  }
  if (random(2) === 1) {
    const segment = segments[random(segments.length)]!;
    const width = segment.high - segment.low + 1;
    const offset = 1 + random(width - 1);
    const second = segment.low + (segment.first - segment.low + offset) % width;
    carve(segment.vertical ? { x: segment.fixed, y: second } : { x: second, y: segment.fixed });
  }

  const place = (column: number, row: number): Position => {
    const [left, right] = xBounds[column]!;
    const [top, bottom] = yBounds[row]!;
    return { x: left + random(right - left + 1), y: top + random(bottom - top + 1) };
  };
  const heading = (): Heading => HEADINGS[random(HEADINGS.length)]!;
  return {
    id: `seeded-rooms-v${MISSION_GENERATOR_VERSION}-${seed}`,
    version: MISSION_GENERATOR_VERSION,
    communicationRange: 6,
    groundTruth: parseGroundTruth(rows.map(row => row.join(''))),
    scouts: [
      { id: 'scout-a', position: place(0, 0), heading: heading() },
      { id: 'scout-b', position: place(1, 1), heading: heading() },
      { id: 'scout-c', position: place(2, 0), heading: heading() },
    ],
    relaySites: [
      { id: 'site-a', position: place(1, 0) },
      { id: 'site-b', position: place(0, 1) },
      { id: 'site-c', position: place(2, 1) },
    ],
  };
}
