import { WEST_ROOM_BRIDGE_VARIANT } from '../experiments/route-investigation';
import { generateSeededMission, MISSION_GENERATOR_VERSION } from '../experiments/seeded-mission';
import { parseMissionRequest, type MissionEntry } from './mission-url';

const WEST_ROOM_RELAY_RATIONALE = {
  'site-a': 'Central cross-corridor at (12,4), outside the opening west-room range-one links.',
  'site-b': 'West room at (3,2): links Scouts A and B so they exchange scans before their first move.',
  'site-c': 'Southeast at (20,11), outside the opening west-room range-one links.',
} as const;

/** Public missions work in either build; authored reviews remain development-only. */
export function selectAppScenario(search: string, development: boolean) {
  const query = new URLSearchParams(search);
  const previewAlias = query.get('preview') === 'release';
  const compareAB = query.get('compare') === 'ab';
  if (development && !previewAlias && query.get('review') === 'west-room') {
    return {
      scenario: WEST_ROOM_BRIDGE_VARIANT,
      reviewLabel: 'West-room review',
      mission: null,
      missionEntry: 'review' as const,
      compareAB,
      relayRationale: WEST_ROOM_RELAY_RATIONALE,
      help: 'In this review, Relay B bridges the two west-room scouts at the opening scan. Scout A first moves north with B and west with A; their later routes can separate. All sites reach 100% explored by tick 160. This tests route sensitivity, not improved exploration.',
    };
  }
  const missionEntry: MissionEntry = development && !previewAlias && query.get('review') === 'missions'
    ? 'review' : 'public';
  const mission = parseMissionRequest(search, missionEntry);
  return {
    scenario: generateSeededMission(mission.seed),
    reviewLabel: `Mission v${MISSION_GENERATOR_VERSION} · seed ${mission.seed}${mission.usedDefault ? ' (invalid link; using default)' : ''}`,
    relayRationale: {
      'site-a': 'Upper middle room in this generated mission.',
      'site-b': 'Lower west room in this generated mission.',
      'site-c': 'Lower east room in this generated mission.',
    },
    help: `This seeded mission uses a connected rooms-and-passages map. Relay ${compareAB ? 'A/B are compared at the same tick' : 'A/B/C change only the relay position'} within the current map; Reset replays it. New map loads a different seed. Scouts still discover terrain only through sensing and communication. Routes, coverage, and delivery can vary by mission and are not guaranteed to improve with a particular relay.`,
    mission,
    missionEntry,
    compareAB,
  };
}
