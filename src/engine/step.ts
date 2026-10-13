import { toIndex } from './grid';
import { computeConnectivity, NODE_ORDER } from './connectivity';
import { exchangeDiscoveries, type KnowledgeNode } from './exchange';
import { planBaseline, type PlannerView } from './frontier';
import { recordScanDiscoveries } from './knowledge';
import { assertMovementIntent, resolveMovement } from './movement';
import { scanScout } from './sensor';
import { cloneSnapshot } from './snapshot';
import type { Scenario, ScoutId, ScoutIntents, ScoutState, SimulationState } from './types';

/** One completed tick: scan, update local knowledge, exchange, then apply intents. */
export function stepSimulation(
  scenario: Scenario,
  state: SimulationState,
  intents: ScoutIntents,
): SimulationState {
  return stepInternal(scenario, state, { kind: 'explicit', intents });
}

/** Same physical tick; the baseline chooses only from each scout's exchanged knowledge. */
export function stepBaselineAutonomous(scenario: Scenario, state: SimulationState): SimulationState {
  return stepInternal(scenario, state, { kind: 'baseline' });
}

function stepInternal(
  scenario: Scenario,
  state: SimulationState,
  control: { readonly kind: 'explicit'; readonly intents: ScoutIntents } | { readonly kind: 'baseline' },
): SimulationState {
  if (
    state.config.scenarioId !== scenario.id || state.config.scenarioVersion !== scenario.version ||
    state.config.communicationRange !== scenario.communicationRange ||
    state.schemaVersion !== 2 || state.config.rulesVersion !== 2 ||
    !scenario.relaySites.some(site => site.id === state.config.relaySiteId)
  ) {
    throw new TypeError('Snapshot configuration does not match this scenario or engine version.');
  }
  if (!Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Cannot advance an invalid or exhausted tick counter.');
  }
  if (
    state.scouts.length !== 3 || state.scouts[0].id !== 'scout-a' ||
    state.scouts[1].id !== 'scout-b' || state.scouts[2].id !== 'scout-c'
  ) {
    throw new TypeError('Snapshots must contain the three scouts in canonical ID order.');
  }
  if (control.kind === 'explicit') {
    for (const scout of state.scouts) assertMovementIntent(control.intents?.[scout.id]);
  }

  // These tiny snapshots are fully copied, including unchanged relay/history data.
  // Even an accidental write to the returned state cannot corrupt an older run.
  const previous = cloneSnapshot(state);
  const tick = previous.tick + 1;
  const scans = previous.scouts.map(scout => scanScout(scenario.groundTruth, scout, tick));
  const sensed = previous.scouts.map((scout, index): ScoutState => {
    const telemetry = scans[index]!;
    const cells = [...scout.localMap.cells];
    for (const observation of telemetry.observations) {
      const index = toIndex(scout.localMap, observation.position);
      if (cells[index] !== 'unknown' && cells[index] !== observation.cell) {
        throw new TypeError('A scan conflicts with the scout\'s known map.');
      }
      cells[index] = observation.cell;
    }
    return {
      id: scout.id,
      position: { x: scout.position.x, y: scout.position.y },
      heading: scout.heading,
      localMap: { kind: 'knowledge', width: scout.localMap.width, height: scout.localMap.height, cells },
      target: scout.target ? { x: scout.target.x, y: scout.target.y } : null,
      claims: scout.claims,
      communication: scout.communication,
      sensorTelemetry: telemetry,
      lastMovement: scout.lastMovement,
      discoveries: recordScanDiscoveries(scout.localMap, scout.discoveries, telemetry.observations, scout.id, tick),
    };
  });

  const graph = computeConnectivity(scenario.groundTruth, [
    { id: 'relay', position: previous.relay.position },
    ...sensed.map(scout => ({ id: scout.id, position: scout.position })),
  ], scenario.communicationRange, tick);
  const exchanged = exchangeDiscoveries([
    { id: 'relay', map: previous.relay.sharedMap, discoveries: previous.relay.discoveries },
    ...sensed.map((scout): KnowledgeNode => ({
      id: scout.id, map: scout.localMap, discoveries: scout.discoveries,
    })),
  ], graph, tick);
  const exchangedById = new Map(exchanged.map(node => [node.id, node]));
  const graphById = new Map(graph.map(entry => [entry.nodeId, entry]));
  const communicationOf = (id: typeof NODE_ORDER[number]) => {
    const entry = graphById.get(id);
    if (!entry) throw new Error(`Missing connectivity entry for ${id}.`);
    return {
      status: 'evaluated' as const,
      tick: entry.tick,
      peerIds: [...entry.peerIds],
      componentId: entry.componentId,
      relayReachable: entry.relayReachable,
    };
  };
  const communicated = sensed.map((scout): ScoutState => {
    const node = exchangedById.get(scout.id);
    if (!node) throw new Error(`Missing exchanged knowledge for ${scout.id}.`);
    return {
      id: scout.id,
      position: { x: scout.position.x, y: scout.position.y },
      heading: scout.heading,
      localMap: node.map,
      target: scout.target ? { x: scout.target.x, y: scout.target.y } : null,
      claims: scout.claims,
      communication: communicationOf(scout.id),
      sensorTelemetry: scout.sensorTelemetry,
      lastMovement: scout.lastMovement,
      discoveries: node.discoveries,
    };
  });
  const relayGraph = graphById.get('relay');
  const relayKnowledge = exchangedById.get('relay');
  if (!relayGraph || !relayKnowledge) throw new Error('Missing exchanged relay state.');
  const relayComponentScouts: ScoutId[] = NODE_ORDER.filter(id =>
    graphById.get(id)?.componentId === relayGraph.componentId,
  ).filter((id): id is ScoutId => id !== 'relay');
  const relay = {
    id: 'relay' as const,
    position: { x: previous.relay.position.x, y: previous.relay.position.y },
    sharedMap: relayKnowledge.map,
    communication: communicationOf('relay'),
    connectivityEvaluatedAtTick: tick,
    connectedScoutIds: relayComponentScouts,
    knownClaims: previous.relay.knownClaims,
    discoveries: relayKnowledge.discoveries,
  };

  // All choices are made before any physical movement. This view is the planner's
  // complete information boundary: no scenario, relay state, telemetry, or other scout.
  const decisions = communicated.map(scout => {
    if (control.kind === 'explicit') return { target: scout.target, intent: control.intents[scout.id] };
    const view: PlannerView = {
      id: scout.id, position: scout.position, heading: scout.heading,
      localMap: scout.localMap, target: scout.target, tick, communication: scout.communication,
    };
    return planBaseline(view);
  });
  const moved = communicated.map((scout, index): ScoutState => {
    const decision = decisions[index]!;
    const movement = resolveMovement(scenario.groundTruth, scout, decision.intent, tick);
    return {
      ...scout,
      target: decision.target ? { x: decision.target.x, y: decision.target.y } : null,
      position: { x: movement.destination.x, y: movement.destination.y },
      heading: movement.headingAfter,
      lastMovement: movement,
    };
  });
  return {
    schemaVersion: 2,
    config: {
      scenarioId: previous.config.scenarioId,
      scenarioVersion: previous.config.scenarioVersion,
      relaySiteId: previous.config.relaySiteId,
      communicationRange: previous.config.communicationRange,
      rulesVersion: 2,
    },
    tick,
    scouts: [moved[0]!, moved[1]!, moved[2]!],
    relay,
  };
}
