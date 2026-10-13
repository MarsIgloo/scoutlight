import { mergeDiscoveries, mergeDiscoveriesIntoMap } from './knowledge';
import { NODE_ORDER } from './connectivity';
import type {
  DiscoveryRecord, KnowledgeMap, NodeConnectivity, NodeId, Tick,
} from './types';

export interface KnowledgeNode {
  readonly id: NodeId;
  readonly map: KnowledgeMap;
  readonly discoveries: readonly DiscoveryRecord[];
}

function validateGraph(graph: readonly NodeConnectivity[], tick: Tick): Map<NodeId, NodeConnectivity> {
  const byId = new Map<NodeId, NodeConnectivity>();
  for (const node of graph) {
    if (!NODE_ORDER.includes(node.nodeId) || byId.has(node.nodeId) || node.tick !== tick) {
      throw new TypeError('Exchange requires unique graph nodes evaluated at this tick.');
    }
    byId.set(node.nodeId, node);
  }
  if (byId.size !== NODE_ORDER.length) {
    throw new TypeError('Exchange requires all four communication graph nodes.');
  }
  for (const node of graph) {
    const peers = new Set(node.peerIds);
    if (peers.size !== node.peerIds.length || peers.has(node.nodeId)) {
      throw new TypeError('Direct peers must be unique and cannot include the node itself.');
    }
    for (const peerId of peers) {
      if (!byId.get(peerId)?.peerIds.includes(node.nodeId)) {
        throw new TypeError('Exchange requires known, reciprocal direct peers.');
      }
    }
  }
  const visited = new Set<NodeId>();
  for (const componentId of NODE_ORDER) {
    if (visited.has(componentId)) continue;
    const members: NodeId[] = [componentId];
    visited.add(componentId);
    for (let index = 0; index < members.length; index++) {
      for (const peer of byId.get(members[index]!)!.peerIds) {
        if (!visited.has(peer)) {
          visited.add(peer);
          members.push(peer);
        }
      }
    }
    const relayReachable = members.includes('relay');
    for (const member of members) {
      const node = byId.get(member)!;
      if (node.componentId !== componentId || node.relayReachable !== relayReachable) {
        throw new TypeError('Component labels and relay reachability must match the direct links.');
      }
    }
  }
  return byId;
}

/**
 * A component shares the union of its pre-exchange discoveries in one tick,
 * regardless of hop count. Every recipient applies the same source facts to
 * its own prior records, retaining its own first receipt times.
 */
export function exchangeDiscoveries(
  nodes: readonly KnowledgeNode[],
  graph: readonly NodeConnectivity[],
  tick: Tick,
): readonly KnowledgeNode[] {
  if (!Number.isSafeInteger(tick) || tick < 1) {
    throw new RangeError('Knowledge exchange requires a positive safe-integer tick.');
  }
  const graphById = validateGraph(graph, tick);
  const byId = new Map<NodeId, KnowledgeNode>();
  for (const node of nodes) {
    if (!NODE_ORDER.includes(node.id) || byId.has(node.id)) {
      throw new TypeError('Exchange requires unique, known knowledge node IDs.');
    }
    byId.set(node.id, node);
  }
  if (byId.size !== NODE_ORDER.length) {
    throw new TypeError('Exchange requires the relay and all three scouts.');
  }
  const size = byId.get('relay')!.map;
  const retained = new Map<NodeId, readonly DiscoveryRecord[]>();
  const unions = new Map<NodeId, readonly DiscoveryRecord[]>();
  for (const id of NODE_ORDER) {
    const node = byId.get(id)!;
    if (node.map.width !== size.width || node.map.height !== size.height) {
      throw new RangeError('All exchange maps must have matching dimensions.');
    }
    // Validate recipient timestamps before union building would discard them.
    const records = mergeDiscoveries(size, node.discoveries, [], tick);
    retained.set(id, records);
    const componentId = graphById.get(id)!.componentId;
    unions.set(componentId, mergeDiscoveries(size, unions.get(componentId) ?? [], records, tick));
  }
  // The unions above are complete before any recipient map or record is built.
  return NODE_ORDER.map((id): KnowledgeNode => {
    const node = byId.get(id)!;
    const union = unions.get(graphById.get(id)!.componentId)!;
    const discoveries = mergeDiscoveries(size, retained.get(id)!, union, tick);
    return { id, map: mergeDiscoveriesIntoMap(node.map, discoveries), discoveries };
  });
}
