import { assertGridSize, fromIndex, isInBounds, toIndex } from './grid';
import type {
  CommunicationState, Heading, KnowledgeMap, MovementIntent, Position, ScoutId, Tick,
} from './types';

/** The complete policy input; no terrain, other scouts, or movement results. */
export interface PlannerView {
  readonly id: ScoutId;
  readonly position: Position;
  readonly heading: Heading;
  readonly localMap: KnowledgeMap;
  readonly target: Position | null;
  readonly tick: Tick;
  readonly communication: CommunicationState;
}

const NEIGHBORS = [
  { direction: 'north', x: 0, y: -1 },
  { direction: 'east', x: 1, y: 0 },
  { direction: 'south', x: 0, y: 1 },
  { direction: 'west', x: -1, y: 0 },
] as const;

interface Candidate {
  readonly target: number;
  readonly approach: number;
  readonly distance: number;
  readonly firstStep: Heading;
}

function precedes(candidate: Candidate, previous: Candidate | null): boolean {
  return previous === null || candidate.distance < previous.distance ||
    (candidate.distance === previous.distance && (
      candidate.target < previous.target ||
      (candidate.target === previous.target && candidate.approach < previous.approach)
    ));
}

/** Pure, identical policy for every scout, including disconnected scouts. */
export function planBaseline(view: PlannerView): {
  readonly target: Position | null;
  readonly intent: MovementIntent;
} {
  const map = view.localMap;
  assertGridSize(map);
  if (map.kind !== 'knowledge' || map.cells.length !== map.width * map.height ||
    map.cells.some(cell => cell !== 'unknown' && cell !== 'clear' && cell !== 'blocked')) {
    throw new TypeError('Frontier planning requires a complete knowledge map.');
  }
  const origin = toIndex(map, view.position);
  if (map.cells[origin] !== 'clear') {
    throw new RangeError('Frontier planning requires a known-clear scout position.');
  }
  const retainedTarget = view.target !== null && isInBounds(map, view.target)
    ? toIndex(map, view.target) : null;
  const distances = Array<number>(map.cells.length).fill(-1);
  const firstSteps = Array<Heading | null>(map.cells.length).fill(null);
  const queue = [origin];
  distances[origin] = 0;
  let best: Candidate | null = null;
  let retained: Candidate | null = null;

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const approach = queue[cursor]!;
    const position = fromIndex(map, approach);
    for (const neighbor of NEIGHBORS) {
      const next = { x: position.x + neighbor.x, y: position.y + neighbor.y };
      if (!isInBounds(map, next)) continue;
      const index = toIndex(map, next);
      const distance = distances[approach]! + 1;
      const firstStep = firstSteps[approach] ?? neighbor.direction;
      if (map.cells[index] === 'clear' && distances[index] === -1) {
        distances[index] = distance;
        firstSteps[index] = firstStep;
        queue.push(index);
      } else if (map.cells[index] === 'unknown') {
        const candidate = { target: index, approach, distance, firstStep };
        if (precedes(candidate, best)) best = candidate;
        if (index === retainedTarget && precedes(candidate, retained)) retained = candidate;
      }
    }
  }

  // Each approach keeps its first N/E/S/W BFS path. Thus equal-distance paths
  // to the same target and approach use that path without another tie-breaker.
  const selected = retained ?? best;
  if (selected === null) return { target: null, intent: { kind: 'stay' } };
  return {
    target: fromIndex(map, selected.target),
    intent: { kind: 'move', direction: selected.firstStep },
  };
}
