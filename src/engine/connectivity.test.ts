import { describe, expect, it } from 'vitest';
import { computeConnectivity, NODE_ORDER } from './connectivity';
import { parseGroundTruth } from './grid';
import type { CommunicationNode, NodeId, Position } from './types';

function nodes(positions: readonly Position[]): CommunicationNode[] {
  return NODE_ORDER.map((id, index) => {
    const position = positions[index];
    if (!position) throw new Error('Missing test node position.');
    return { id, position };
  });
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(rest => [value, ...rest]),
  );
}

describe('communication range and occlusion', () => {
  const open = parseGroundTruth(Array<string>(12).fill('............'));

  it('connects exactly at Euclidean range (3-4-5), with clear endpoints', () => {
    const graph = computeConnectivity(open, nodes([
      { x: 1, y: 1 }, { x: 4, y: 5 }, { x: 11, y: 0 }, { x: 11, y: 11 },
    ]), 5, 3);
    expect(graph[0]).toEqual({
      nodeId: 'relay', tick: 3, peerIds: ['scout-a'], componentId: 'relay', relayReachable: true,
    });
    expect(graph[1]?.peerIds).toEqual(['relay']);
  });

  it('disconnects just outside range without rounding distance down', () => {
    const graph = computeConnectivity(open, nodes([
      { x: 1, y: 1 }, { x: 6, y: 2 }, { x: 11, y: 0 }, { x: 11, y: 11 },
    ]), 5, 1);
    expect(graph[0]?.peerIds).toEqual([]);
    expect(graph[1]?.peerIds).not.toContain('relay');
  });

  it('occludes an in-range pair behind a wall', () => {
    const terrain = parseGroundTruth(['..#..', '..#..', '..#..']);
    const graph = computeConnectivity(terrain, nodes([
      { x: 0, y: 1 }, { x: 4, y: 1 }, { x: 0, y: 0 }, { x: 4, y: 0 },
    ]), 5, 1);
    expect(graph[0]?.peerIds).toEqual(['scout-b']);
    expect(graph[1]?.peerIds).toEqual(['scout-c']);
  });

  it.each([{ x: 1, y: 0 }, { x: 0, y: 1 }])('occludes either corner-side wall $x,$y', wall => {
    const rows = ['....', '....', '....', '....'];
    rows[wall.y] = '.'.repeat(wall.x) + '#' + '.'.repeat(3 - wall.x);
    const terrain = parseGroundTruth(rows);
    const graph = computeConnectivity(terrain, nodes([
      { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 3 },
    ]), 2, 1);
    expect(graph[0]?.peerIds).toEqual([]);
    expect(graph[1]?.peerIds).not.toContain('relay');
  });

  it('connects distinct nodes occupying the same clear cell', () => {
    const same = { x: 1, y: 1 };
    const graph = computeConnectivity(open, nodes([same, same, same, same]), 1, 1);
    for (const entry of graph) {
      expect(entry.peerIds).toEqual(NODE_ORDER.filter(id => id !== entry.nodeId));
      expect(entry.componentId).toBe('relay');
      expect(entry.relayReachable).toBe(true);
    }
  });

  it('accepts the largest safe integer range without squaring precision loss', () => {
    const graph = computeConnectivity(open, nodes([
      { x: 0, y: 0 }, { x: 11, y: 0 }, { x: 0, y: 11 }, { x: 11, y: 11 },
    ]), Number.MAX_SAFE_INTEGER, 1);
    expect(graph.every(entry => entry.peerIds.length === 3)).toBe(true);
  });
});

describe('canonical direct links and connected components', () => {
  const terrain = parseGroundTruth(['...........']);
  const chain = nodes([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 }]);

  it('reports scout-to-scout multi-hop relay reachability separately from direct peers', () => {
    const graph = computeConnectivity(terrain, chain, 2, 8);
    expect(graph.map(entry => entry.peerIds)).toEqual([
      ['scout-a'], ['relay', 'scout-b'], ['scout-a', 'scout-c'], ['scout-b'],
    ]);
    expect(graph.map(entry => entry.componentId)).toEqual(['relay', 'relay', 'relay', 'relay']);
    expect(graph.every(entry => entry.relayReachable && entry.tick === 8)).toBe(true);
  });

  it('names each disconnected component after its first canonical node', () => {
    const graph = computeConnectivity(terrain, nodes([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 8, y: 0 }, { x: 9, y: 0 },
    ]), 1, 1);
    expect(graph.map(entry => entry.peerIds)).toEqual([['scout-a'], ['relay'], ['scout-c'], ['scout-b']]);
    expect(graph.map(entry => entry.componentId)).toEqual(['relay', 'relay', 'scout-b', 'scout-b']);
    expect(graph.map(entry => entry.relayReachable)).toEqual([true, true, false, false]);
  });

  it('keeps an isolated relay separate from a component of scouts', () => {
    const graph = computeConnectivity(terrain, nodes([
      { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 },
    ]), 1, 1);
    expect(graph[0]?.peerIds).toEqual([]);
    expect(graph[0]?.relayReachable).toBe(true);
    expect(graph.slice(1).map(entry => entry.componentId)).toEqual(['scout-a', 'scout-a', 'scout-a']);
    expect(graph.slice(1).every(entry => !entry.relayReachable)).toBe(true);
  });

  it('gives each isolated node its own stable component ID', () => {
    const graph = computeConnectivity(terrain, chain, 1, 1);
    expect(graph.map(entry => entry.componentId)).toEqual(NODE_ORDER);
    expect(graph.every(entry => entry.peerIds.length === 0)).toBe(true);
  });

  it('produces identical canonical output for all 24 authored node permutations', () => {
    const reference = computeConnectivity(terrain, chain, 2, 7);
    for (const order of permutations(chain)) {
      expect(computeConnectivity(terrain, order, 2, 7)).toEqual(reference);
    }
    expect(reference.map(entry => entry.nodeId)).toEqual(['relay', 'scout-a', 'scout-b', 'scout-c']);
  });

  it('changes graphs when the relay occupies a different authored site', () => {
    const first = computeConnectivity(terrain, chain, 2, 1);
    const secondNodes = chain.map(node => node.id === 'relay' ? { ...node, position: { x: 10, y: 0 } } : node);
    const second = computeConnectivity(terrain, secondNodes, 2, 1);
    expect(first[0]?.peerIds).toEqual(['scout-a']);
    expect(second[0]?.peerIds).toEqual([]);
    expect(second.slice(1).every(entry => !entry.relayReachable)).toBe(true);
  });

  it('does not mutate inputs or reuse peers across independent graph results', () => {
    const input = Object.freeze(chain.map(node => Object.freeze({
      id: node.id, position: Object.freeze({ ...node.position }),
    })));
    const before = JSON.stringify({ terrain, input });
    const first = computeConnectivity(terrain, input, 2, 1);
    const second = computeConnectivity(terrain, input, 2, 1);
    expect(JSON.stringify({ terrain, input })).toBe(before);
    expect(first).toEqual(second);
    expect(first[0]?.peerIds).not.toBe(second[0]?.peerIds);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it.each([0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid range %s', range => {
    expect(() => computeConnectivity(terrain, chain, range, 1)).toThrow(RangeError);
  });

  it.each([0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid tick %s', tick => {
    expect(() => computeConnectivity(terrain, chain, 2, tick)).toThrow(RangeError);
  });

  it('requires exactly one relay and one of each scout, without modifying authored order', () => {
    expect(() => computeConnectivity(terrain, chain.slice(1), 2, 1)).toThrow(RangeError);
    expect(() => computeConnectivity(terrain, chain.concat(chain), 2, 1)).toThrow(RangeError);
    expect(() => computeConnectivity(terrain, chain.map(node => ({ ...node, id: 'relay' })), 2, 1)).toThrow(TypeError);
    const unknown = chain.map(node => node.id === 'relay' ? { ...node, id: 'other' as NodeId } : node);
    expect(() => computeConnectivity(terrain, unknown, 2, 1)).toThrow(TypeError);
  });

  it('rejects invalid or blocked node positions even when they would have no in-range peer', () => {
    const wall = parseGroundTruth(['..........#']);
    for (const position of [{ x: 10, y: 0 }, { x: 11, y: 0 }, { x: 0.5, y: 0 }]) {
      const invalid = chain.map(node => node.id === 'relay' ? { ...node, position } : node);
      expect(() => computeConnectivity(wall, invalid, 1, 1)).toThrow(RangeError);
    }
  });
});
