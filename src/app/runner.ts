import { createInitialState } from '../engine/initial-state';
import { stepBaselineAutonomous } from '../engine/step';
import type { RelaySiteId, Scenario, SimulationState } from '../engine/types';
import { evaluateRun, type RunMetrics } from '../experiments/metrics';
import { EXPERIMENT_TICK_CAP } from '../experiments/relay-placement';

export type PlaybackSpeed = 1 | 2 | 4;
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
export interface Scheduler {
  set(callback: () => void, delay: number): TimerHandle;
  clear(handle: TimerHandle): void;
}
const clock: Scheduler = {
  set: (callback, delay) => globalThis.setTimeout(callback, delay),
  clear: handle => globalThis.clearTimeout(handle),
};
export interface RunView {
  readonly state: SimulationState;
  readonly history: readonly SimulationState[];
  readonly metrics: RunMetrics;
  readonly running: boolean;
  readonly speed: PlaybackSpeed;
  readonly generation: number;
  readonly complete: boolean;
}

/** Owns the simulation clock. Rendering and React only subscribe to completed ticks. */
export class SimulationRunner {
  private view: RunView;
  private timer: TimerHandle | undefined;
  private timerVersion = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly scenario: Scenario, site: RelaySiteId = 'site-a',
    private readonly scheduler: Scheduler = clock) {
    this.view = this.fresh(site, 0, 1);
  }

  readonly getSnapshot = (): RunView => this.view;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start(): void {
    if (this.disposed || this.view.running || this.view.complete) return;
    this.view = { ...this.view, running: true };
    this.publish();
    this.schedule();
  }

  pause(): void {
    this.cancelTimer();
    if (!this.view.running) return;
    this.view = { ...this.view, running: false };
    this.publish();
  }

  step(): void {
    if (!this.disposed && !this.view.running && !this.view.complete) this.advance();
  }

  setSpeed(speed: PlaybackSpeed): void {
    if (this.disposed || speed === this.view.speed) return;
    this.cancelTimer();
    this.view = { ...this.view, speed };
    this.publish();
    this.schedule();
  }

  reset(site: RelaySiteId = this.view.state.config.relaySiteId): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.view = this.fresh(site, this.view.generation + 1, this.view.speed);
    this.publish();
  }

  dispose(): void {
    this.pause();
    this.disposed = true;
    this.listeners.clear();
  }

  private fresh(site: RelaySiteId, generation: number, speed: PlaybackSpeed): RunView {
    const state = createInitialState(this.scenario, site);
    const history = [state];
    return { state, history, metrics: evaluateRun(this.scenario, history), running: false,
      speed, generation, complete: false };
  }

  private advance(): void {
    const state = stepBaselineAutonomous(this.scenario, this.view.state);
    const history = [...this.view.history, state];
    const complete = state.tick >= EXPERIMENT_TICK_CAP;
    this.view = { ...this.view, state, history, metrics: evaluateRun(this.scenario, history),
      complete, running: this.view.running && !complete };
    this.publish();
  }

  private schedule(): void {
    if (this.disposed || !this.view.running || this.timer !== undefined) return;
    const version = this.timerVersion;
    this.timer = this.scheduler.set(() => {
      if (version !== this.timerVersion || this.disposed || !this.view.running) return;
      this.timer = undefined;
      this.advance();
      this.schedule();
    }, 500 / this.view.speed);
  }

  private cancelTimer(): void {
    this.timerVersion++;
    if (this.timer !== undefined) this.scheduler.clear(this.timer);
    this.timer = undefined;
  }

  private publish(): void { this.listeners.forEach(listener => listener()); }
}
