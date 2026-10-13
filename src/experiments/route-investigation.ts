import { parseGroundTruth } from '../engine/grid';
import type { Scenario } from '../engine/types';
import { CANDIDATE_SCENARIO } from './candidate';

/** Small mechanism fixture; the relay at (1,2) bridges A and B at tick one. */
export const RELAY_BRIDGE_FIXTURE: Scenario = {
  id: 'relay-bridge-fixture', version: 1, communicationRange: 1,
  groundTruth: parseGroundTruth([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ]),
  scouts: [
    { id: 'scout-a', position: { x: 2, y: 2 }, heading: 'east' },
    { id: 'scout-b', position: { x: 0, y: 2 }, heading: 'east' },
    { id: 'scout-c', position: { x: 6, y: 4 }, heading: 'west' },
  ],
  relaySites: [
    { id: 'site-a', position: { x: 6, y: 0 } },
    { id: 'site-b', position: { x: 1, y: 2 } },
    { id: 'site-c', position: { x: 5, y: 4 } },
  ],
};

/** Authored candidate variant: relay B bridges two west-room scouts at tick one. */
export const WEST_ROOM_BRIDGE_VARIANT: Scenario = {
  id: 'west-room-bridge-variant', version: 1, communicationRange: 1,
  groundTruth: CANDIDATE_SCENARIO.groundTruth,
  scouts: [
    { id: 'scout-a', position: { x: 4, y: 2 }, heading: 'east' },
    { id: 'scout-b', position: { x: 2, y: 2 }, heading: 'east' },
    { id: 'scout-c', position: { x: 22, y: 13 }, heading: 'west' },
  ],
  relaySites: [
    { id: 'site-a', position: { x: 12, y: 4 } },
    { id: 'site-b', position: { x: 3, y: 2 } },
    { id: 'site-c', position: { x: 20, y: 11 } },
  ],
};
