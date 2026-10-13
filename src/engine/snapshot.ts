import type { SimulationState } from './types';

/**
 * Canonical JSON for plain snapshot data: object keys use UTF-16 code-unit
 * order, arrays retain their order, and primitives use JSON's representation.
 * This checks JSON representability, not the SimulationState schema.
 */
export function serializeSnapshot(state: SimulationState): string {
  const ancestors = new Set<object>();

  function encode(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
      case 'string':
      case 'boolean':
        return JSON.stringify(value);
      case 'number':
        if (!Number.isFinite(value)) throw new TypeError('Snapshot numbers must be finite.');
        return JSON.stringify(value);
      case 'object':
        break;
      default:
        throw new TypeError('Snapshot values must be plain JSON data.');
    }

    if (ancestors.has(value)) throw new TypeError('Snapshot data must not contain cycles.');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) {
          throw new TypeError('Snapshot arrays must be plain arrays.');
        }
        if (Reflect.ownKeys(value).length !== value.length + 1) {
          throw new TypeError('Snapshot arrays must be dense and have no extra properties.');
        }
        const elements: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
            throw new TypeError('Snapshot arrays require enumerable data at every index.');
          }
          elements.push(encode(descriptor.value));
        }
        return `[${elements.join(',')}]`;
      }

      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Snapshot objects must be plain objects.');
      }
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => typeof key !== 'string')) {
        throw new TypeError('Snapshot objects cannot have symbol keys.');
      }
      const entries = (keys as string[]).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw new TypeError('Snapshot properties must be enumerable data properties.');
        }
        return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
      });
      return `{${entries.join(',')}}`;
    } finally {
      // A reused child is valid; only a reference to a current ancestor is cyclic.
      ancestors.delete(value);
    }
  }

  return encode(state);
}

/** Deeply detached plain data; callers already own a trusted SimulationState. */
export function cloneSnapshot(state: SimulationState): SimulationState {
  return JSON.parse(serializeSnapshot(state)) as SimulationState;
}

/**
 * Non-security FNV-1a, 32 bits, over canonical JSON. Feed each UTF-16 code unit
 * low byte then high byte; return eight lowercase hexadecimal digits.
 * Hash equality is a useful replay check, not proof that states are identical.
 */
export function hashSnapshot(state: SimulationState): string {
  const serialized = serializeSnapshot(state);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    const codeUnit = serialized.charCodeAt(index);
    hash = Math.imul(hash ^ (codeUnit & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ (codeUnit >>> 8), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
