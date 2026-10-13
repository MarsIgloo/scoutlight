import { describe, expect, it } from 'vitest';
import { CANDIDATE_SCENARIO } from '../experiments/candidate';
import { EXPERIMENT_TICK_CAP, runBaseline } from '../experiments/relay-placement';
import { WEST_ROOM_BRIDGE_VARIANT } from '../experiments/route-investigation';
import { generateSeededMission } from '../experiments/seeded-mission';
import { hashSnapshot, serializeSnapshot } from '../engine/snapshot';
import type { Scenario } from '../engine/types';
import { projectInspector, projectScene } from '../rendering/projection';
import { ComparisonRunner, selectComparedRun } from './comparison-runner';
import type { PlaybackSpeed, Scheduler } from './runner';

type Handle = ReturnType<typeof globalThis.setTimeout>;
class ManualScheduler implements Scheduler {
  private next = 1;
  readonly pending = new Map<Handle, { callback: () => void; delay: number }>();
  set(callback: () => void, delay: number): Handle {
    const handle = this.next++ as unknown as Handle;
    this.pending.set(handle, { callback, delay });
    return handle;
  }
  clear(handle: Handle): void { this.pending.delete(handle); }
  first() { return this.pending.values().next().value as { callback: () => void; delay: number }; }
  fire(): void {
    const [handle, task] = this.pending.entries().next().value as [Handle, { callback: () => void; delay: number }];
    this.pending.delete(handle);
    task.callback();
  }
}

const scenarios: readonly [string, Scenario][] = [
  ['original', CANDIDATE_SCENARIO],
  ['west-room', WEST_ROOM_BRIDGE_VARIANT],
  ['seed-0', generateSeededMission(0)],
  ['seed-12345', generateSeededMission(12345)],
];

describe('paired comparison clock', () => {
  it('publishes matched ticks from one timer, and invalidates callbacks on pause, reset and disposal', () => {
    const scheduler = new ManualScheduler();
    const runner = new ComparisonRunner(WEST_ROOM_BRIDGE_VARIANT, scheduler);
    const observed: number[] = [];
    runner.subscribe(() => {
      const view = runner.getSnapshot();
      expect(view.runs['site-a'].state.tick).toBe(view.runs['site-b'].state.tick);
      expect(view.runs['site-a'].history).toHaveLength(view.tick + 1);
      expect(view.runs['site-b'].history).toHaveLength(view.tick + 1);
      observed.push(view.tick);
    });
    expect(runner.getSnapshot()).toMatchObject({ tick: 0, running: false, speed: 1 });
    runner.start(); runner.start();
    expect(scheduler.pending.size).toBe(1);
    expect(scheduler.first().delay).toBe(500);
    runner.step();
    expect(runner.getSnapshot().tick).toBe(0);
    scheduler.fire();
    expect(runner.getSnapshot().tick).toBe(1);
    runner.setSpeed(4);
    expect(scheduler.pending.size).toBe(1);
    expect(scheduler.first().delay).toBe(125);
    const stalePause = scheduler.first().callback;
    runner.pause(); stalePause();
    expect(runner.getSnapshot().tick).toBe(1);
    runner.step();
    expect(runner.getSnapshot().tick).toBe(2);
    runner.start();
    const staleReset = scheduler.first().callback;
    runner.reset(); staleReset();
    expect(runner.getSnapshot()).toMatchObject({ tick: 0, running: false, speed: 4, generation: 1 });
    expect(scheduler.pending.size).toBe(0);
    runner.start();
    const staleDispose = scheduler.first().callback;
    runner.dispose(); staleDispose(); runner.step(); runner.start();
    expect(runner.getSnapshot().tick).toBe(0);
    expect(scheduler.pending.size).toBe(0);
    expect(observed).toContain(2);
  });

  it('switches presentation without changing either run or mixing projection and inspector data', () => {
    const runner = new ComparisonRunner(WEST_ROOM_BRIDGE_VARIANT, new ManualScheduler());
    runner.step();
    const view = runner.getSnapshot();
    const before = JSON.stringify(view);
    const a = selectComparedRun(view, 'site-a');
    const b = selectComparedRun(view, 'site-b');
    expect(a.state.scouts[0]?.position).toStrictEqual({ x: 3, y: 2 });
    expect(b.state.scouts[0]?.position).toStrictEqual({ x: 4, y: 1 });
    const options = { selected: 'scout-a' as const, knowledge: 'relay' as const,
      trails: true, rays: true, links: true };
    for (const [site, run] of [['site-a', a], ['site-b', b]] as const) {
      const scene = projectScene(run.state, run.history, options);
      expect(scene.relay.label).toBe(site === 'site-a' ? 'A' : 'B');
      expect(scene.scouts[0]?.position).toStrictEqual(run.state.scouts[0]?.position);
      expect(scene.scouts[0]?.trail.at(-1)).toStrictEqual(run.state.scouts[0]?.position);
      expect(scene.map.cells).toStrictEqual(run.state.relay.sharedMap.cells);
      expect(projectInspector(run.state, 'scout-a').position)
        .toBe(`${run.state.scouts[0]!.position.x}, ${run.state.scouts[0]!.position.y}`);
    }
    expect(JSON.stringify(runner.getSnapshot())).toBe(before);
    runner.dispose();
  });

  it.each(scenarios)('matches independent full histories, hashes, and metrics for %s', (_, scenario) => {
    const expectedA = runBaseline(scenario, 'site-a', EXPERIMENT_TICK_CAP);
    const expectedB = runBaseline(scenario, 'site-b', EXPERIMENT_TICK_CAP);
    const runner = new ComparisonRunner(scenario, new ManualScheduler());
    for (let tick = 0; tick < EXPERIMENT_TICK_CAP; tick++) runner.step();
    const view = runner.getSnapshot();
    expect(view).toMatchObject({ tick: 160, running: false, complete: true });
    for (const [site, expected] of [['site-a', expectedA], ['site-b', expectedB]] as const) {
      const actual = view.runs[site];
      expect(actual.metrics).toStrictEqual(expected.metrics);
      expect(actual.history.map(serializeSnapshot)).toStrictEqual(expected.snapshots.map(serializeSnapshot));
      expect(actual.history.map(hashSnapshot)).toStrictEqual(expected.hashes);
    }
    if (scenario === CANDIDATE_SCENARIO) {
      expect(view.runs['site-a'].history.map(state => state.scouts.map(scout => scout.position)))
        .toStrictEqual(view.runs['site-b'].history.map(state => state.scouts.map(scout => scout.position)));
      expect(view.runs['site-a'].metrics.coverage.at(-1)!.relayCoverage).toBeLessThan(
        view.runs['site-b'].metrics.coverage.at(-1)!.relayCoverage);
    }
    runner.dispose();
  }, 30_000);

  it.each([1, 2, 4] as readonly PlaybackSpeed[])('is playback-speed independent at %s×', speed => {
    const scenario = generateSeededMission(12345);
    const scheduler = new ManualScheduler();
    const runner = new ComparisonRunner(scenario, scheduler);
    runner.setSpeed(speed);
    runner.start();
    for (let tick = 0; tick < EXPERIMENT_TICK_CAP; tick++) {
      expect(scheduler.pending.size).toBe(1);
      expect(scheduler.first().delay).toBe(500 / speed);
      scheduler.fire();
    }
    const view = runner.getSnapshot();
    expect(view).toMatchObject({ tick: 160, running: false, complete: true });
    expect(scheduler.pending.size).toBe(0);
    for (const site of ['site-a', 'site-b'] as const) {
      const expected = runBaseline(scenario, site, EXPERIMENT_TICK_CAP);
      expect(view.runs[site].history.map(serializeSnapshot)).toStrictEqual(expected.snapshots.map(serializeSnapshot));
      expect(view.runs[site].metrics).toStrictEqual(expected.metrics);
    }
    runner.dispose();
  }, 30_000);
});
