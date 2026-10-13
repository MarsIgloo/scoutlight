import { describe, expect, it } from 'vitest';
import { createInitialState } from './initial-state';
import { TEST_SCENARIO } from './scenario';
import type { Scenario } from './types';

describe('authored overlap rules', () => {
  it('rejects distinct scout IDs on the same starting cell', () => {
    const scenario: Scenario = {
      ...TEST_SCENARIO,
      scouts: [TEST_SCENARIO.scouts[0], {
        ...TEST_SCENARIO.scouts[1], position: TEST_SCENARIO.scouts[0].position,
      }, TEST_SCENARIO.scouts[2]],
    };
    expect(() => createInitialState(scenario, 'site-a')).toThrow('Scouts must start');
  });

  it.each(['site-a', 'site-b', 'site-c'] as const)(
    'rejects a relay/start overlap even when selecting %s', selected => {
      const scenario: Scenario = {
        ...TEST_SCENARIO,
        relaySites: [TEST_SCENARIO.relaySites[0], TEST_SCENARIO.relaySites[1], {
          ...TEST_SCENARIO.relaySites[2], position: TEST_SCENARIO.scouts[1].position,
        }],
      };
      expect(() => createInitialState(scenario, selected)).toThrow('must not overlap');
    },
  );
});
