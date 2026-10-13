import { assertGridSize, toIndex } from './grid';
import type {
  Discovery, DiscoveryRecord, GridSize, KnowledgeMap, Observation, ScoutId,
  TerrainCell, Tick,
} from './types';

const SOURCE_ORDER: readonly ScoutId[] = ['scout-a', 'scout-b', 'scout-c'];

function assertPositiveTick(tick: Tick): void {
  if (!Number.isSafeInteger(tick) || tick < 1) {
    throw new RangeError('Discovery timestamps must be positive safe integers.');
  }
}

function assertSource(sourceId: ScoutId): void {
  if (!SOURCE_ORDER.includes(sourceId)) {
    throw new TypeError('A discovery requires a known source scout ID.');
  }
}

function validateDiscovery(size: GridSize, discovery: Discovery, currentTick: Tick): number {
  assertSource(discovery.sourceId);
  assertPositiveTick(discovery.discoveredAtTick);
  if (discovery.discoveredAtTick > currentTick) {
    throw new RangeError('A discovery cannot arrive before its source discovered it.');
  }
  if (discovery.cell !== 'clear' && discovery.cell !== 'blocked') {
    throw new TypeError('Discoveries must describe clear or blocked cells.');
  }
  return toIndex(size, discovery.position);
}

function identity(sourceId: ScoutId, index: number): string {
  return `${sourceId}:${index}`;
}

/**
 * Source facts are immutable. Receipt time is local to this recipient, so an
 * incoming record's receivedAtTick is intentionally ignored. There is at most
 * one output record per source/cell, ordered by source then row-major position.
 */
export function mergeDiscoveries(
  size: GridSize,
  existing: readonly DiscoveryRecord[],
  incoming: readonly Discovery[],
  receivedAtTick: Tick,
): readonly DiscoveryRecord[] {
  assertGridSize(size);
  assertPositiveTick(receivedAtTick);
  const records = new Map<string, DiscoveryRecord>();
  const observedCells = new Map<number, TerrainCell>();

  function add(discovery: Discovery, receipt: Tick): void {
    const index = validateDiscovery(size, discovery, receivedAtTick);
    assertPositiveTick(receipt);
    if (receipt < discovery.discoveredAtTick || receipt > receivedAtTick) {
      throw new RangeError('Receipt ticks must be between discovery and the current tick.');
    }
    const knownCell = observedCells.get(index);
    if (knownCell !== undefined && knownCell !== discovery.cell) {
      throw new TypeError('Conflicting discovery states for static terrain.');
    }
    observedCells.set(index, discovery.cell);
    const key = identity(discovery.sourceId, index);
    const previous = records.get(key);
    if (previous && previous.discoveredAtTick !== discovery.discoveredAtTick) {
      throw new TypeError('Conflicting first-discovery ticks for the same source and cell.');
    }
    records.set(key, {
      sourceId: discovery.sourceId,
      position: { x: discovery.position.x, y: discovery.position.y },
      cell: discovery.cell,
      discoveredAtTick: discovery.discoveredAtTick,
      receivedAtTick: previous ? Math.min(previous.receivedAtTick, receipt) : receipt,
    });
  }

  for (const record of existing) add(record, record.receivedAtTick);
  for (const discovery of incoming) add(discovery, receivedAtTick);
  return [...records.values()].sort((left, right) =>
    SOURCE_ORDER.indexOf(left.sourceId) - SOURCE_ORDER.indexOf(right.sourceId) ||
    toIndex(size, left.position) - toIndex(size, right.position),
  );
}

/**
 * Current scan observations keep their scan tick in telemetry. Persistent
 * records retain only the source's first sighting, even when another source
 * already taught this scout about the cell.
 */
export function recordScanDiscoveries(
  size: GridSize,
  existing: readonly DiscoveryRecord[],
  observations: readonly Observation[],
  scoutId: ScoutId,
  tick: Tick,
): readonly DiscoveryRecord[] {
  assertSource(scoutId);
  const retained = mergeDiscoveries(size, existing, [], tick);
  const byIdentity = new Map(retained.map(record => [
    identity(record.sourceId, toIndex(size, record.position)), record,
  ]));
  const discoveries: Discovery[] = [];
  for (const observation of observations) {
    if (observation.scoutId !== scoutId || observation.tick !== tick) {
      throw new TypeError('Scan observations must belong to this scout and tick.');
    }
    const discovery: Discovery = {
      sourceId: scoutId,
      position: observation.position,
      cell: observation.cell,
      discoveredAtTick: tick,
    };
    const index = validateDiscovery(size, discovery, tick);
    const previous = byIdentity.get(identity(scoutId, index));
    if (previous) {
      if (previous.cell !== observation.cell) {
        throw new TypeError('A rescan conflicts with the source\'s first discovery.');
      }
    } else {
      discoveries.push(discovery);
    }
  }
  return mergeDiscoveries(size, retained, discoveries, tick);
}

/** Apply only recorded observations; terrain is neither accepted nor consulted. */
export function mergeDiscoveriesIntoMap(
  map: KnowledgeMap,
  records: readonly DiscoveryRecord[],
): KnowledgeMap {
  assertGridSize(map);
  if (map.kind !== 'knowledge' || map.cells.length !== map.width * map.height) {
    throw new TypeError('Discovery merging requires complete knowledge-map storage.');
  }
  const cells = [...map.cells];
  for (const cell of cells) {
    if (cell !== 'unknown' && cell !== 'clear' && cell !== 'blocked') {
      throw new TypeError('Knowledge maps can only contain unknown, clear, or blocked cells.');
    }
  }
  // No current tick is available here. Source/receipt ordering is still checked;
  // mergeDiscoveries and recordScanDiscoveries additionally reject future data.
  const validated = mergeDiscoveries(map, records, [], Number.MAX_SAFE_INTEGER);
  for (const record of validated) {
    const index = toIndex(map, record.position);
    if (cells[index] !== 'unknown' && cells[index] !== record.cell) {
      throw new TypeError('A discovery conflicts with the recipient\'s known map cell.');
    }
    cells[index] = record.cell;
  }
  return { kind: 'knowledge', width: map.width, height: map.height, cells };
}
