import { describe, expect, it } from 'vitest';
import { computeConnectivity } from './connectivity';
import { exchangeDiscoveries, type KnowledgeNode } from './exchange';
import { createUnknownMap, getCell, parseGroundTruth } from './grid';
import { mergeDiscoveriesIntoMap } from './knowledge';
import type { DiscoveryRecord, NodeId, Position } from './types';

const terrain = parseGroundTruth(['.........']);
const tick = 2;
const partitionedPositions: Readonly<Record<NodeId, Position>> = {
  relay: { x: 0, y: 0 }, 'scout-a': { x: 1, y: 0 },
  'scout-b': { x: 6, y: 0 }, 'scout-c': { x: 7, y: 0 },
};
const partitionedGraph = computeConnectivity(
  terrain,
  (['relay', 'scout-a', 'scout-b', 'scout-c'] as const).map(id => ({
    id, position: partitionedPositions[id],
  })),
  1,
  tick,
);

function record(
  sourceId: 'scout-a' | 'scout-b' | 'scout-c',
  x: number,
  overrides: Partial<DiscoveryRecord> = {},
): DiscoveryRecord {
  return {
    sourceId, position: { x, y: 0 }, cell: 'clear',
    discoveredAtTick: 1, receivedAtTick: 1, ...overrides,
  };
}

function node(id: NodeId, discoveries: readonly DiscoveryRecord[] = []): KnowledgeNode {
  return {
    id,
    map: mergeDiscoveriesIntoMap(createUnknownMap({ width: 9, height: 1 }), discoveries),
    discoveries,
  };
}

function byId(nodes: readonly KnowledgeNode[], id: NodeId): KnowledgeNode {
  const result = nodes.find(nodeValue => nodeValue.id === id);
  if (!result) throw new Error(`Missing node ${id}.`);
  return result;
}

describe('simultaneous component exchange', () => {
  it('shares the pre-exchange union through a multi-hop component in one tick', () => {
    const graph = computeConnectivity(
      terrain,
      (['relay', 'scout-a', 'scout-b', 'scout-c'] as const).map((id, index) => ({
        id, position: { x: index, y: 0 },
      })),
      1,
      tick,
    );
    const sourceA = record('scout-a', 4);
    const sourceB = record('scout-b', 5);
    const sourceC = record('scout-c', 6);
    const exchanged = exchangeDiscoveries([
      node('scout-c', [sourceC]), node('relay'), node('scout-b', [sourceB]), node('scout-a', [sourceA]),
    ], graph, tick);

    for (const id of ['relay', 'scout-a', 'scout-b', 'scout-c'] as const) {
      const current = byId(exchanged, id);
      expect(current.discoveries.map(discovery => discovery.sourceId)).toEqual([
        'scout-a', 'scout-b', 'scout-c',
      ]);
      expect(current.discoveries.every(discovery => discovery.receivedAtTick ===
        (id === discovery.sourceId ? 1 : tick))).toBe(true);
      expect(getCell(current.map, { x: 4, y: 0 })).toBe('clear');
      expect(getCell(current.map, { x: 5, y: 0 })).toBe('clear');
      expect(getCell(current.map, { x: 6, y: 0 })).toBe('clear');
    }
  });

  it('does not let knowledge cross a partition, while both isolated components exchange internally', () => {
    const exchanged = exchangeDiscoveries([
      node('relay', [record('scout-a', 2)]),
      node('scout-a'),
      node('scout-b', [record('scout-b', 5)]),
      node('scout-c', [record('scout-c', 6)]),
    ], partitionedGraph, tick);
    const relay = byId(exchanged, 'relay');
    const scoutA = byId(exchanged, 'scout-a');
    const scoutB = byId(exchanged, 'scout-b');
    const scoutC = byId(exchanged, 'scout-c');
    expect(relay.discoveries.map(discovery => discovery.sourceId)).toEqual(['scout-a']);
    expect(scoutA.discoveries.map(discovery => discovery.sourceId)).toEqual(['scout-a']);
    expect(scoutB.discoveries.map(discovery => discovery.sourceId)).toEqual(['scout-b', 'scout-c']);
    expect(scoutC.discoveries.map(discovery => discovery.sourceId)).toEqual(['scout-b', 'scout-c']);
    expect(getCell(relay.map, { x: 5, y: 0 })).toBe('unknown');
    expect(getCell(scoutB.map, { x: 2, y: 0 })).toBe('unknown');
  });

  it('keeps an existing recipient receipt and stamps only first receipt of new facts', () => {
    const oldForRelay = record('scout-a', 2, { receivedAtTick: 1 });
    const oldForScout = record('scout-a', 2, { receivedAtTick: 2 });
    const exchanged = exchangeDiscoveries([
      node('relay', [oldForRelay]), node('scout-a', [oldForScout]),
      node('scout-b', [record('scout-b', 4, { discoveredAtTick: 1 })]), node('scout-c'),
    ], partitionedGraph, tick);
    expect(byId(exchanged, 'relay').discoveries).toContainEqual(oldForRelay);
    expect(byId(exchanged, 'scout-a').discoveries).toContainEqual(oldForScout);
    expect(byId(exchanged, 'scout-b').discoveries).toContainEqual(record('scout-b', 4, { receivedAtTick: 1 }));
    expect(byId(exchanged, 'scout-c').discoveries).toContainEqual(record('scout-b', 4, { receivedAtTick: 2 }));
  });

  it('uses only discovery records as exchange sources, never arbitrary known map cells', () => {
    const mapWithUnprovenCell = createUnknownMap({ width: 9, height: 1 });
    (mapWithUnprovenCell.cells as string[])[8] = 'clear';
    const nodes: KnowledgeNode[] = [
      { id: 'relay', map: createUnknownMap({ width: 9, height: 1 }), discoveries: [] },
      { id: 'scout-a', map: mapWithUnprovenCell, discoveries: [] },
      node('scout-b'), node('scout-c'),
    ];
    const exchanged = exchangeDiscoveries(nodes, partitionedGraph, tick);
    expect(getCell(byId(exchanged, 'relay').map, { x: 8, y: 0 })).toBe('unknown');
    expect(byId(exchanged, 'relay').discoveries).toEqual([]);
  });
});

describe('exchange determinism, validation, and snapshot safety', () => {
  it('is independent of node and graph array order and returns canonical node order', () => {
    const nodes = [
      node('relay', [record('scout-a', 2)]), node('scout-a'),
      node('scout-b', [record('scout-b', 5)]), node('scout-c'),
    ];
    const reference = exchangeDiscoveries(nodes, partitionedGraph, tick);
    const reversed = exchangeDiscoveries([...nodes].reverse(), [...partitionedGraph].reverse(), tick);
    expect(reversed).toEqual(reference);
    expect(reference.map(current => current.id)).toEqual(['relay', 'scout-a', 'scout-b', 'scout-c']);
  });

  it('can reconnect a retained discovery on a later tick without changing its source time', () => {
    const firstGraph = partitionedGraph;
    const retained = exchangeDiscoveries([
      node('relay'), node('scout-a', [record('scout-a', 2)]),
      node('scout-b'), node('scout-c'),
    ], firstGraph, 2);
    const connectedGraph = computeConnectivity(
      terrain,
      (['relay', 'scout-a', 'scout-b', 'scout-c'] as const).map(id => ({
        id, position: { x: id === 'relay' ? 0 : id === 'scout-a' ? 1 : id === 'scout-b' ? 2 : 3, y: 0 },
      })),
      1,
      3,
    );
    const reconnected = exchangeDiscoveries(retained, connectedGraph, 3);
    for (const id of ['relay', 'scout-a', 'scout-b', 'scout-c'] as const) {
      expect(byId(reconnected, id).discoveries).toContainEqual(record('scout-a', 2, {
        discoveredAtTick: 1, receivedAtTick: id === 'scout-a' ? 1 : id === 'relay' ? 2 : 3,
      }));
    }
  });

  it('rejects conflicting source facts, malformed components, and wrong ticks', () => {
    const connectedGraph = computeConnectivity(
      terrain,
      (['relay', 'scout-a', 'scout-b', 'scout-c'] as const).map((id, index) => ({
        id, position: { x: index, y: 0 },
      })),
      1,
      tick,
    );
    const conflictNodes = [
      node('relay'), node('scout-a', [record('scout-a', 2)]),
      node('scout-b', [record('scout-a', 2, { cell: 'blocked' })]), node('scout-c'),
    ];
    expect(() => exchangeDiscoveries(conflictNodes, connectedGraph, tick)).toThrow('Conflicting discovery states');
    const wrongTick = partitionedGraph.map(entry => ({ ...entry, tick: 1 }));
    expect(() => exchangeDiscoveries(conflictNodes.map(current => node(current.id)), wrongTick, tick)).toThrow('evaluated at this tick');
    const wrongComponent = partitionedGraph.map(entry => entry.nodeId === 'scout-b'
      ? { ...entry, componentId: 'relay' as const, relayReachable: true } : entry);
    expect(() => exchangeDiscoveries(conflictNodes.map(current => node(current.id)), wrongComponent, tick)).toThrow('Component labels');
  });

  it('preserves every input snapshot and returns detached maps and records', () => {
    const nodes = [
      node('relay'), node('scout-a', [record('scout-a', 2)]), node('scout-b'), node('scout-c'),
    ];
    const before = JSON.stringify(nodes);
    const result = exchangeDiscoveries(nodes, partitionedGraph, tick);
    expect(JSON.stringify(nodes)).toBe(before);
    expect(result[0]!.map).not.toBe(nodes[0]!.map);
    expect(result[0]!.discoveries).not.toBe(nodes[0]!.discoveries);
    (result[0]!.map.cells as string[])[2] = 'blocked';
    (result[0]!.discoveries[0]!.position as { x: number }).x = 8;
    expect(nodes[0]!.map.cells[2]).toBe('unknown');
    expect(nodes[0]!.discoveries).toEqual([]);
    expect(nodes[1]!.discoveries[0]!.position).toEqual({ x: 2, y: 0 });
  });

  it('requires all four unique nodes and equal map dimensions', () => {
    const nodes = [node('relay'), node('scout-a'), node('scout-b'), node('scout-c')];
    expect(() => exchangeDiscoveries(nodes.slice(1), partitionedGraph, tick)).toThrow('relay and all three');
    expect(() => exchangeDiscoveries([
      nodes[0]!, nodes[1]!, nodes[2]!, node('scout-c', [],),
    ].map((current, index) => index === 3 ? {
      ...current, map: createUnknownMap({ width: 8, height: 1 }),
    } : current), partitionedGraph, tick)).toThrow('matching dimensions');
  });
});
