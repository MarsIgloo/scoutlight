import { describe, expect, it } from 'vitest';
import { WEST_ROOM_BRIDGE_VARIANT } from '../experiments/route-investigation';
import { DEFAULT_MISSION_SEED, generateSeededMission } from '../experiments/seeded-mission';
import { selectAppScenario } from './scenario-selection';

describe('app scenario selection', () => {
  it.each([false, true])('opens the seeded public default in development=%s without a fallback notice', development => {
    const selected = selectAppScenario('', development);
    expect(selected.scenario).toStrictEqual(generateSeededMission(DEFAULT_MISSION_SEED));
    expect(selected).toMatchObject({ compareAB: false, missionEntry: 'public',
      mission: { seed: 12345, usedDefault: false, canonicalSearch: '?seed=12345&v=1' } });
    expect(selected.reviewLabel).toBe('Mission v1 · seed 12345');
  });

  it.each([false, true])('refreshes saved missions and compares only with compare=ab in development=%s', development => {
    for (const seed of [0, 42, 4294967295]) {
      for (const compare of ['', '&compare=ab', '&compare=other&mode=ab']) {
        const selected = selectAppScenario(`?seed=${seed}&v=1${compare}`, development);
        expect(selected.scenario).toStrictEqual(generateSeededMission(seed));
        expect(selected).toMatchObject({ missionEntry: 'public', compareAB: compare === '&compare=ab',
          mission: { seed, usedDefault: false } });
        expect(selected.mission?.canonicalSearch).toBe(`?seed=${seed}&v=1${compare === '&compare=ab' ? compare : ''}`);
      }
    }
  });

  it.each([false, true])('preserves preview alias missions and mode in development=%s', development => {
    for (const compare of ['', '&compare=ab']) {
      expect(selectAppScenario(`?preview=release&seed=12345&v=1${compare}`, development))
        .toStrictEqual(selectAppScenario(`?seed=12345&v=1${compare}`, development));
    }
    expect(selectAppScenario('?preview=release&review=west-room&seed=0&v=1', development).scenario)
      .toStrictEqual(generateSeededMission(0));
  });

  it.each([false, true])('shows a reproducible fallback for invalid supplied seed/version in development=%s', development => {
    for (const search of ['?seed=invalid', '?seed=9&v=2&compare=ab']) {
      const selected = selectAppScenario(search, development);
      expect(selected.scenario).toStrictEqual(generateSeededMission(DEFAULT_MISSION_SEED));
      expect(selected.reviewLabel).toContain('invalid link; using default');
      expect(selected.mission?.canonicalSearch).toBe(`?seed=12345&v=1${search.includes('compare=ab') ? '&compare=ab' : ''}`);
    }
  });

  it('retains the exact west-room development review, including optional comparison', () => {
    for (const compare of ['', '&compare=ab']) {
      const selected = selectAppScenario(`?review=west-room${compare}`, true);
      expect(selected.scenario).toBe(WEST_ROOM_BRIDGE_VARIANT);
      expect(selected.reviewLabel).toBe('West-room review');
      expect(selected.mission).toBeNull();
      expect(selected.compareAB).toBe(compare === '&compare=ab');
      expect(selected.relayRationale['site-b']).toContain('exchange scans before their first move');
      expect(selected.help).toContain('first moves north with B and west with A');
    }
  });

  it('preserves saved development mission-review URLs through canonicalization', () => {
    const selected = selectAppScenario('?review=missions&seed=42&v=1&compare=ab', true);
    expect(selected.scenario).toStrictEqual(generateSeededMission(42));
    expect(selected).toMatchObject({ missionEntry: 'review', compareAB: true,
      mission: { seed: 42, usedDefault: false, canonicalSearch: '?review=missions&seed=42&v=1&compare=ab' } });
    expect(selectAppScenario('?review=missions&seed=invalid', true).mission?.canonicalSearch)
      .toBe('?review=missions&seed=12345&v=1');
  });

  it('does not expose development reviews in production and removes unknown entry markers', () => {
    for (const [search, development] of [
      ['?review=west-room', false], ['?review=missions', false], ['?review=unknown', true],
      ['?preview=unknown', false], ['?other=west-room', true],
    ] as const) {
      expect(selectAppScenario(search, development)).toStrictEqual(selectAppScenario('', development));
    }
    expect(selectAppScenario('?review=missions&seed=42&v=1&compare=ab', false))
      .toStrictEqual(selectAppScenario('?seed=42&v=1&compare=ab', false));
    expect(selectAppScenario('?review=west-room&compare=ab', false))
      .toStrictEqual(selectAppScenario('?compare=ab', false));
  });
});
