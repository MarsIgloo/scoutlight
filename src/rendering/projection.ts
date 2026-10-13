import type {
  CellState, Heading, KnowledgeMap, NodeId, Position, RayResult, ScoutId, SimulationState,
} from '../engine/types';

export const SCOUT_IDS = ['scout-a', 'scout-b', 'scout-c'] as const;
export const SCOUT_COLORS: Record<ScoutId, number> = {
  'scout-a': 0x55dce8, 'scout-b': 0xf0bb67, 'scout-c': 0xd996ec,
};
export type KnowledgeView = 'fleet' | 'relay' | 'scout';
export interface ViewOptions {
  readonly knowledge: KnowledgeView;
  readonly selected: ScoutId;
  readonly trails: boolean;
  readonly rays: boolean;
  readonly links: boolean;
}
export interface VisualRay {
  readonly index: number;
  readonly origin: Position;
  readonly end: Position;
  readonly termination: RayResult['termination'];
  readonly scoutId: ScoutId;
}
export interface VisualEdge {
  readonly ids: readonly [NodeId, NodeId];
  readonly from: Position;
  readonly to: Position;
  readonly relayReachable: boolean;
}
export interface SceneProjection {
  readonly tick: number;
  readonly map: KnowledgeMap;
  readonly scouts: readonly {
    id: ScoutId; position: Position; heading: Heading; offset: Position;
    selected: boolean; trail: readonly Position[];
  }[];
  readonly relay: { position: Position; label: string };
  readonly rays: readonly VisualRay[];
  readonly edges: readonly VisualEdge[];
  readonly highlights: readonly { position: Position; color: number }[];
  readonly target: Position | null;
}
const copyPosition = (position: Position): Position => ({ x: position.x, y: position.y });

/** This module cannot accept a Scenario or GroundTruthGrid. Copy only known cells. */
export function knowledgeFor(state: SimulationState, view: KnowledgeView, selected: ScoutId): KnowledgeMap {
  const source = view === 'relay' ? state.relay.sharedMap : state.scouts.find(s => s.id === selected)!.localMap;
  const cells: CellState[] = view === 'fleet'
    ? source.cells.map((_, index) => state.scouts.find(s => s.localMap.cells[index] !== 'unknown')?.localMap.cells[index] ?? 'unknown')
    : [...source.cells];
  return { kind: 'knowledge', width: source.width, height: source.height, cells };
}

export function communicationEdges(state: SimulationState): VisualEdge[] {
  const nodes = [state.relay, ...state.scouts];
  const edges: VisualEdge[] = [];
  const seen = new Set<string>();
  const origin = (id: NodeId): Position => {
    if (id === 'relay') return copyPosition(state.relay.position);
    const scan = state.scouts.find(s => s.id === id)!.sensorTelemetry;
    if (!scan || scan.tick !== state.tick) throw new Error('Evaluated links require their recorded scan origin.');
    return copyPosition(scan.origin);
  };
  for (const node of nodes) {
    if (node.communication.status !== 'evaluated') continue;
    for (const peer of node.communication.peerIds) {
      const pair = [node.id, peer].sort() as [NodeId, NodeId];
      const key = pair.join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ ids: pair, from: origin(pair[0]), to: origin(pair[1]),
        relayReachable: node.communication.relayReachable });
    }
  }
  return edges;
}

/** History is presentation input only. The runner gives a fresh sequence on reset. */
export function projectScene(state: SimulationState, history: readonly SimulationState[], options: ViewOptions): SceneProjection {
  const map = knowledgeFor(state, options.knowledge, options.selected);
  const previous = history.length > 1 ? knowledgeFor(history.at(-2)!, options.knowledge, options.selected) : null;
  const highlights: { position: Position; color: number }[] = [];
  for (let index = 0; index < map.cells.length; index++) {
    if (map.cells[index] === 'unknown' || !previous || previous.cells[index] !== 'unknown') continue;
    const position = { x: index % map.width, y: Math.floor(index / map.width) };
    const source = state.scouts.find(s => s.sensorTelemetry?.newlyDiscoveredPositions.some(p => p.x === position.x && p.y === position.y));
    highlights.push({ position, color: source ? SCOUT_COLORS[source.id] : 0xb7c8d9 });
  }
  const rays: VisualRay[] = options.rays ? state.scouts.flatMap(scout =>
    scout.sensorTelemetry?.rays.map(ray => ({ index: ray.index, scoutId: scout.id,
      origin: copyPosition(scout.sensorTelemetry!.origin),
      end: { x: ray.endPoint.x / 4, y: ray.endPoint.y / 4 }, termination: ray.termination })) ?? []) : [];
  return {
    tick: state.tick, map, rays, highlights,
    edges: options.links ? communicationEdges(state) : [],
    relay: { position: copyPosition(state.relay.position), label: state.config.relaySiteId.slice(-1).toUpperCase() },
    target: state.scouts.find(s => s.id === options.selected)!.target,
    scouts: state.scouts.map(scout => {
      const group = state.scouts.filter(s => s.position.x === scout.position.x && s.position.y === scout.position.y);
      const angle = group.findIndex(s => s.id === scout.id) * Math.PI * 2 / group.length - Math.PI / 2;
      const offset = group.length === 1 ? { x: 0, y: 0 } : { x: Math.cos(angle) * .39, y: Math.sin(angle) * .39 };
      return { id: scout.id, position: copyPosition(scout.position), heading: scout.heading, offset,
        selected: scout.id === options.selected,
        trail: options.trails ? history.slice(-40).map(snapshot => copyPosition(snapshot.scouts.find(s => s.id === scout.id)!.position)) : [] };
    }),
  };
}

export const positionLabel = (position: Position | null): string => position ? `${position.x}, ${position.y}` : 'None';
export const nodeLabel = (id: NodeId): string => id === 'relay' ? 'Relay' : `Scout ${id.slice(-1).toUpperCase()}`;

export function projectInspector(state: SimulationState, selected: ScoutId) {
  const scout = state.scouts.find(s => s.id === selected)!;
  const communication = scout.communication;
  const scan = scout.sensorTelemetry;
  const movement = scout.lastMovement;
  return {
    name: nodeLabel(selected), color: SCOUT_COLORS[selected], tick: state.tick,
    position: positionLabel(scout.position), heading: scout.heading, target: positionLabel(scout.target),
    peers: communication.status === 'evaluated' ? communication.peerIds.map(nodeLabel).join(', ') || 'None' : 'Not evaluated',
    relayReachable: communication.status === 'evaluated' ? communication.relayReachable ? 'Yes' : 'No' : 'Not evaluated',
    component: communication.status === 'evaluated' ? nodeLabel(communication.componentId) : 'Not evaluated',
    scan: scan ? { rays: scan.rayCount, observed: scan.observedCellCount, new: scan.newCellCount, blocked: scan.blockedHitCount,
      origin: positionLabel(scan.origin) } : null,
    movement: movement ? { intent: movement.intent.kind === 'move' ? `Move ${movement.intent.direction}` : 'Stay',
      outcome: movement.outcome, attempted: positionLabel(movement.attemptedDestination), actual: positionLabel(movement.destination) } : null,
  };
}
