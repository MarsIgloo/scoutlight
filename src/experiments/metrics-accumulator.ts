import { toIndex } from '../engine/grid';
import type {
  CommunicationState, GroundTruthGrid, KnowledgeMap, NodeId, Scenario, ScoutId,
  SimulationState, TerrainCell,
} from '../engine/types';
import { reachableSurveyIndices, type CoverageMetrics, type RunMetrics } from './metrics';

const SCOUT_IDS = ['scout-a', 'scout-b', 'scout-c'] as const;
const NODE_IDS: readonly NodeId[] = ['relay', ...SCOUT_IDS];
interface Fact {
  readonly sourceId: ScoutId;
  readonly index: number;
  readonly cell: TerrainCell;
  readonly discoveredAtTick: number;
}

/** External observer only. Neither the denominator nor these facts enter planning. */
export class RunMetricsAccumulator {
  private readonly grid: GroundTruthGrid;
  private readonly reachable: readonly number[];
  private readonly scenarioId: string;
  private readonly scenarioVersion: number;
  private readonly communicationRange: number;
  private readonly site: { readonly id: string; readonly x: number; readonly y: number };
  private readonly coverage: CoverageMetrics[] = [];
  private readonly connectedTicks: Record<ScoutId, number> = { 'scout-a': 0, 'scout-b': 0, 'scout-c': 0 };
  private readonly facts = new Map<string, Fact>();
  private readonly sourcesByCell = new Map<number, Set<ScoutId>>();
  private duplicateDiscoveries = 0;
  private timeTo90: number | null = null;

  constructor(scenario: Scenario, initial: SimulationState) {
    this.reachable = reachableSurveyIndices(scenario);
    if (!scenario.id.trim() || !Number.isSafeInteger(scenario.version) || scenario.version < 1 ||
      !Number.isSafeInteger(scenario.communicationRange) || scenario.communicationRange < 1) {
      throw new TypeError('Run metrics require a valid scenario configuration.');
    }
    const site = scenario.relaySites.find(site => site.id === initial.config.relaySiteId);
    if (!site || scenario.groundTruth.cells[toIndex(scenario.groundTruth, site.position)] !== 'clear') {
      throw new TypeError('The run must select a clear authored relay site.');
    }
    // Detach static evaluator context once, rather than retaining caller-owned terrain.
    this.grid = { ...scenario.groundTruth, cells: [...scenario.groundTruth.cells] };
    this.scenarioId = scenario.id;
    this.scenarioVersion = scenario.version;
    this.communicationRange = scenario.communicationRange;
    this.site = { id: site.id, ...site.position };
    this.append(initial);
  }

  append(snapshot: SimulationState): RunMetrics {
    return this.prepareAppend(snapshot)();
  }

  /** Validate without mutation, so a pair can prepare both ticks before committing either. */
  prepareAppend(snapshot: SimulationState): () => RunMetrics {
    const tick = this.coverage.length;
    if (snapshot.tick !== tick) throw new RangeError('A run must contain consecutive snapshots beginning at tick zero.');
    const config = snapshot.config;
    if (snapshot.schemaVersion !== 2 || config.rulesVersion !== 2 ||
      config.scenarioId !== this.scenarioId || config.scenarioVersion !== this.scenarioVersion ||
      config.communicationRange !== this.communicationRange || config.relaySiteId !== this.site.id) {
      throw new TypeError('All snapshots must share this scenario, relay site, and engine configuration.');
    }
    if (snapshot.scouts.length !== 3 || SCOUT_IDS.some((id, index) => snapshot.scouts[index]?.id !== id)) {
      throw new TypeError('Snapshots must contain all three scouts in canonical ID order.');
    }
    if (snapshot.relay.id !== 'relay' || snapshot.relay.position.x !== this.site.x ||
      snapshot.relay.position.y !== this.site.y ||
      snapshot.relay.connectivityEvaluatedAtTick !== (tick === 0 ? null : tick)) {
      throw new TypeError('Relay state must match its authored site and communication tick.');
    }
    const newFacts = new Map<string, Fact>();
    for (const node of [snapshot.relay, ...snapshot.scouts]) {
      this.validateMap(node.id === 'relay' ? node.sharedMap : node.localMap);
      this.validateCommunication(node.communication, tick);
      for (const record of node.discoveries) {
        if (!SCOUT_IDS.includes(record.sourceId)) throw new TypeError('A discovery needs a known source scout.');
        if (!Number.isSafeInteger(record.discoveredAtTick) || record.discoveredAtTick < 1 ||
          !Number.isSafeInteger(record.receivedAtTick) || record.receivedAtTick < record.discoveredAtTick ||
          record.receivedAtTick > tick) {
          throw new RangeError('Discovery and receipt timestamps must be ordered within the completed run.');
        }
        const index = toIndex(this.grid, record.position);
        if (record.cell !== this.grid.cells[index]) {
          throw new TypeError('Discovery states must agree with static ground truth.');
        }
        const key = `${record.sourceId}:${index}`;
        const previous = newFacts.get(key) ?? this.facts.get(key);
        if (previous && (previous.cell !== record.cell || previous.discoveredAtTick !== record.discoveredAtTick)) {
          throw new TypeError('Conflicting first-discovery facts for the same source and cell.');
        }
        if (!previous) newFacts.set(key, {
          sourceId: record.sourceId, index, cell: record.cell, discoveredAtTick: record.discoveredAtTick,
        });
      }
    }
    const connected = snapshot.scouts.filter(scout =>
      scout.communication.status === 'evaluated' && scout.communication.relayReachable).map(scout => scout.id);
    if (snapshot.relay.connectedScoutIds.length !== connected.length ||
      connected.some((id, index) => snapshot.relay.connectedScoutIds[index] !== id)) {
      throw new TypeError('Relay connected scouts must match the saved scout communication states.');
    }
    let fleetKnownCount = 0;
    let relayKnownCount = 0;
    for (const index of this.reachable) {
      if (snapshot.scouts.some(scout => scout.localMap.cells[index] === 'clear')) fleetKnownCount++;
      if (snapshot.relay.sharedMap.cells[index] === 'clear') relayKnownCount++;
    }
    const fleetCoverage = 100 * fleetKnownCount / this.reachable.length;
    const relayCoverage = 100 * relayKnownCount / this.reachable.length;
    const row: CoverageMetrics = { tick, fleetKnownCount, relayKnownCount, fleetCoverage, relayCoverage,
      communicationGap: fleetCoverage - relayCoverage };

    // Only detached values survive preparation. Invalid input cannot partially add facts or ticks.
    return () => {
      if (this.coverage.length !== tick) throw new Error('A prepared metrics append is stale.');
      for (const [key, fact] of newFacts) {
        this.facts.set(key, fact);
        const sources = this.sourcesByCell.get(fact.index) ?? new Set<ScoutId>();
        if (sources.size > 0) this.duplicateDiscoveries++;
        sources.add(fact.sourceId);
        this.sourcesByCell.set(fact.index, sources);
      }
      for (const id of connected) this.connectedTicks[id]++;
      this.coverage.push(row);
      if (this.timeTo90 === null && relayKnownCount * 10 >= this.reachable.length * 9) this.timeTo90 = tick;
      return this.getMetrics();
    };
  }

  /** Every publication owns its rows, arrays and counters, including tick zero. */
  getMetrics(): RunMetrics {
    const completedTicks = this.coverage.length - 1;
    const connectivityFraction: Record<ScoutId, number> = {
      'scout-a': completedTicks === 0 ? 0 : this.connectedTicks['scout-a'] / completedTicks,
      'scout-b': completedTicks === 0 ? 0 : this.connectedTicks['scout-b'] / completedTicks,
      'scout-c': completedTicks === 0 ? 0 : this.connectedTicks['scout-c'] / completedTicks,
    };
    return {
      reachableCellCount: this.reachable.length, completedTicks,
      coverage: this.coverage.map(row => ({ ...row })), timeTo90: this.timeTo90,
      duplicateDiscoveries: this.duplicateDiscoveries, connectedTicks: { ...this.connectedTicks },
      connectivityFraction,
      meanConnectivityFraction: SCOUT_IDS.reduce((sum, id) => sum + connectivityFraction[id], 0) / SCOUT_IDS.length,
    };
  }

  private validateMap(map: KnowledgeMap): void {
    if (map.kind !== 'knowledge' || map.width !== this.grid.width || map.height !== this.grid.height ||
      map.cells.length !== this.grid.cells.length) {
      throw new TypeError('Every knowledge map must match the scenario dimensions.');
    }
    for (let index = 0; index < map.cells.length; index++) {
      if (map.cells[index] !== 'unknown' && map.cells[index] !== this.grid.cells[index]) {
        throw new TypeError('Knowledge maps must contain unknown cells or truthful terrain.');
      }
    }
  }

  private validateCommunication(communication: CommunicationState, tick: number): void {
    if (tick === 0) {
      if (communication.status !== 'not-evaluated') throw new TypeError('Tick zero precedes communication evaluation.');
    } else if (communication.status !== 'evaluated' || communication.tick !== tick ||
      !NODE_IDS.includes(communication.componentId) || typeof communication.relayReachable !== 'boolean' ||
      communication.relayReachable !== (communication.componentId === 'relay')) {
      throw new TypeError('Completed ticks require matching communication evaluations.');
    }
  }
}
