import { parseGroundTruth } from '../engine/grid';
import type { Scenario } from '../engine/types';

/** One authored candidate: three vertical branches, rooms, and cross-corridors. */
export const CANDIDATE_SCENARIO: Scenario = {
  id: 'three-branches-candidate', version: 1, communicationRange: 6,
  groundTruth: parseGroundTruth([
    '#########################',
    '#.......#.......#.......#',
    '#.......#.......#.......#',
    '#.......#.......#.......#',
    '#.......................#',
    '####.#######.#######.####',
    '#.......#.......#.......#',
    '#.......#.......#.......#',
    '#.......................#',
    '#.......#.......#.......#',
    '####.#######.#######.####',
    '#.......................#',
    '#.......#.......#.......#',
    '#.......#.......#.......#',
    '#.......#.......#.......#',
    '#########################',
  ]),
  scouts: [
    { id: 'scout-a', position: { x: 2, y: 2 }, heading: 'east' },
    { id: 'scout-b', position: { x: 12, y: 7 }, heading: 'north' },
    { id: 'scout-c', position: { x: 22, y: 13 }, heading: 'west' },
  ],
  relaySites: [
    { id: 'site-a', position: { x: 12, y: 4 } },
    { id: 'site-b', position: { x: 4, y: 8 } },
    { id: 'site-c', position: { x: 20, y: 11 } },
  ],
};

export const RELAY_RATIONALE = {
  'site-a': 'North-central junction: watches the upper cross-corridor and central doorway.',
  'site-b': 'Western junction: covers the west branch and middle cross-corridor.',
  'site-c': 'Southeastern junction: covers the lower cross-corridor and east branch doorway.',
} as const;
