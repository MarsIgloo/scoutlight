import { describe, expect, it } from 'vitest';
import { createInitialState } from './initial-state';
import { TEST_SCENARIO } from './scenario';
import { cloneSnapshot, hashSnapshot, serializeSnapshot } from './snapshot';
import type { CellState, SimulationState } from './types';

// Small untyped fixtures exercise the JSON contract without pretending to
// validate imported SimulationState schemas, which is outside this module.
function fixture(value: unknown): SimulationState {
  return value as SimulationState;
}

function objectsIn(value: unknown): object[] {
  if (value === null || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(objectsIn)];
}

describe('snapshot serialization', () => {
  it('sorts every object by code-unit key order, including numeric-looking keys', () => {
    const state = fixture({ z: { b: 2, a: 1 }, '2': 'two', a: true, '10': 'ten', A: null });
    expect(serializeSnapshot(state)).toBe(
      '{"10":"ten","2":"two","A":null,"a":true,"z":{"a":1,"b":2}}',
    );
    expect(serializeSnapshot(fixture({ a: true, A: null, '10': 'ten', '2': 'two', z: { a: 1, b: 2 } })))
      .toBe(serializeSnapshot(state));
  });

  it('preserves semantic array order and standard JSON escaping', () => {
    expect(serializeSnapshot(fixture({ values: [3, 1, 2], text: '"\n\\' })))
      .toBe('{"text":"\\\"\\n\\\\","values":[3,1,2]}');
  });

  it('round-trips real state through canonical JSON without data loss', () => {
    const state = createInitialState(TEST_SCENARIO, 'site-b');
    const serialized = serializeSnapshot(state);
    const restored: SimulationState = JSON.parse(serialized);
    expect(restored).toStrictEqual(state);
    expect(serializeSnapshot(restored)).toBe(serialized);
  });

  it('clones every nested object and detaches repeated child references', () => {
    const state = createInitialState(TEST_SCENARIO, 'site-a');
    const clone = cloneSnapshot(state);
    expect(clone).toStrictEqual(state);
    const originals = new Set(objectsIn(state));
    expect(objectsIn(clone).some(object => originals.has(object))).toBe(false);
    (clone.scouts[0].localMap.cells as CellState[])[0] = 'blocked';
    expect(state.scouts[0].localMap.cells[0]).toBe('unknown');

    const child = { value: 1 };
    const shared = cloneSnapshot(fixture({ a: child, b: child })) as unknown as {
      a: { value: number }; b: { value: number };
    };
    expect(shared.a).toEqual(shared.b);
    expect(shared.a).not.toBe(shared.b);
    expect(shared.a).not.toBe(child);
  });

  it('accepts frozen and null-prototype plain data without invoking hooks', () => {
    const data = Object.create(null) as Record<string, unknown>;
    data.value = Object.freeze([Object.freeze({ x: 1 })]);
    expect(serializeSnapshot(fixture(data))).toBe('{"value":[{"x":1}]}');
  });

  it.each([
    ['NaN', NaN], ['infinity', Infinity], ['negative infinity', -Infinity],
    ['undefined', undefined], ['function', () => 1], ['symbol', Symbol('value')],
    ['bigint', 1n], ['Date', new Date(0)], ['Map', new Map()], ['Set', new Set()],
    ['class instance', new (class Value { x = 1; })()],
  ])('rejects unsupported nested value: %s', (_name, value) => {
    expect(() => serializeSnapshot(fixture({ nested: [value] }))).toThrow(TypeError);
    expect(() => cloneSnapshot(fixture({ nested: [value] }))).toThrow(TypeError);
    expect(() => hashSnapshot(fixture({ nested: [value] }))).toThrow(TypeError);
  });

  it('rejects a sparse array rather than replacing holes with null', () => {
    expect(() => serializeSnapshot(fixture({ cells: new Array(2) }))).toThrow(TypeError);
  });

  it('rejects object and array cycles while allowing shared noncyclic children', () => {
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push(array);
    expect(() => serializeSnapshot(fixture(object))).toThrow('cycles');
    expect(() => serializeSnapshot(fixture(array))).toThrow('cycles');
    const shared = { x: 1 };
    expect(serializeSnapshot(fixture({ a: shared, b: shared })))
      .toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('rejects properties that ordinary JSON would omit or execute', () => {
    const symbolKey = { [Symbol('hidden')]: 1 };
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { getterCalls += 1; return 1; },
    });
    const arrayWithExtra = Object.assign([1], { extra: 2 });
    for (const value of [symbolKey, hidden, accessor, arrayWithExtra]) {
      expect(() => serializeSnapshot(fixture(value))).toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);
  });
});

describe('snapshot hashing', () => {
  it.each([
    [{}, '977eb84b'],
    [{ x: 1 }, '74787908'],
    [{ text: '😀' }, 'ea5c598b'],
  ])('matches a fixed FNV-1a UTF-16LE test vector: %j', (value, expected) => {
    // Independently calculated by iterating the bytes of UTF-16LE JSON.
    expect(hashSnapshot(fixture(value))).toBe(expected);
  });

  it('gives identical meaningful states the same hash regardless of insertion order', () => {
    const first = createInitialState(TEST_SCENARIO, 'site-a');
    const reordered = {
      relay: first.relay, scouts: first.scouts, tick: first.tick,
      config: { ...first.config }, schemaVersion: first.schemaVersion,
    };
    expect(hashSnapshot(first)).toBe(hashSnapshot(reordered));
    expect(hashSnapshot(first)).toBe(hashSnapshot(cloneSnapshot(first)));
    expect(hashSnapshot(first)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('distinguishes meaningful field changes in these fixtures; collisions remain possible', () => {
    const state = createInitialState(TEST_SCENARIO, 'site-a');
    const changedMap = cloneSnapshot(state);
    (changedMap.scouts[0].localMap.cells as CellState[])[0] = 'blocked';
    const fixtures = [state, { ...state, tick: 1 }, changedMap,
      createInitialState(TEST_SCENARIO, 'site-c')];
    expect(new Set(fixtures.map(hashSnapshot)).size).toBe(fixtures.length);
    expect(hashSnapshot(fixture({ observations: [1, 2] })))
      .not.toBe(hashSnapshot(fixture({ observations: [2, 1] })));
  });
});
