import { describe, expect, it } from 'vitest';
import { TEST_SCENARIO } from '../engine/scenario';
import { cloneSnapshot, serializeSnapshot } from '../engine/snapshot';
import { CANDIDATE_SCENARIO } from './candidate';
import { reachableSurveyIndices, type RunMetrics } from './metrics';
import {
  compareGate, firstDecisionDifference, firstMovementDifference, formatExperiment,
  runBaseline, runRelayExperiment, verifyRepeatedRun,
} from './relay-placement';

function metrics(relayKnownCount: number, timeTo90: number | null = null,
  duplicateDiscoveries = 0, connected = 0): RunMetrics {
  return {
    reachableCellCount: 100, completedTicks: 20,
    coverage: [{ tick: 20, fleetKnownCount: 100, relayKnownCount,
      fleetCoverage: 100, relayCoverage: relayKnownCount, communicationGap: 100 - relayKnownCount }],
    timeTo90, duplicateDiscoveries,
    connectedTicks: { 'scout-a': connected, 'scout-b': connected, 'scout-c': connected },
    connectivityFraction: { 'scout-a': connected / 20, 'scout-b': connected / 20, 'scout-c': connected / 20 },
    meanConnectivityFraction: connected / 20,
  };
}

describe('central-premise gate', () => {
  it('does not treat two unreached times or zero duplicate counts as differences', () => {
    const result = compareGate(['site-a', 'site-b'], metrics(50), metrics(50));
    expect(result.passedCriteria).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.timeTo90Difference).toBeNull();
    expect(result.duplicateRelativeDifference).toBe(0);
  });

  it('requires at least two thresholds in the same pair and includes exact thresholds', () => {
    const first = metrics(50, null, 0, 0);
    const second = metrics(60, null, 0, 3);
    const result = compareGate(['site-a', 'site-b'], first, second);
    expect(result.criteria).toEqual({ relayCoverage: true, timeTo90: false, duplicates: false, connectivity: true });
    expect(result.passed).toBe(true);
    expect(compareGate(['site-a', 'site-b'], first, metrics(60, null, 0, 2)).passed).toBe(false);
  });

  it('handles reached/unreached time and absolute or relative duplicate differences honestly', () => {
    const result = compareGate(['site-a', 'site-b'], metrics(100, 5, 10), metrics(100, 20, 8));
    expect(result.timeTo90Difference).toBe(15);
    expect(result.duplicateDifference).toBe(2);
    expect(result.duplicateRelativeDifference).toBe(0.2);
    expect(result.criteria.timeTo90).toBe(true);
    expect(result.criteria.duplicates).toBe(true);
    expect(result.passed).toBe(true);
    expect(compareGate(['site-a', 'site-b'], metrics(100, 5, 100), metrics(89, null, 95)).criteria)
      .toMatchObject({ timeTo90: true, duplicates: true });
  });

  it('rejects differing run caps or denominators', () => {
    expect(() => compareGate(['site-a', 'site-b'], metrics(50), { ...metrics(50), completedTicks: 19 })).toThrow();
    expect(() => compareGate(['site-a', 'site-b'], metrics(50), { ...metrics(50), reachableCellCount: 99 })).toThrow();
  });
});

describe('headless autonomous runs', () => {
  it('retains tick zero, stops at the exact cap, and rejects invalid caps', () => {
    const zero = runBaseline(TEST_SCENARIO, 'site-a', 0);
    expect(zero.snapshots.map(state => state.tick)).toEqual([0]);
    expect(zero.metrics.completedTicks).toBe(0);
    const capped = runBaseline(TEST_SCENARIO, 'site-a', 3);
    expect(capped.snapshots.map(state => state.tick)).toEqual([0, 1, 2, 3]);
    expect(capped.hashes).toHaveLength(4);
    for (const cap of [-1, 1.5, Infinity, NaN]) {
      expect(() => runBaseline(TEST_SCENARIO, 'site-a', cap)).toThrow(RangeError);
    }
  });

  it('repeats every site with identical states, hashes, and metrics without changing retained snapshots', () => {
    const experiment = runRelayExperiment(TEST_SCENARIO, 8);
    expect(experiment.runs.map(run => run.siteId)).toEqual(['site-a', 'site-b', 'site-c']);
    expect(experiment.runs.every(run => run.metrics.completedTicks === 8)).toBe(true);
    expect(experiment.repeatVerified).toBe(true);
    const original = experiment.runs[0]!;
    const before = original.snapshots.map(serializeSnapshot);
    verifyRepeatedRun(TEST_SCENARIO, original);
    expect(original.snapshots.map(serializeSnapshot)).toEqual(before);
    expect(formatExperiment(experiment)).toContain('not reached');
    expect(formatExperiment(experiment)).toContain('Fleet % | Relay % | Gap pp');
  });

  it('distinguishes a target-only change from actual changed movement', () => {
    const original = runBaseline(TEST_SCENARIO, 'site-a', 1);
    const changed = cloneSnapshot(original.snapshots[1]!);
    const other = { ...original, siteId: 'site-b' as const,
      snapshots: [original.snapshots[0]!, { ...changed,
        scouts: [{ ...changed.scouts[0], target: { x: 8, y: 6 } }, changed.scouts[1], changed.scouts[2]] as const,
      }],
    };
    expect(firstDecisionDifference(original, other)?.tick).toBe(1);
    expect(firstDecisionDifference(original, other)?.sameCurrentScan).toBe(true);
    expect(firstMovementDifference(original, other)).toBeNull();
  });

  it('does not invent decision or movement differences when snapshots are canonically cloned', () => {
    const original = runBaseline(TEST_SCENARIO, 'site-a', 3);
    const cloned = { ...original, snapshots: original.snapshots.map(cloneSnapshot) };
    expect(cloned.snapshots.map(serializeSnapshot)).toEqual(original.snapshots.map(serializeSnapshot));
    expect(firstDecisionDifference(original, cloned)).toBeNull();
    expect(firstMovementDifference(original, cloned)).toBeNull();
  });

  it('keeps all three candidate branches reachable with valid relay positions', () => {
    const reachable = reachableSurveyIndices(CANDIDATE_SCENARIO);
    expect(reachable.length).toBe(CANDIDATE_SCENARIO.groundTruth.cells.filter(cell => cell === 'clear').length);
    for (const site of CANDIDATE_SCENARIO.relaySites) {
      expect(() => runBaseline(CANDIDATE_SCENARIO, site.id, 1)).not.toThrow();
    }
  });
});
