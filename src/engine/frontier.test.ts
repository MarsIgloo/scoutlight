import { describe, expect, it } from 'vitest';
import { planBaseline, type PlannerView } from './frontier';
import type { CellState, KnowledgeMap, Position } from './types';

/** '.' is known clear, '#' known blocked, and '?' unknown. */
function knowledge(rows: readonly string[]): KnowledgeMap {
  const symbols: Record<string, CellState> = { '.': 'clear', '#': 'blocked', '?': 'unknown' };
  const width = rows[0]!.length;
  if (rows.some(row => row.length !== width)) throw new Error('Unequal fixture rows.');
  return {
    kind: 'knowledge', width, height: rows.length,
    cells: rows.flatMap(row => [...row].map(symbol => symbols[symbol]!)),
  };
}

function view(rows: readonly string[], position: Position, target: Position | null = null): PlannerView {
  return {
    id: 'scout-a', position, heading: 'east', localMap: knowledge(rows), target, tick: 1,
    communication: {
      status: 'evaluated', tick: 1, peerIds: [], componentId: 'scout-a', relayReachable: false,
    },
  };
}

describe('baseline frontier planning', () => {
  it.each([
    { rows: ['.?'], position: { x: 0, y: 0 }, target: { x: 1, y: 0 }, direction: 'east' },
    { rows: ['?.'], position: { x: 1, y: 0 }, target: { x: 0, y: 0 }, direction: 'west' },
    { rows: ['.', '?'], position: { x: 0, y: 0 }, target: { x: 0, y: 1 }, direction: 'south' },
    { rows: ['?', '.'], position: { x: 0, y: 1 }, target: { x: 0, y: 0 }, direction: 'north' },
  ])('attempts the adjacent unknown cell $direction at a boundary', fixture => {
    expect(planBaseline(view(fixture.rows, fixture.position))).toEqual({
      target: fixture.target, intent: { kind: 'move', direction: fixture.direction },
    });
  });

  it('routes around an obstacle through known-clear approach cells', () => {
    const rows = ['.#?', '.#.', '...'];
    let current = view(rows, { x: 0, y: 0 });
    // The only unknown is reached by going around the bottom of the wall.
    const route = [
      { position: { x: 0, y: 0 }, direction: 'south' },
      { position: { x: 0, y: 1 }, direction: 'south' },
      { position: { x: 0, y: 2 }, direction: 'east' },
      { position: { x: 1, y: 2 }, direction: 'east' },
      { position: { x: 2, y: 2 }, direction: 'north' },
      { position: { x: 2, y: 1 }, direction: 'north' },
    ];
    for (const step of route) {
      current = { ...current, position: step.position };
      const decision = planBaseline(current);
      expect(decision).toEqual({
        target: { x: 2, y: 0 }, intent: { kind: 'move', direction: step.direction },
      });
      current = { ...current, target: decision.target };
    }
  });

  it('excludes unknown cells whose only clear approaches are unreachable', () => {
    expect(planBaseline(view(['..#.?', '..###', '.?###'], { x: 0, y: 0 }))).toEqual({
      target: { x: 1, y: 2 }, intent: { kind: 'move', direction: 'east' },
    });
  });

  it('cannot route across unknown cells to retain a farther target', () => {
    expect(planBaseline(view(['.??'], { x: 0, y: 0 }, { x: 2, y: 0 }))).toEqual({
      target: { x: 1, y: 0 }, intent: { kind: 'move', direction: 'east' },
    });
  });

  it('ranks total route length before target row-major order', () => {
    expect(planBaseline(view(['?..', '...', '.?.'], { x: 1, y: 1 }))).toEqual({
      target: { x: 1, y: 2 }, intent: { kind: 'move', direction: 'south' },
    });
  });

  it('uses target row-major order when equally short paths begin east and west', () => {
    expect(planBaseline(view(['?.?'], { x: 1, y: 0 }))).toEqual({
      target: { x: 0, y: 0 }, intent: { kind: 'move', direction: 'west' },
    });
  });

  it('uses approach row-major order before BFS path order', () => {
    // East is visited before west, but west reaches the lower-index approach
    // (1,1). Both approaches need four total moves to the target (2,1).
    expect(planBaseline(view(['#####', '#.?.#', '#.#.#', '#...#'], { x: 2, y: 3 }))).toEqual({
      target: { x: 2, y: 1 }, intent: { kind: 'move', direction: 'west' },
    });
  });

  it.each([
    {
      rows: ['##?', '...', '...'], position: { x: 0, y: 2 }, target: { x: 2, y: 0 },
      direction: 'north', later: 'east',
    },
    {
      rows: ['...', '...', '##?'], position: { x: 0, y: 0 }, target: { x: 2, y: 2 },
      direction: 'east', later: 'south',
    },
    {
      rows: ['...', '...', '?##'], position: { x: 2, y: 0 }, target: { x: 0, y: 2 },
      direction: 'south', later: 'west',
    },
  ])('uses $direction before $later for equal shortest paths to one approach', fixture => {
    expect(planBaseline(view(fixture.rows, fixture.position))).toEqual({
      target: fixture.target, intent: { kind: 'move', direction: fixture.direction },
    });
  });

  it('retains a reachable unknown target even when a closer target is available', () => {
    expect(planBaseline(view(['?..?', '....'], { x: 1, y: 1 }, { x: 3, y: 0 }))).toEqual({
      target: { x: 3, y: 0 }, intent: { kind: 'move', direction: 'north' },
    });
  });

  it.each(['clear', 'blocked'] as const)('replaces a target learned to be %s', cell => {
    const input = view(['?.?'], { x: 1, y: 0 }, { x: 0, y: 0 });
    const cells = [...input.localMap.cells];
    cells[0] = cell;
    expect(planBaseline({ ...input, localMap: { ...input.localMap, cells } })).toEqual({
      target: { x: 2, y: 0 }, intent: { kind: 'move', direction: 'east' },
    });
  });

  it('replaces a retained target whose clear approaches are unreachable', () => {
    expect(planBaseline(view(['.?##.?'], { x: 0, y: 0 }, { x: 5, y: 0 }))).toEqual({
      target: { x: 1, y: 0 }, intent: { kind: 'move', direction: 'east' },
    });
  });

  it.each([
    { rows: ['.'], position: { x: 0, y: 0 } },
    { rows: ['...', '...'], position: { x: 1, y: 1 } },
    { rows: ['###', '#.#', '###'], position: { x: 1, y: 1 } },
    { rows: ['.#?'], position: { x: 0, y: 0 } },
  ])('stays and clears the target without any reachable frontier: $rows', ({ rows, position }) => {
    expect(planBaseline(view(rows, position, { x: 0, y: 0 }))).toEqual({
      target: null, intent: { kind: 'stay' },
    });
  });

  it('lets disconnected scouts independently select the same target', () => {
    const first = view(['?.?'], { x: 1, y: 0 });
    const second: PlannerView = {
      ...first, id: 'scout-b', communication: {
        status: 'evaluated', tick: 1, peerIds: [], componentId: 'scout-b', relayReachable: false,
      },
    };
    expect(planBaseline({ ...first, id: 'scout-b' })).toEqual(planBaseline(first));
    expect(planBaseline(first)).toEqual(planBaseline(second));
    expect(planBaseline(second).target).toEqual({ x: 0, y: 0 });
  });

  it('does not use communication status to allocate targets', () => {
    const input = view(['?.?'], { x: 1, y: 0 });
    expect(planBaseline({ ...input, communication: {
      status: 'evaluated', tick: 1, peerIds: ['relay', 'scout-b'],
      componentId: 'relay', relayReachable: true,
    } })).toEqual(planBaseline(input));
  });

  it('never reads private information accidentally supplied alongside the view', () => {
    const input = view(['.?'], { x: 0, y: 0 });
    for (const key of ['groundTruth', 'relay', 'scouts', 'claims', 'discoveries', 'sensorTelemetry', 'lastMovement']) {
      Object.defineProperty(input, key, {
        enumerable: true, get() { throw new Error(`Forbidden read: ${key}`); },
      });
    }
    expect(planBaseline(input)).toEqual({
      target: { x: 1, y: 0 }, intent: { kind: 'move', direction: 'east' },
    });
  });

  it('rejects terrain passed as knowledge and a scout outside known clear space', () => {
    const input = view(['.?'], { x: 0, y: 0 });
    expect(() => planBaseline({ ...input, localMap: {
      ...input.localMap, kind: 'ground-truth',
    } as unknown as KnowledgeMap })).toThrow('knowledge map');
    expect(() => planBaseline({ ...input, position: { x: 1, y: 0 } })).toThrow('known-clear');
  });

  it('is deterministic and leaves frozen inputs and earlier outputs unchanged', () => {
    const input = view(['..?', '...'], { x: 0, y: 1 }, { x: 2, y: 0 });
    const before = JSON.stringify(input);
    Object.freeze(input.position);
    Object.freeze(input.target);
    Object.freeze(input.localMap.cells);
    Object.freeze(input.localMap);
    Object.freeze(input.communication);
    Object.freeze(input);
    const first = planBaseline(input);
    const firstBefore = JSON.stringify(first);
    expect(planBaseline(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(first.target).not.toBe(input.target);
    expect(JSON.stringify(first)).toBe(firstBefore);
  });
});
