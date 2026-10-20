import { createInitialState } from '../engine/initial-state';
import { stepBaselineAutonomous } from '../engine/step';
import type { Scenario, SimulationState } from '../engine/types';
import type { RunMetrics } from '../experiments/metrics';
import { RunMetricsAccumulator } from '../experiments/metrics-accumulator';
import { EXPERIMENT_TICK_CAP } from '../experiments/relay-placement';
import type { PlaybackSpeed, Scheduler } from './runner';

export type CompareSite = 'site-a' | 'site-b';
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface ComparedRun {
  readonly state: SimulationState;
  readonly history: readonly SimulationState[];
  readonly metrics: RunMetrics;
}

export interface ComparisonView {
  readonly runs: Readonly<Record<CompareSite, ComparedRun>>;
  readonly tick: number;
  readonly running: boolean;
  readonly speed: PlaybackSpeed;
  readonly generation: number;
  readonly complete: boolean;
}

const clock: Scheduler = {
  set: (callback, delay) => globalThis.setTimeout(callback, delay),
  clear: handle => globalThis.clearTimeout(handle),
};

/** One clock advances two isolated runs and publishes only matched ticks. */
export class ComparisonRunner {
  private view: ComparisonView;
  private metrics!: Record<CompareSite, RunMetricsAccumulator>;
  private timer: TimerHandle | undefined;
  private timerVersion = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly scenario: Scenario, private readonly scheduler: Scheduler = clock) {
    this.view = this.fresh(0, 1);
  }

  readonly getSnapshot = (): ComparisonView => this.view;
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

  reset(): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.view = this.fresh(this.view.generation + 1, this.view.speed);
    this.publish();
  }

  dispose(): void {
    this.pause();
    this.disposed = true;
    this.listeners.clear();
  }

  private fresh(generation: number, speed: PlaybackSpeed): ComparisonView {
    const a = createInitialState(this.scenario, 'site-a');
    const b = createInitialState(this.scenario, 'site-b');
    this.metrics = { 'site-a': new RunMetricsAccumulator(this.scenario, a),
      'site-b': new RunMetricsAccumulator(this.scenario, b) };
    return { runs: {
      'site-a': { state: a, history: [a], metrics: this.metrics['site-a'].getMetrics() },
      'site-b': { state: b, history: [b], metrics: this.metrics['site-b'].getMetrics() },
    },
      tick: 0, running: false, speed, generation, complete: false };
  }

  private advance(): void {
    const a = stepBaselineAutonomous(this.scenario, this.view.runs['site-a'].state);
    const b = stepBaselineAutonomous(this.scenario, this.view.runs['site-b'].state);
    if (a.tick !== b.tick || a.tick !== this.view.tick + 1) {
      throw new Error('Comparison runs must advance to the same next tick.');
    }
    const commitA = this.metrics['site-a'].prepareAppend(a);
    const commitB = this.metrics['site-b'].prepareAppend(b);
    const runs = {
      'site-a': { state: a, history: [...this.view.runs['site-a'].history, a], metrics: commitA() },
      'site-b': { state: b, history: [...this.view.runs['site-b'].history, b], metrics: commitB() },
    };
    const complete = a.tick >= EXPERIMENT_TICK_CAP;
    this.view = { ...this.view, runs, tick: a.tick,
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

/** Selecting a relay only changes presentation; it never mutates either run. */
export function selectComparedRun(view: ComparisonView, site: CompareSite): ComparedRun {
  return view.runs[site];
}
