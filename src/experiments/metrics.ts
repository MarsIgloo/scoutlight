import { assertGridSize, isInBounds, toIndex } from '../engine/grid';
import type {
  CommunicationState, DiscoveryRecord, KnowledgeMap, NodeId, Scenario, ScoutId,
  SimulationState, TerrainCell,
} from '../engine/types';

const SCOUT_IDS = ['scout-a', 'scout-b', 'scout-c'] as const;
const NODE_IDS: readonly NodeId[] = ['relay', ...SCOUT_IDS];

export interface CoverageMetrics {
  readonly tick: number;
  readonly fleetKnownCount: number;
  readonly relayKnownCount: number;
  /** Coverage percentages, in [0, 100], with no presentation rounding. */
  readonly fleetCoverage: number;
  readonly relayCoverage: number;
  /** Percentage points of fleet knowledge not yet present at the relay. */
  readonly communicationGap: number;
}

export interface RunMetrics {
  readonly reachableCellCount: number;
  readonly completedTicks: number;
  readonly coverage: readonly CoverageMetrics[];
  readonly timeTo90: number | null;
  /** All observed terrain, including walls, deduplicated by source and cell. */
  readonly duplicateDiscoveries: number;
  readonly connectedTicks: Readonly<Record<ScoutId, number>>;
  readonly connectivityFraction: Readonly<Record<ScoutId, number>>;
  readonly meanConnectivityFraction: number;
}

/** External evaluator only: this ground-truth denominator never enters planning. */
export function reachableSurveyIndices(scenario: Scenario): readonly number[] {
  const grid = scenario.groundTruth;
  assertGridSize(grid);
  if (grid.kind !== 'ground-truth' || grid.cells.length !== grid.width * grid.height ||
    Array.from(grid.cells).some(cell => cell !== 'clear' && cell !== 'blocked')) {
    throw new TypeError('The survey denominator requires valid ground truth.');
  }
  if (scenario.scouts.length !== 3 || SCOUT_IDS.some(id =>
    scenario.scouts.filter(scout => scout.id === id).length !== 1)) {
    throw new TypeError('The survey denominator requires all three scout spawns.');
  }
  const reached = new Set<number>();
  const pending: number[] = [];
  for (const scout of scenario.scouts) {
    const index = toIndex(grid, scout.position);
    if (grid.cells[index] !== 'clear') throw new RangeError('Scout spawns must be clear.');
    if (!reached.has(index)) {
      reached.add(index);
      pending.push(index);
    }
  }
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const index = pending[cursor]!;
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    for (const position of [{ x, y: y - 1 }, { x: x + 1, y }, { x, y: y + 1 }, { x: x - 1, y }]) {
      if (!isInBounds(grid, position)) continue;
      const neighbor = toIndex(grid, position);
      if (grid.cells[neighbor] === 'clear' && !reached.has(neighbor)) {
        reached.add(neighbor);
        pending.push(neighbor);
      }
    }
  }
  if (reached.size === 0) throw new RangeError('The reachable survey area must not be empty.');
  return [...reached].sort((left, right) => left - right);
}

function validateMap(scenario: Scenario, map: KnowledgeMap): void {
  const grid = scenario.groundTruth;
  if (map.kind !== 'knowledge' || map.width !== grid.width || map.height !== grid.height ||
    map.cells.length !== grid.cells.length) {
    throw new TypeError('Every knowledge map must match the scenario dimensions.');
  }
  for (let index = 0; index < map.cells.length; index++) {
    const cell = map.cells[index];
    if (cell !== 'unknown' && cell !== grid.cells[index]) {
      throw new TypeError('Knowledge maps must contain unknown cells or truthful terrain.');
    }
  }
}

function validateCommunication(communication: CommunicationState, tick: number): void {
  if (tick === 0) {
    if (communication.status !== 'not-evaluated') {
      throw new TypeError('Tick zero precedes communication evaluation.');
    }
    return;
  }
  if (communication.status !== 'evaluated' || communication.tick !== tick ||
    !NODE_IDS.includes(communication.componentId) ||
    typeof communication.relayReachable !== 'boolean' ||
    communication.relayReachable !== (communication.componentId === 'relay')) {
    throw new TypeError('Completed ticks require matching communication evaluations.');
  }
}

/**
 * Evaluate a complete run prefix [tick 0, ..., tick N], without changing it.
 * Connectivity is the saved pre-movement graph. Tick zero is excluded from its
 * denominator; a zero-tick run reports zero fractions by explicit convention.
 */
export function evaluateRun(
  scenario: Scenario, snapshots: readonly SimulationState[],
): RunMetrics {
  const reachable = reachableSurveyIndices(scenario);
  const first = snapshots[0];
  if (!first) throw new RangeError('A run must include its tick-zero snapshot.');
  if (!scenario.id.trim() || !Number.isSafeInteger(scenario.version) || scenario.version < 1 ||
    !Number.isSafeInteger(scenario.communicationRange) || scenario.communicationRange < 1) {
    throw new TypeError('Run metrics require a valid scenario configuration.');
  }
  const relaySite = scenario.relaySites.find(site => site.id === first.config.relaySiteId);
  if (!relaySite || scenario.groundTruth.cells[toIndex(scenario.groundTruth, relaySite.position)] !== 'clear') {
    throw new TypeError('The run must select a clear authored relay site.');
  }
  const coverage: CoverageMetrics[] = [];
  const connectedTicks: Record<ScoutId, number> = { 'scout-a': 0, 'scout-b': 0, 'scout-c': 0 };
  const sourcesByCell = new Map<number, Set<ScoutId>>();
  const facts = new Map<string, { cell: TerrainCell; discoveredAtTick: number }>();
  let timeTo90: number | null = null;

  function collectDiscoveries(records: readonly DiscoveryRecord[], tick: number): void {
    for (const record of records) {
      if (!SCOUT_IDS.includes(record.sourceId)) throw new TypeError('A discovery needs a known source scout.');
      if (!Number.isSafeInteger(record.discoveredAtTick) || record.discoveredAtTick < 1 ||
        !Number.isSafeInteger(record.receivedAtTick) || record.receivedAtTick < record.discoveredAtTick ||
        record.receivedAtTick > tick) {
        throw new RangeError('Discovery and receipt timestamps must be ordered within the completed run.');
      }
      const index = toIndex(scenario.groundTruth, record.position);
      if (record.cell !== scenario.groundTruth.cells[index]) {
        throw new TypeError('Discovery states must agree with static ground truth.');
      }
      const key = `${record.sourceId}:${index}`;
      const previous = facts.get(key);
      if (previous && (previous.cell !== record.cell || previous.discoveredAtTick !== record.discoveredAtTick)) {
        throw new TypeError('Conflicting first-discovery facts for the same source and cell.');
      }
      facts.set(key, { cell: record.cell, discoveredAtTick: record.discoveredAtTick });
      const sources = sourcesByCell.get(index) ?? new Set<ScoutId>();
      sources.add(record.sourceId);
      sourcesByCell.set(index, sources);
    }
  }

  for (const [tick, snapshot] of snapshots.entries()) {
    if (snapshot.tick !== tick) throw new RangeError('A run must contain consecutive snapshots beginning at tick zero.');
    const config = snapshot.config;
    if (snapshot.schemaVersion !== 2 || config.rulesVersion !== 2 ||
      config.scenarioId !== scenario.id || config.scenarioVersion !== scenario.version ||
      config.communicationRange !== scenario.communicationRange || config.relaySiteId !== relaySite.id) {
      throw new TypeError('All snapshots must share this scenario, relay site, and engine configuration.');
    }
    if (snapshot.scouts.length !== 3 || SCOUT_IDS.some((id, index) => snapshot.scouts[index]?.id !== id)) {
      throw new TypeError('Snapshots must contain all three scouts in canonical ID order.');
    }
    if (snapshot.relay.id !== 'relay' || snapshot.relay.position.x !== relaySite.position.x ||
      snapshot.relay.position.y !== relaySite.position.y ||
      snapshot.relay.connectivityEvaluatedAtTick !== (tick === 0 ? null : tick)) {
      throw new TypeError('Relay state must match its authored site and communication tick.');
    }
    validateMap(scenario, snapshot.relay.sharedMap);
    validateCommunication(snapshot.relay.communication, tick);
    collectDiscoveries(snapshot.relay.discoveries, tick);
    const connected: ScoutId[] = [];
    for (const scout of snapshot.scouts) {
      validateMap(scenario, scout.localMap);
      validateCommunication(scout.communication, tick);
      collectDiscoveries(scout.discoveries, tick);
      if (scout.communication.status === 'evaluated' && scout.communication.relayReachable) {
        connectedTicks[scout.id]++;
        connected.push(scout.id);
      }
    }
    if (snapshot.relay.connectedScoutIds.length !== connected.length ||
      connected.some((id, index) => snapshot.relay.connectedScoutIds[index] !== id)) {
      throw new TypeError('Relay connected scouts must match the saved scout communication states.');
    }
    let fleetKnownCount = 0;
    let relayKnownCount = 0;
    for (const index of reachable) {
      if (snapshot.scouts.some(scout => scout.localMap.cells[index] === 'clear')) fleetKnownCount++;
      if (snapshot.relay.sharedMap.cells[index] === 'clear') relayKnownCount++;
    }
    const fleetCoverage = 100 * fleetKnownCount / reachable.length;
    const relayCoverage = 100 * relayKnownCount / reachable.length;
    coverage.push({
      tick, fleetKnownCount, relayKnownCount, fleetCoverage, relayCoverage,
      communicationGap: fleetCoverage - relayCoverage,
    });
    if (timeTo90 === null && relayKnownCount * 10 >= reachable.length * 9) timeTo90 = tick;
  }

  const completedTicks = snapshots.length - 1;
  const connectivityFraction: Record<ScoutId, number> = {
    'scout-a': completedTicks === 0 ? 0 : connectedTicks['scout-a'] / completedTicks,
    'scout-b': completedTicks === 0 ? 0 : connectedTicks['scout-b'] / completedTicks,
    'scout-c': completedTicks === 0 ? 0 : connectedTicks['scout-c'] / completedTicks,
  };
  return {
    reachableCellCount: reachable.length, completedTicks, coverage, timeTo90,
    duplicateDiscoveries: [...sourcesByCell.values()].reduce((sum, sources) => sum + sources.size - 1, 0),
    connectedTicks, connectivityFraction,
    meanConnectivityFraction: SCOUT_IDS.reduce((sum, id) => sum + connectivityFraction[id], 0) / SCOUT_IDS.length,
  };
}
