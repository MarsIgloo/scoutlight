import { parseGroundTruth } from './grid';
import type { Scenario } from './types';

/** A correctness fixture, not a validated relay-comparison level. */
export const TEST_SCENARIO: Scenario = {
  id: 'm0-test-grid',
  version: 1,
  communicationRange: 1,
  groundTruth: parseGroundTruth([
    '#########',
    '#.......#',
    '#..#....#',
    '#..#.#..#',
    '#....#..#',
    '#.......#',
    '#########',
  ]),
  scouts: [
    { id: 'scout-a', position: { x: 1, y: 1 }, heading: 'east' },
    { id: 'scout-b', position: { x: 1, y: 3 }, heading: 'east' },
    { id: 'scout-c', position: { x: 1, y: 5 }, heading: 'east' },
  ],
  relaySites: [
    { id: 'site-a', position: { x: 2, y: 1 } },
    { id: 'site-b', position: { x: 4, y: 3 } },
    { id: 'site-c', position: { x: 7, y: 5 } },
  ],
};
