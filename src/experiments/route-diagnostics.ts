import type { ScoutId } from '../engine/types';
import type { ExperimentRun } from './relay-placement';

const SCOUT_IDS = ['scout-a', 'scout-b', 'scout-c'] as const;

export interface DivergentInterval {
  readonly startTick: number;
  readonly endTick: number;
  /** First matching position after the interval, or null if still apart at the cap. */
  readonly reconvergedAt: number | null;
}

export interface ScoutRouteDifference {
  readonly scoutId: ScoutId;
  readonly firstTick: number | null;
  readonly divergentTicks: number;
  readonly intervals: readonly DivergentInterval[];
}

/** Compare physical positions only. Changed headings, intents, and targets are not routes. */
export function comparePositionRoutes(a: ExperimentRun, b: ExperimentRun): readonly ScoutRouteDifference[] {
  if (a.snapshots.length !== b.snapshots.length || a.metrics.completedTicks !== b.metrics.completedTicks ||
    a.snapshots.length !== a.metrics.completedTicks + 1 ||
    a.snapshots[0]?.config.scenarioId !== b.snapshots[0]?.config.scenarioId ||
    a.snapshots[0]?.config.scenarioVersion !== b.snapshots[0]?.config.scenarioVersion ||
    a.snapshots[0]?.config.communicationRange !== b.snapshots[0]?.config.communicationRange) {
    throw new TypeError('Physical route comparisons require the same scenario and tick cap.');
  }
  return SCOUT_IDS.map((scoutId, scoutIndex) => {
    let start: number | null = null;
    let divergentTicks = 0;
    const intervals: DivergentInterval[] = [];
    for (let tick = 0; tick < a.snapshots.length; tick++) {
      const first = a.snapshots[tick];
      const second = b.snapshots[tick];
      if (first?.tick !== tick || second?.tick !== tick ||
        first.scouts[scoutIndex]?.id !== scoutId || second.scouts[scoutIndex]?.id !== scoutId) {
        throw new TypeError('Physical route comparisons require canonical, consecutive snapshots.');
      }
      const p = first.scouts[scoutIndex]!.position;
      const q = second.scouts[scoutIndex]!.position;
      const apart = p.x !== q.x || p.y !== q.y;
      if (tick === 0 && apart) throw new TypeError('Relay sites must share scout starting positions.');
      if (apart) {
        divergentTicks++;
        if (start === null) start = tick;
      } else if (start !== null) {
        intervals.push({ startTick: start, endTick: tick - 1, reconvergedAt: tick });
        start = null;
      }
    }
    if (start !== null) intervals.push({ startTick: start, endTick: a.metrics.completedTicks, reconvergedAt: null });
    return { scoutId, firstTick: intervals[0]?.startTick ?? null, divergentTicks, intervals };
  });
}
