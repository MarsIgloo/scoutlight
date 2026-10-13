import { describe, expect, it } from 'vitest';
import { CANDIDATE_SCENARIO } from '../experiments/candidate';
import { EXPERIMENT_TICK_CAP, runBaseline } from '../experiments/relay-placement';
import { WEST_ROOM_BRIDGE_VARIANT } from '../experiments/route-investigation';
import { generateSeededMission } from '../experiments/seeded-mission';
import { hashSnapshot, serializeSnapshot } from '../engine/snapshot';
import type { RelaySiteId } from '../engine/types';
import { SimulationRunner, type Scheduler, type PlaybackSpeed } from './runner';

type Handle = ReturnType<typeof globalThis.setTimeout>;

class ManualScheduler implements Scheduler {
  private next = 1;
  readonly pending = new Map<Handle, { callback: () => void; delay: number }>();
  readonly cleared = new Set<Handle>();

  set(callback: () => void, delay: number): Handle {
    const handle = this.next++ as unknown as Handle;
    this.pending.set(handle, { callback, delay });
    return handle;
  }
  clear(handle: Handle): void {
    this.cleared.add(handle);
    this.pending.delete(handle);
  }
  fire(): void {
    const [handle, task] = this.pending.entries().next().value as [Handle, { callback: () => void; delay: number }];
    this.pending.delete(handle);
    task.callback();
  }
  first(): { callback: () => void; delay: number } {
    return this.pending.values().next().value as { callback: () => void; delay: number };
  }
}

describe('single-run controller', () => {
  it('starts once, pauses, single-steps only while paused, and reschedules speed without duplicate timers', () => {
    const scheduler = new ManualScheduler();
    const runner = new SimulationRunner(CANDIDATE_SCENARIO, 'site-a', scheduler);
    expect(runner.getSnapshot()).toMatchObject({ running: false, speed: 1, complete: false });
    expect(runner.getSnapshot().history).toHaveLength(1);
    runner.start();
    runner.start();
    expect(scheduler.pending.size).toBe(1);
    expect(scheduler.first().delay).toBe(500);
    runner.step();
    expect(runner.getSnapshot().state.tick).toBe(0);
    scheduler.fire();
    expect(runner.getSnapshot().state.tick).toBe(1);
    expect(scheduler.pending.size).toBe(1);
    runner.setSpeed(4);
    expect(scheduler.pending.size).toBe(1);
    expect(scheduler.first().delay).toBe(125);
    runner.pause();
    expect(scheduler.pending.size).toBe(0);
    runner.step();
    expect(runner.getSnapshot().state.tick).toBe(2);
    expect(runner.getSnapshot().history).toHaveLength(3);
    runner.dispose();
    runner.start();
    runner.step();
    expect(runner.getSnapshot().state.tick).toBe(2);
  });

  it('invalidates cleared callbacks on pause, reset, relay change, and disposal', () => {
    const scheduler = new ManualScheduler();
    const runner = new SimulationRunner(CANDIDATE_SCENARIO, 'site-a', scheduler);
    runner.start();
    const old = scheduler.first().callback;
    runner.reset('site-b');
    old();
    expect(runner.getSnapshot().state.tick).toBe(0);
    expect(runner.getSnapshot().state.config.relaySiteId).toBe('site-b');
    expect(runner.getSnapshot().history).toHaveLength(1);
    expect(runner.getSnapshot().running).toBe(false);
    runner.start();
    const second = scheduler.first().callback;
    runner.pause();
    second();
    expect(runner.getSnapshot().state.tick).toBe(0);
    runner.start();
    const third = scheduler.first().callback;
    runner.dispose();
    third();
    expect(runner.getSnapshot().state.tick).toBe(0);
    expect(scheduler.pending.size).toBe(0);
  });

  it.each([
    ['site-a', 1], ['site-b', 2], ['site-c', 4],
  ] as readonly (readonly [RelaySiteId, PlaybackSpeed])[])(
    'matches every headless snapshot and metric at the cap for %s at %s×',
    (site, speed) => {
      const expected = runBaseline(CANDIDATE_SCENARIO, site, EXPERIMENT_TICK_CAP);
      const runner = new SimulationRunner(CANDIDATE_SCENARIO, site, new ManualScheduler());
      runner.setSpeed(speed);
      for (let tick = 0; tick < EXPERIMENT_TICK_CAP; tick++) runner.step();
      const view = runner.getSnapshot();
      expect(view.complete).toBe(true);
      expect(view.running).toBe(false);
      expect(view.history).toHaveLength(EXPERIMENT_TICK_CAP + 1);
      expect(view.metrics).toStrictEqual(expected.metrics);
      expect(view.history.map(serializeSnapshot)).toStrictEqual(expected.snapshots.map(serializeSnapshot));
      expect(view.history.map(hashSnapshot)).toStrictEqual(expected.hashes);
      runner.step();
      runner.start();
      expect(runner.getSnapshot()).toBe(view);
      runner.reset();
      expect(runner.getSnapshot()).toMatchObject({ complete: false, running: false, generation: 1 });
      expect(runner.getSnapshot().history).toHaveLength(1);
    }, 30_000,
  );
});

describe('west-room review runner', () => {
  it.each(['site-a', 'site-b', 'site-c'] as const)(
    'matches the headless positions, full states, and metrics through tick 160 at %s',
    site => {
      const expected = runBaseline(WEST_ROOM_BRIDGE_VARIANT, site, EXPERIMENT_TICK_CAP);
      const runner = new SimulationRunner(WEST_ROOM_BRIDGE_VARIANT, site, new ManualScheduler());
      for (let tick = 0; tick < EXPERIMENT_TICK_CAP; tick++) runner.step();
      const view = runner.getSnapshot();
      expect(view.complete).toBe(true);
      expect(view.history.map(state => state.scouts.map(scout => scout.position)))
        .toStrictEqual(expected.snapshots.map(state => state.scouts.map(scout => scout.position)));
      expect(view.history.map(serializeSnapshot)).toStrictEqual(expected.snapshots.map(serializeSnapshot));
      expect(view.history.map(hashSnapshot)).toStrictEqual(expected.hashes);
      expect(view.metrics).toStrictEqual(expected.metrics);
      runner.dispose();
    }, 30_000,
  );

  it('starts paused at Relay A, preserves the variant on site changes, and clears history on reset', () => {
    const runner = new SimulationRunner(WEST_ROOM_BRIDGE_VARIANT, 'site-a', new ManualScheduler());
    expect(runner.getSnapshot()).toMatchObject({ running: false, complete: false });
    expect(runner.getSnapshot().state).toMatchObject({ tick: 0, config: {
      scenarioId: WEST_ROOM_BRIDGE_VARIANT.id, relaySiteId: 'site-a',
    } });
    runner.step();
    expect(runner.getSnapshot().state.scouts.find(scout => scout.id === 'scout-a')?.position)
      .toStrictEqual({ x: 3, y: 2 });
    runner.reset('site-b');
    expect(runner.getSnapshot().history).toHaveLength(1);
    expect(runner.getSnapshot()).toMatchObject({ running: false, complete: false });
    expect(runner.getSnapshot().state).toMatchObject({ tick: 0, config: {
      scenarioId: WEST_ROOM_BRIDGE_VARIANT.id, relaySiteId: 'site-b',
    } });
    runner.step();
    expect(runner.getSnapshot().state.scouts.find(scout => scout.id === 'scout-a')?.position)
      .toStrictEqual({ x: 4, y: 1 });
    runner.reset();
    expect(runner.getSnapshot().history).toHaveLength(1);
    expect(runner.getSnapshot().state).toMatchObject({ tick: 0, config: {
      scenarioId: WEST_ROOM_BRIDGE_VARIANT.id, relaySiteId: 'site-b',
    } });
    runner.dispose();
  });
});

describe('seeded-mission review runner', () => {
  it.each([1, 2, 4] as readonly PlaybackSpeed[])('matches the same headless history at %s× timed playback', speed => {
    const scenario = generateSeededMission(12345);
    const expected = runBaseline(scenario, 'site-b', EXPERIMENT_TICK_CAP);
    const scheduler = new ManualScheduler();
    const runner = new SimulationRunner(scenario, 'site-b', scheduler);
    runner.setSpeed(speed);
    runner.start();
    for (let tick = 0; tick < EXPERIMENT_TICK_CAP; tick++) scheduler.fire();
    const view = runner.getSnapshot();
    expect(view.complete).toBe(true);
    expect(view.running).toBe(false);
    expect(scheduler.pending.size).toBe(0);
    expect(view.metrics).toStrictEqual(expected.metrics);
    expect(view.history.map(serializeSnapshot)).toStrictEqual(expected.snapshots.map(serializeSnapshot));
    runner.dispose();
  }, 30_000);

  it('keeps Reset and relay changes in one mission, then starts a clean different mission', () => {
    const scheduler = new ManualScheduler();
    const first = new SimulationRunner(generateSeededMission(12345), 'site-a', scheduler);
    first.start();
    scheduler.fire();
    const stale = scheduler.first().callback;
    first.reset('site-c');
    stale();
    expect(first.getSnapshot().history).toHaveLength(1);
    expect(first.getSnapshot().state).toMatchObject({ tick: 0, config: {
      scenarioId: 'seeded-rooms-v1-12345', relaySiteId: 'site-c', communicationRange: 6,
    } });
    first.step();
    first.reset();
    expect(first.getSnapshot().history).toHaveLength(1);
    expect(first.getSnapshot().state.config.relaySiteId).toBe('site-c');
    first.dispose();

    const next = new SimulationRunner(generateSeededMission(1), 'site-a', scheduler);
    expect(next.getSnapshot()).toMatchObject({ running: false, complete: false });
    expect(next.getSnapshot().history).toHaveLength(1);
    expect(next.getSnapshot().state).toMatchObject({ tick: 0, config: {
      scenarioId: 'seeded-rooms-v1-1', relaySiteId: 'site-a', communicationRange: 6,
    } });
    expect(next.getSnapshot().state.scouts.every(scout => scout.localMap.cells.every(cell => cell === 'unknown'))).toBe(true);
    next.dispose();
  });
});
