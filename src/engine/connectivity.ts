import { hasLineOfSight } from './line-of-sight';
import type { CommunicationNode, GroundTruthGrid, NodeConnectivity, NodeId, Tick } from './types';

/** Canonical node, peer, and component order, independent of authored order. */
export const NODE_ORDER = Object.freeze(['relay', 'scout-a', 'scout-b', 'scout-c'] as const);

/** Pure pre-movement graph; communication crosses a whole component per tick. */
export function computeConnectivity(
  terrain: GroundTruthGrid, nodes: readonly CommunicationNode[], range: number, tick: Tick,
): readonly NodeConnectivity[] {
  if (!Number.isSafeInteger(range) || range <= 0) {
    throw new RangeError('Communication range must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(tick) || tick < 1) {
    throw new RangeError('Connectivity requires a positive safe-integer tick.');
  }
  if (nodes.length !== NODE_ORDER.length) {
    throw new RangeError('Connectivity requires the relay and all three scouts.');
  }
  const byId = new Map<NodeId, CommunicationNode>();
  for (const node of nodes) {
    if (!NODE_ORDER.includes(node.id) || byId.has(node.id)) {
      throw new TypeError('Communication node IDs must be known and unique.');
    }
    // Validate every endpoint even when range rules would omit all its edges.
    hasLineOfSight(terrain, node.position, node.position);
    byId.set(node.id, node);
  }
  const ordered = NODE_ORDER.map(id => {
    const node = byId.get(id);
    if (!node) throw new TypeError(`Missing communication node ${id}.`);
    return node;
  });
  const peers = new Map<NodeId, Set<NodeId>>(NODE_ORDER.map(id => [id, new Set<NodeId>()]));
  const rangeSquared = BigInt(range) ** 2n;
  for (const [index, first] of ordered.entries()) {
    for (const second of ordered.slice(index + 1)) {
      const dx = BigInt(first.position.x) - BigInt(second.position.x);
      const dy = BigInt(first.position.y) - BigInt(second.position.y);
      if (dx * dx + dy * dy <= rangeSquared && hasLineOfSight(terrain, first.position, second.position)) {
        peers.get(first.id)?.add(second.id);
        peers.get(second.id)?.add(first.id);
      }
    }
  }

  const components = new Map<NodeId, NodeId>();
  for (const root of NODE_ORDER) {
    if (components.has(root)) continue;
    components.set(root, root);
    const pending: NodeId[] = [root];
    for (let index = 0; index < pending.length; index++) {
      const current = pending[index];
      if (current === undefined) throw new Error('Missing component node.');
      for (const candidate of NODE_ORDER) {
        if (peers.get(current)?.has(candidate) && !components.has(candidate)) {
          components.set(candidate, root);
          pending.push(candidate);
        }
      }
    }
  }

  return NODE_ORDER.map(nodeId => {
    const componentId = components.get(nodeId);
    if (componentId === undefined) throw new Error('Missing connectivity component.');
    return {
      nodeId, tick,
      peerIds: NODE_ORDER.filter(candidate => peers.get(nodeId)?.has(candidate)),
      componentId,
      // Relay is first in NODE_ORDER, so its component is always named relay.
      relayReachable: componentId === 'relay',
    };
  });
}
