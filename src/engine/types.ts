/** Grid origin is top-left; x increases right and y increases down. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface GridSize {
  readonly width: number;
  readonly height: number;
}

export type CellState = 'unknown' | 'clear' | 'blocked';
export type TerrainCell = Exclude<CellState, 'unknown'>;

/** Row-major: cells[y * width + x]. Terrain is never unknown. */
export interface GroundTruthGrid extends GridSize {
  readonly kind: 'ground-truth';
  readonly cells: readonly TerrainCell[];
}

/** Distinct from truth so a scout policy cannot accept terrain by mistake. */
export interface KnowledgeMap extends GridSize {
  readonly kind: 'knowledge';
  readonly cells: readonly CellState[];
}

export type Heading = 'north' | 'east' | 'south' | 'west';
/** Nonnegative integer. Tick 0 is the state before any simulation work. */
export type Tick = number;
export type ScoutId = 'scout-a' | 'scout-b' | 'scout-c';
export type RelaySiteId = 'site-a' | 'site-b' | 'site-c';
export type NodeId = ScoutId | 'relay';
export type Three<T> = readonly [T, T, T];

export interface ScoutSpawn {
  readonly id: ScoutId;
  readonly position: Position;
  readonly heading: Heading;
}

export interface RelaySite {
  readonly id: RelaySiteId;
  readonly position: Position;
}

/** Authored input; keep it separate from knowledge available to agents. */
export interface Scenario {
  readonly id: string;
  readonly version: number;
  readonly groundTruth: GroundTruthGrid;
  readonly communicationRange: number;
  readonly scouts: Three<ScoutSpawn>;
  readonly relaySites: Three<RelaySite>;
}

/** Identity is (scoutId, tick, position); duplicate rays coalesce in M1. */
export interface Observation {
  readonly scoutId: ScoutId;
  readonly tick: Tick;
  readonly position: Position;
  readonly cell: TerrainCell;
}

/** Stable identity: sourceId + cell position, independent of scan/arrival tick. */
export interface Discovery {
  readonly sourceId: ScoutId;
  readonly position: Position;
  readonly cell: TerrainCell;
  readonly discoveredAtTick: Tick;
}

/** Receipt time belongs to this node and must not be copied from a sender. */
export interface DiscoveryRecord extends Discovery {
  readonly receivedAtTick: Tick;
}

interface ClaimVersion {
  readonly ownerId: ScoutId;
  /** Increases for every claim or release issued by this owner. */
  readonly revision: number;
  readonly issuedAtTick: Tick;
}

export type FrontierClaim = ClaimVersion & (
  | {
      readonly status: 'active';
      readonly target: Position;
      /** Active only while currentTick < expiresAtTick. */
      readonly expiresAtTick: Tick;
    }
  | {
      readonly status: 'released';
      readonly target: null;
      readonly expiresAtTick: null;
    }
);

export interface ClaimState {
  /** First issued record will have revision 1, even after an empty start. */
  readonly lastIssuedRevision: number;
  /** Latest record per owner, ordered by ID; retain releases/expired records. */
  readonly knownClaims: readonly FrontierClaim[];
}

export type CommunicationState =
  | { readonly status: 'not-evaluated' }
  | {
      readonly status: 'evaluated';
      readonly tick: Tick;
      /** Direct neighbors, ordered by ID. */
      readonly peerIds: readonly NodeId[];
      /** Smallest node ID in the component, including isolated nodes. */
      readonly componentId: NodeId;
      readonly relayReachable: boolean;
    };

export interface CommunicationNode {
  readonly id: NodeId;
  readonly position: Position;
}

export interface NodeConnectivity {
  readonly nodeId: NodeId;
  readonly tick: Tick;
  readonly peerIds: readonly NodeId[];
  readonly componentId: NodeId;
  readonly relayReachable: boolean;
}

/** Integer quarter-cell coordinates; a cell center (x,y) is (4*x,4*y). */
export interface QuarterCellPoint {
  readonly x: number;
  readonly y: number;
}

export interface RayCell {
  readonly position: Position;
  readonly cell: TerrainCell;
}

export interface RayResult {
  /** 0 through 4, left to right relative to the scout's heading. */
  readonly index: number;
  readonly endpointOffset: Position;
  readonly cells: readonly RayCell[];
  readonly firstBlockedCell: Position | null;
  readonly termination: 'obstacle' | 'boundary' | 'maximum-range';
  /** Exact hit/boundary intersection, or the maximum-range endpoint. */
  readonly endPoint: QuarterCellPoint;
}

export interface SensorTelemetry {
  readonly tick: Tick;
  readonly scoutId: ScoutId;
  readonly origin: Position;
  readonly heading: Heading;
  readonly rays: readonly [RayResult, RayResult, RayResult, RayResult, RayResult];
  readonly newlyDiscoveredPositions: readonly Position[];
  readonly rayCount: number;
  /** Unique cells across the whole fan, including the origin. */
  readonly observedCellCount: number;
  readonly newCellCount: number;
  /** Rays stopped by obstacles; several rays may hit the same cell. */
  readonly blockedHitCount: number;
  readonly observations: readonly Observation[];
}

export type MovementIntent =
  | { readonly kind: 'stay' }
  | { readonly kind: 'move'; readonly direction: Heading };

export type ScoutIntents = Readonly<Record<ScoutId, MovementIntent>>;

export interface MovementResult {
  readonly tick: Tick;
  readonly scoutId: ScoutId;
  readonly origin: Position;
  readonly destination: Position;
  readonly attemptedDestination: Position | null;
  readonly headingBefore: Heading;
  readonly headingAfter: Heading;
  readonly intent: MovementIntent;
  readonly outcome: 'moved' | 'blocked' | 'boundary' | 'stayed';
}

export interface ScoutState {
  readonly id: ScoutId;
  readonly position: Position;
  readonly heading: Heading;
  readonly localMap: KnowledgeMap;
  readonly target: Position | null;
  readonly claims: ClaimState;
  readonly communication: CommunicationState;
  readonly sensorTelemetry: SensorTelemetry | null;
  readonly lastMovement: MovementResult | null;
  /** At most one first-discovery record per source scout and grid cell. */
  readonly discoveries: readonly DiscoveryRecord[];
}

export interface RelayState {
  readonly id: 'relay';
  readonly position: Position;
  readonly sharedMap: KnowledgeMap;
  readonly communication: CommunicationState;
  /** Null distinguishes an uncomputed connection list from an empty result. */
  readonly connectivityEvaluatedAtTick: Tick | null;
  /** Scouts reachable in the relay's connected component, ordered by ID. */
  readonly connectedScoutIds: readonly ScoutId[];
  readonly knownClaims: readonly FrontierClaim[];
  readonly discoveries: readonly DiscoveryRecord[];
}

export interface RunConfig {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly relaySiteId: RelaySiteId;
  readonly communicationRange: number;
  /** Increment when simulation rules change, independently of save format. */
  readonly rulesVersion: 2;
}

/** Plain JSON data. No terrain, clocks, renderer objects, Maps, or Sets. */
export interface SimulationState {
  readonly schemaVersion: 2;
  readonly config: RunConfig;
  readonly tick: Tick;
  /** Stable scout-a, scout-b, scout-c order, independent of authored order. */
  readonly scouts: Three<ScoutState>;
  readonly relay: RelayState;
}
