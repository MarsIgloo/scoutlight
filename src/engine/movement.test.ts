import { describe, expect, it } from 'vitest';
import { parseGroundTruth } from './grid';
import { resolveMovement } from './movement';
import type { Heading, MovementIntent } from './types';

const grid = parseGroundTruth(['...', '...', '...']);
const scout = { id: 'scout-a', position: { x: 1, y: 1 }, heading: 'east' } as const;

describe('physical movement', () => {
  it.each([
    { direction: 'north', destination: { x: 1, y: 0 } },
    { direction: 'east', destination: { x: 2, y: 1 } },
    { direction: 'south', destination: { x: 1, y: 2 } },
    { direction: 'west', destination: { x: 0, y: 1 } },
  ] as const)('moves exactly one orthogonal cell $direction', ({ direction, destination }) => {
    const result = resolveMovement(grid, scout, { kind: 'move', direction }, 1);
    expect(result).toEqual({
      tick: 1, scoutId: 'scout-a', origin: { x: 1, y: 1 }, destination,
      attemptedDestination: destination, headingBefore: 'east', headingAfter: direction,
      intent: { kind: 'move', direction }, outcome: 'moved',
    });
    expect(Math.abs(result.destination.x - result.origin.x) +
      Math.abs(result.destination.y - result.origin.y)).toBe(1);
  });

  it('turns toward a blocked move without changing position', () => {
    const walls = parseGroundTruth(['.#.', '...', '...']);
    const result = resolveMovement(walls, scout, { kind: 'move', direction: 'north' }, 2);
    expect(result.outcome).toBe('blocked');
    expect(result.destination).toEqual(scout.position);
    expect(result.attemptedDestination).toEqual({ x: 1, y: 0 });
    expect(result.headingAfter).toBe('north');
  });

  it.each([
    { position: { x: 1, y: 0 }, direction: 'north' },
    { position: { x: 2, y: 1 }, direction: 'east' },
    { position: { x: 1, y: 2 }, direction: 'south' },
    { position: { x: 0, y: 1 }, direction: 'west' },
  ] as const)('distinguishes the $direction boundary from an obstacle', ({ position, direction }) => {
    const result = resolveMovement(grid, { ...scout, position }, { kind: 'move', direction }, 1);
    expect(result.outcome).toBe('boundary');
    expect(result.destination).toEqual(position);
    expect(result.headingAfter).toBe(direction);
  });

  it('records an intentional stay with unchanged heading', () => {
    expect(resolveMovement(grid, scout, { kind: 'stay' }, 1)).toEqual({
      tick: 1, scoutId: 'scout-a', origin: scout.position, destination: scout.position,
      attemptedDestination: null, headingBefore: 'east', headingAfter: 'east',
      intent: { kind: 'stay' }, outcome: 'stayed',
    });
  });

  it('cannot obtain multi-cell or diagonal movement through extra intent fields', () => {
    const intent = { kind: 'move' as const, direction: 'east' as const, distance: 20, dx: 5, dy: 5 };
    const result = resolveMovement(grid, scout, intent, 1);
    expect(result.destination).toEqual({ x: 2, y: 1 });
    expect(result.intent).toEqual({ kind: 'move', direction: 'east' });
    expect(() => resolveMovement(grid, scout, {
      kind: 'move', direction: 'northeast' as Heading,
    }, 1)).toThrow('cardinal');
  });

  it('rejects missing or malformed intents without mutating the scout', () => {
    const before = JSON.stringify(scout);
    expect(() => resolveMovement(grid, scout, undefined as unknown as MovementIntent, 1)).toThrow();
    expect(JSON.stringify(scout)).toBe(before);
  });

  it('copies only known coordinate fields into movement results', () => {
    const position = { x: 1, y: 1, terrain: grid };
    const result = resolveMovement(grid, { ...scout, position }, { kind: 'stay' }, 1);
    expect(result.origin).toEqual({ x: 1, y: 1 });
    expect(result.destination).toEqual({ x: 1, y: 1 });
  });
});
