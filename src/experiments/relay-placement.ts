import { createInitialState } from '../engine/initial-state';
import { hashSnapshot, serializeSnapshot } from '../engine/snapshot';
import { stepBaselineAutonomous } from '../engine/step';
import type { MovementIntent, Position, RelaySiteId, Scenario, ScoutId, SimulationState } from '../engine/types';
import { evaluateRun, type RunMetrics } from './metrics';

export const EXPERIMENT_TICK_CAP = 160;
export const BASELINE_POLICY_VERSION = 'frontier-bfs-v1';

export interface ExperimentRun {
  readonly siteId: RelaySiteId;
  readonly snapshots: readonly SimulationState[];
  readonly hashes: readonly string[];
  readonly metrics: RunMetrics;
}

/** Always runs the full cap, including stays; tick zero is retained separately. */
export function runBaseline(scenario: Scenario, siteId: RelaySiteId, tickCap: number): ExperimentRun {
  if (!Number.isSafeInteger(tickCap) || tickCap < 0) throw new RangeError('Run cap must be a nonnegative safe integer.');
  const snapshots = [createInitialState(scenario, siteId)];
  const hashes = [hashSnapshot(snapshots[0]!)];
  for (let tick = 1; tick <= tickCap; tick++) {
    const next = stepBaselineAutonomous(scenario, snapshots[tick - 1]!);
    snapshots.push(next);
    hashes.push(hashSnapshot(next));
  }
  return { siteId, snapshots, hashes, metrics: evaluateRun(scenario, snapshots) };
}

export function verifyRepeatedRun(scenario: Scenario, original: ExperimentRun): void {
  const repeated = runBaseline(scenario, original.siteId, original.metrics.completedTicks);
  if (JSON.stringify(original.metrics) !== JSON.stringify(repeated.metrics) ||
      JSON.stringify(original.hashes) !== JSON.stringify(repeated.hashes) ||
      original.snapshots.some((snapshot, index) =>
        serializeSnapshot(snapshot) !== serializeSnapshot(repeated.snapshots[index]!))) {
    throw new Error(`Nondeterministic run at ${original.siteId}.`);
  }
}

export interface GateComparison {
  readonly sites: readonly [RelaySiteId, RelaySiteId];
  readonly relayCoverageDifference: number;
  readonly timeTo90Difference: number | null;
  readonly exactlyOneReached90: boolean;
  readonly duplicateDifference: number;
  /** Relative reduction from the higher duplicate count; zero if both zero. */
  readonly duplicateRelativeDifference: number;
  readonly meanConnectivityDifference: number;
  readonly criteria: {
    readonly relayCoverage: boolean;
    readonly timeTo90: boolean;
    readonly duplicates: boolean;
    readonly connectivity: boolean;
  };
  readonly passedCriteria: number;
  readonly passed: boolean;
}

/** Compare one pair at the same completed tick. No cross-pair threshold pooling. */
export function compareGate(
  sites: readonly [RelaySiteId, RelaySiteId], a: RunMetrics, b: RunMetrics,
): GateComparison {
  if (a.completedTicks !== b.completedTicks || a.reachableCellCount !== b.reachableCellCount) {
    throw new TypeError('Gate comparisons require the same tick cap and survey area.');
  }
  const relayCoverageDifference = Math.abs(a.coverage.at(-1)!.relayCoverage - b.coverage.at(-1)!.relayCoverage);
  const timeTo90Difference = a.timeTo90 === null || b.timeTo90 === null ? null : Math.abs(a.timeTo90 - b.timeTo90);
  const exactlyOneReached90 = (a.timeTo90 === null) !== (b.timeTo90 === null);
  const duplicateDifference = Math.abs(a.duplicateDiscoveries - b.duplicateDiscoveries);
  const higherDuplicates = Math.max(a.duplicateDiscoveries, b.duplicateDiscoveries);
  const duplicateRelativeDifference = higherDuplicates === 0 ? 0 : duplicateDifference / higherDuplicates;
  const meanConnectivityDifference = Math.abs(a.meanConnectivityFraction - b.meanConnectivityFraction);
  const criteria = {
    relayCoverage: Math.abs(a.coverage.at(-1)!.relayKnownCount - b.coverage.at(-1)!.relayKnownCount) * 10 >= a.reachableCellCount,
    timeTo90: exactlyOneReached90 || (timeTo90Difference !== null && timeTo90Difference >= 15),
    duplicates: duplicateDifference >= 5 || (higherDuplicates > 0 && duplicateDifference * 5 >= higherDuplicates),
    connectivity: a.completedTicks > 0 && Math.abs(
      Object.values(a.connectedTicks).reduce((sum, count) => sum + count, 0) -
      Object.values(b.connectedTicks).reduce((sum, count) => sum + count, 0),
    ) * 20 >= a.completedTicks * 9,
  };
  const passedCriteria = Object.values(criteria).filter(Boolean).length;
  return {
    sites, relayCoverageDifference, timeTo90Difference, exactlyOneReached90,
    duplicateDifference, duplicateRelativeDifference, meanConnectivityDifference,
    criteria, passedCriteria, passed: passedCriteria >= 2,
  };
}

export interface DecisionDifference {
  readonly tick: number;
  readonly scoutId: ScoutId;
  readonly sites: readonly [RelaySiteId, RelaySiteId];
  readonly decisions: readonly {
    readonly origin: Position;
    readonly target: Position | null;
    readonly intent: MovementIntent;
  }[];
  readonly differingMapCells: number;
  readonly sameCurrentScan: boolean;
}

/** Diagnostic only: identify the first differing decision, not just a changed hash. */
export function firstDecisionDifference(a: ExperimentRun, b: ExperimentRun): DecisionDifference | null {
  for (let index = 1; index < Math.min(a.snapshots.length, b.snapshots.length); index++) {
    for (let scoutIndex = 0; scoutIndex < 3; scoutIndex++) {
      const first = a.snapshots[index]!.scouts[scoutIndex]!;
      const second = b.snapshots[index]!.scouts[scoutIndex]!;
      const decision = (scout: typeof first) => ({
        origin: scout.lastMovement!.origin, target: scout.target, intent: scout.lastMovement!.intent,
      });
      const decisionKey = (scout: typeof first) => {
        const movement = scout.lastMovement!;
        return [movement.origin.x, movement.origin.y, scout.target?.x ?? null, scout.target?.y ?? null,
          movement.intent.kind, movement.intent.kind === 'move' ? movement.intent.direction : null];
      };
      const scanKey = (scout: typeof first) => scout.sensorTelemetry!.observations.map(observation =>
        [observation.scoutId, observation.tick, observation.position.x, observation.position.y, observation.cell]);
      if (JSON.stringify(decisionKey(first)) !== JSON.stringify(decisionKey(second))) {
        return {
          tick: index, scoutId: first.id, sites: [a.siteId, b.siteId],
          decisions: [decision(first), decision(second)],
          differingMapCells: first.localMap.cells.filter((cell, i) => cell !== second.localMap.cells[i]).length,
          sameCurrentScan: JSON.stringify(scanKey(first)) === JSON.stringify(scanKey(second)),
        };
      }
    }
  }
  return null;
}

/** A changed target can still yield the same movement; report that distinction. */
export function firstMovementDifference(a: ExperimentRun, b: ExperimentRun): { tick: number; scoutId: ScoutId } | null {
  for (let tick = 1; tick < Math.min(a.snapshots.length, b.snapshots.length); tick++) {
    for (let index = 0; index < 3; index++) {
      const first = a.snapshots[tick]!.scouts[index]!;
      const second = b.snapshots[tick]!.scouts[index]!;
      const movementKey = (scout: typeof first) => {
        const movement = scout.lastMovement!;
        return [movement.origin.x, movement.origin.y, movement.destination.x, movement.destination.y,
          movement.headingBefore, movement.headingAfter, movement.outcome, movement.intent.kind,
          movement.intent.kind === 'move' ? movement.intent.direction : null];
      };
      if (JSON.stringify(movementKey(first)) !== JSON.stringify(movementKey(second))) {
        return { tick, scoutId: first.id };
      }
    }
  }
  return null;
}

export function runRelayExperiment(scenario: Scenario, tickCap = EXPERIMENT_TICK_CAP) {
  const runs = [...scenario.relaySites].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(site => runBaseline(scenario, site.id, tickCap));
  // Repeat every site; full states and metrics supplement the non-security hashes.
  for (const run of runs) verifyRepeatedRun(scenario, run);
  const comparisons = runs.flatMap((run, i) => runs.slice(i + 1).map(other => ({
    gate: compareGate([run.siteId, other.siteId], run.metrics, other.metrics),
    firstDecisionDifference: firstDecisionDifference(run, other),
    firstMovementDifference: firstMovementDifference(run, other),
  })));
  return { scenarioId: scenario.id, policy: BASELINE_POLICY_VERSION, tickCap, runs, comparisons,
    passed: comparisons.some(comparison => comparison.gate.passed), repeatVerified: true };
}

export function formatExperiment(report: ReturnType<typeof runRelayExperiment>): string {
  const lines = [
    `${report.scenarioId}: ${report.policy}, tick ${report.tickCap}, ${report.runs[0]!.metrics.reachableCellCount} reachable clear cells`,
    '| Site | Fleet % | Relay % | Gap pp | Tick to 90% | Duplicates | Connected A / B / C |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const run of report.runs) {
    const final = run.metrics.coverage.at(-1)!;
    const fractions = (['scout-a', 'scout-b', 'scout-c'] as const)
      .map(id => run.metrics.connectivityFraction[id].toFixed(3)).join(' / ');
    lines.push(`| ${run.siteId} | ${final.fleetCoverage.toFixed(2)} | ${final.relayCoverage.toFixed(2)} | ${final.communicationGap.toFixed(2)} | ${run.metrics.timeTo90 ?? 'not reached'} | ${run.metrics.duplicateDiscoveries} | ${fractions} |`);
  }
  lines.push(`Gate: ${report.passed ? 'PASS' : 'FAIL'}. Repeat states, hashes and metrics: verified.`);
  for (const comparison of report.comparisons) {
    const { gate, firstDecisionDifference: difference } = comparison;
    const passed = Object.entries(gate.criteria).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none';
    lines.push(`${gate.sites.join(' vs ')}: ${gate.passedCriteria}/4 (${passed}); first decision difference: ${difference ? JSON.stringify(difference) : 'none'}`);
    lines.push(`First movement difference: ${comparison.firstMovementDifference ? JSON.stringify(comparison.firstMovementDifference) : 'none'}`);
  }
  return lines.join('\n');
}
