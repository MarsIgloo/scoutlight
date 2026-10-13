import { assertGridSize, createUnknownMap, getCell } from './grid';
import type {
  Position, RelaySiteId, Scenario, ScoutId, ScoutState, SimulationState,
} from './types';

function validateScenario(scenario: Scenario): void {
  if (!Number.isSafeInteger(scenario.communicationRange) || scenario.communicationRange < 1) {
    throw new RangeError('Communication range must be a positive safe integer.');
  }
  if (!scenario.id.trim() || !Number.isSafeInteger(scenario.version) || scenario.version < 1) {
    throw new TypeError('Scenario needs an ID and a positive integer version.');
  }
  const grid = scenario.groundTruth;
  assertGridSize(grid);
  if (grid.kind !== 'ground-truth' || grid.cells.length !== grid.width * grid.height) {
    throw new TypeError('Scenario ground truth has an invalid representation.');
  }
  // Array.from also exposes holes in a malformed array as invalid cells.
  if (Array.from(grid.cells).some(cell => cell !== 'clear' && cell !== 'blocked')) {
    throw new TypeError('Ground truth can only contain clear or blocked cells.');
  }

  function requireClear(position: Position, label: string): void {
    if (getCell(grid, position) !== 'clear') {
      throw new RangeError(`${label} must be on a clear cell.`);
    }
  }

  const scoutIds: readonly ScoutId[] = ['scout-a', 'scout-b', 'scout-c'];
  if (scenario.scouts.length !== 3 || scoutIds.some(
    id => scenario.scouts.filter(scout => scout.id === id).length !== 1,
  )) {
    throw new TypeError('Scenario needs exactly scout-a, scout-b, and scout-c.');
  }
  for (const scout of scenario.scouts) {
    requireClear(scout.position, scout.id);
    if (!['north', 'east', 'south', 'west'].includes(scout.heading)) {
      throw new TypeError(`Invalid heading for ${scout.id}.`);
    }
  }
  const spawnCells = new Set(scenario.scouts.map(scout => `${scout.position.x},${scout.position.y}`));
  if (spawnCells.size !== 3) {
    throw new TypeError('Scouts must start on three different cells.');
  }

  const siteIds: readonly RelaySiteId[] = ['site-a', 'site-b', 'site-c'];
  if (scenario.relaySites.length !== 3 || siteIds.some(
    id => scenario.relaySites.filter(site => site.id === id).length !== 1,
  )) {
    throw new TypeError('Scenario needs exactly site-a, site-b, and site-c.');
  }
  for (const site of scenario.relaySites) requireClear(site.position, site.id);
  const uniqueSites = new Set(scenario.relaySites.map(site => `${site.position.x},${site.position.y}`));
  if (uniqueSites.size !== 3) {
    throw new TypeError('Relay sites must occupy three different cells.');
  }
  if (scenario.relaySites.some(site => spawnCells.has(`${site.position.x},${site.position.y}`))) {
    throw new TypeError('Relay sites must not overlap scout starting cells.');
  }
}

/** Creates tick zero only. No scan, connectivity, assignment, or movement. */
export function createInitialState(
  scenario: Scenario,
  relaySiteId: RelaySiteId,
): SimulationState {
  validateScenario(scenario);
  const relaySite = scenario.relaySites.find(site => site.id === relaySiteId);
  if (!relaySite) throw new TypeError(`Unknown relay site '${relaySiteId}'.`);

  // Knowledge is based solely on dimensions. Even starting cells await sensing.
  const size = { width: scenario.groundTruth.width, height: scenario.groundTruth.height };
  function createScout(id: ScoutId): ScoutState {
    const spawn = scenario.scouts.find(scout => scout.id === id);
    if (!spawn) throw new TypeError(`Missing scout '${id}'.`);
    return {
      id,
      position: { x: spawn.position.x, y: spawn.position.y },
      heading: spawn.heading,
      localMap: createUnknownMap(size),
      target: null,
      claims: { lastIssuedRevision: 0, knownClaims: [] },
      communication: { status: 'not-evaluated' },
      sensorTelemetry: null,
      lastMovement: null,
      discoveries: [],
    };
  }

  return {
    schemaVersion: 2,
    config: {
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      relaySiteId,
      communicationRange: scenario.communicationRange,
      rulesVersion: 2,
    },
    tick: 0,
    scouts: [createScout('scout-a'), createScout('scout-b'), createScout('scout-c')],
    relay: {
      id: 'relay',
      position: { x: relaySite.position.x, y: relaySite.position.y },
      sharedMap: createUnknownMap(size),
      communication: { status: 'not-evaluated' },
      connectivityEvaluatedAtTick: null,
      connectedScoutIds: [],
      knownClaims: [],
      discoveries: [],
    },
  };
}
