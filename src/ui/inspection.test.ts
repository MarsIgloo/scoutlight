import { describe, expect, it } from 'vitest';
import { initialInspection, inspectionReducer } from './inspection';

describe('contextual scout inspection', () => {
  it('starts in Fleet and opens Scout knowledge only after inspection', () => {
    expect(initialInspection.inspected).toBeNull();
    expect(initialInspection.knowledge).toBe('fleet');
    expect(initialInspection.lastGlobalView).toBe('fleet');
    expect(inspectionReducer(initialInspection, { type: 'knowledge', view: 'scout' })).toEqual(initialInspection);
    const first = inspectionReducer(initialInspection, { type: 'inspect', scout: 'scout-b' });
    const local = inspectionReducer(first, { type: 'knowledge', view: 'scout' });
    expect(local).toEqual({ selected: 'scout-b', inspected: 'scout-b', knowledge: 'scout', lastGlobalView: 'fleet' });
    expect(inspectionReducer(local, { type: 'inspect', scout: 'scout-c' })).toEqual({
      selected: 'scout-c', inspected: 'scout-c', knowledge: 'scout', lastGlobalView: 'fleet',
    });
  });

  it('returns to the most recently chosen global view after Scout inspection', () => {
    const inspected = inspectionReducer(initialInspection, { type: 'inspect', scout: 'scout-c' });
    const local = inspectionReducer(inspected, { type: 'knowledge', view: 'scout' });
    expect(inspectionReducer(local, { type: 'dismiss' }).knowledge).toBe('fleet');

    const relay = inspectionReducer(initialInspection, { type: 'knowledge', view: 'relay' });
    const relayScout = inspectionReducer(inspectionReducer(relay, { type: 'inspect', scout: 'scout-a' }),
      { type: 'knowledge', view: 'scout' });
    expect(inspectionReducer(relayScout, { type: 'dismiss' })).toEqual({
      selected: 'scout-a', inspected: null, knowledge: 'relay', lastGlobalView: 'relay',
    });

    const fleet = inspectionReducer(relayScout, { type: 'knowledge', view: 'fleet' });
    const fleetScout = inspectionReducer(fleet, { type: 'knowledge', view: 'scout' });
    expect(inspectionReducer(fleetScout, { type: 'dismiss' }).knowledge).toBe('fleet');
  });

  it('keeps Scout view while changing inspected scouts and retains the global choice', () => {
    const relay = inspectionReducer(initialInspection, { type: 'knowledge', view: 'relay' });
    const a = inspectionReducer(relay, { type: 'inspect', scout: 'scout-a' });
    const local = inspectionReducer(a, { type: 'knowledge', view: 'scout' });
    const b = inspectionReducer(local, { type: 'inspect', scout: 'scout-b' });
    const c = inspectionReducer(b, { type: 'inspect', scout: 'scout-c' });
    expect(c).toEqual({ selected: 'scout-c', inspected: 'scout-c', knowledge: 'scout', lastGlobalView: 'relay' });
    expect(inspectionReducer(c, { type: 'dismiss' }).knowledge).toBe('relay');
  });
});
