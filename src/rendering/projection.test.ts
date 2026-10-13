import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine/initial-state';
import { stepBaselineAutonomous } from '../engine/step';
import { CANDIDATE_SCENARIO } from '../experiments/candidate';
import type { NodeId } from '../engine/types';
import {
  communicationEdges, knowledgeFor, projectInspector, projectScene, SCOUT_IDS,
  type ViewOptions,
} from './projection';

const options: ViewOptions = {
  knowledge: 'relay', selected: 'scout-a', trails: true, rays: true, links: true,
};
const first = createInitialState(CANDIDATE_SCENARIO, 'site-a');
const second = stepBaselineAutonomous(CANDIDATE_SCENARIO, first);

describe('scene projection', () => {
  it('starts with an unknown map and only projects each selected knowledge source', () => {
    expect(knowledgeFor(first, 'relay', 'scout-a').cells.every(cell => cell === 'unknown')).toBe(true);
    expect(projectScene(first, [first], options).map.cells.every(cell => cell === 'unknown')).toBe(true);
    for (const id of SCOUT_IDS) {
      expect(knowledgeFor(second, 'scout', id)).toStrictEqual(second.scouts.find(s => s.id === id)!.localMap);
    }
    expect(knowledgeFor(second, 'relay', 'scout-a')).toStrictEqual(second.relay.sharedMap);
    const fleet = knowledgeFor(second, 'fleet', 'scout-a');
    for (let index = 0; index < fleet.cells.length; index++) {
      const known = second.scouts.map(s => s.localMap.cells[index]).filter(c => c !== 'unknown');
      expect(fleet.cells[index]).toBe(known[0] ?? 'unknown');
    }
    expect(second.relay.sharedMap.cells.filter(c => c !== 'unknown').length)
      .toBeLessThan(fleet.cells.filter(c => c !== 'unknown').length);
  });

  it('never highlights a cell hidden in the chosen knowledge view', () => {
    for (const knowledge of ['relay', 'fleet', 'scout'] as const) {
      const projection = projectScene(second, [first, second], { ...options, knowledge });
      for (const highlight of projection.highlights) {
        const index = highlight.position.y * projection.map.width + highlight.position.x;
        expect(projection.map.cells[index]).not.toBe('unknown');
      }
    }
    const relay = projectScene(second, [first, second], options);
    const fleet = projectScene(second, [first, second], { ...options, knowledge: 'fleet' });
    expect(relay.highlights.length).toBeLessThan(fleet.highlights.length);
  });

  it('uses stored scan origins and exact quarter-cell endpoints after movement', () => {
    const projection = projectScene(second, [first, second], options);
    expect(projection.rays).toHaveLength(15);
    for (const scout of second.scouts) {
      const scan = scout.sensorTelemetry!;
      const rays = projection.rays.filter(ray => ray.scoutId === scout.id);
      expect(rays).toHaveLength(5);
      for (const [index, ray] of rays.entries()) {
        expect(ray).toMatchObject({ index, origin: scan.origin,
          end: { x: scan.rays[index]!.endPoint.x / 4, y: scan.rays[index]!.endPoint.y / 4 },
          termination: scan.rays[index]!.termination });
      }
    }
    expect(projection.rays.some(ray => {
      const scout = second.scouts.find(s => s.id === ray.scoutId)!;
      return ray.origin.x !== scout.position.x || ray.origin.y !== scout.position.y;
    })).toBe(true);
  });

  it('deduplicates direct edges and anchors them to pre-movement positions', () => {
    const edges = communicationEdges(second);
    const expected = second.scouts.reduce((sum, scout) => sum +
      (scout.communication.status === 'evaluated' ? scout.communication.peerIds.length : 0),
      second.relay.communication.status === 'evaluated' ? second.relay.communication.peerIds.length : 0) / 2;
    expect(edges).toHaveLength(expected);
    expect(new Set(edges.map(edge => edge.ids.join(':'))).size).toBe(edges.length);
    const origin = (id: NodeId) => id === 'relay' ? second.relay.position :
      second.scouts.find(scout => scout.id === id)!.sensorTelemetry!.origin;
    for (const edge of edges) {
      expect(edge.from).toEqual(origin(edge.ids[0]));
      expect(edge.to).toEqual(origin(edge.ids[1]));
    }
  });

  it('keeps trails outside engine state and clears them with fresh history', () => {
    const before = JSON.stringify(second);
    const traveled = projectScene(second, [first, second], options);
    expect(traveled.scouts.every(scout => scout.trail.length === 2)).toBe(true);
    const reset = projectScene(first, [first], options);
    expect(reset.scouts.every(scout => scout.trail.length === 1)).toBe(true);
    const hidden = projectScene(second, [first, second], { ...options, trails: false, rays: false, links: false });
    expect(hidden.scouts.every(scout => scout.trail.length === 0)).toBe(true);
    expect(hidden.rays).toEqual([]);
    expect(hidden.edges).toEqual([]);
    expect(JSON.stringify(second)).toBe(before);
  });

  it('projects inspector values from the selected scout only', () => {
    const scout = second.scouts[1];
    const inspector = projectInspector(second, scout.id);
    expect(inspector).toMatchObject({
      name: 'Scout B', tick: second.tick, position: `${scout.position.x}, ${scout.position.y}`,
      heading: scout.heading, target: scout.target ? `${scout.target.x}, ${scout.target.y}` : 'None',
      scan: { rays: scout.sensorTelemetry!.rayCount, observed: scout.sensorTelemetry!.observedCellCount,
        new: scout.sensorTelemetry!.newCellCount, blocked: scout.sensorTelemetry!.blockedHitCount },
      movement: { outcome: scout.lastMovement!.outcome },
    });
    expect(inspector.peers).toBe(scout.communication.status === 'evaluated'
      ? scout.communication.peerIds.map(id => id === 'relay' ? 'Relay' : `Scout ${id.slice(-1).toUpperCase()}`).join(', ') || 'None'
      : 'Not evaluated');
  });
});
