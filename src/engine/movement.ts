import { getCell, isInBounds } from './grid';
import type {
  GroundTruthGrid, Heading, MovementIntent, MovementResult, Position, ScoutState, Tick,
} from './types';

const OFFSETS: Readonly<Record<Heading, Position>> = {
  north: { x: 0, y: -1 }, east: { x: 1, y: 0 },
  south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
};

export function assertMovementIntent(intent: MovementIntent): void {
  if (!intent || (intent.kind !== 'stay' && intent.kind !== 'move')) {
    throw new TypeError('Each scout needs an explicit move or stay intent.');
  }
  if (intent.kind === 'move' && !Object.hasOwn(OFFSETS, intent.direction)) {
    throw new TypeError('Moves must request a cardinal direction.');
  }
}

/** Physical movement only; the caller supplies a decision without receiving terrain. */
export function resolveMovement(
  groundTruth: GroundTruthGrid,
  scout: Pick<ScoutState, 'id' | 'position' | 'heading'>,
  intent: MovementIntent,
  tick: Tick,
): MovementResult {
  assertMovementIntent(intent);
  if (!Number.isSafeInteger(tick) || tick < 1) {
    throw new RangeError('Movement results need a positive integer tick.');
  }
  if (!Object.hasOwn(OFFSETS, scout.heading)) throw new TypeError('Invalid scout heading.');
  if (getCell(groundTruth, scout.position) !== 'clear') {
    throw new RangeError('A scout must occupy a clear cell before moving.');
  }

  const origin = { x: scout.position.x, y: scout.position.y };
  if (intent.kind === 'stay') {
    return {
      tick, scoutId: scout.id, origin,
      destination: { x: origin.x, y: origin.y }, attemptedDestination: null,
      headingBefore: scout.heading, headingAfter: scout.heading,
      intent: { kind: 'stay' }, outcome: 'stayed',
    };
  }

  const offset = OFFSETS[intent.direction];
  const attemptedDestination = { x: origin.x + offset.x, y: origin.y + offset.y };
  const outcome = !isInBounds(groundTruth, attemptedDestination) ? 'boundary'
    : getCell(groundTruth, attemptedDestination) === 'blocked' ? 'blocked' : 'moved';
  const destination = outcome === 'moved' ? attemptedDestination : origin;
  return {
    tick, scoutId: scout.id, origin,
    destination: { x: destination.x, y: destination.y }, attemptedDestination,
    headingBefore: scout.heading, headingAfter: intent.direction,
    intent: { kind: 'move', direction: intent.direction }, outcome,
  };
}
