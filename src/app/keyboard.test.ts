import { describe, expect, it } from 'vitest';
import { CANDIDATE_SCENARIO } from '../experiments/candidate';
import { handleShortcut, isShortcutControl, type ShortcutEvent } from './keyboard';
import { SimulationRunner } from './runner';

function key(key: string, overrides: Partial<ShortcutEvent> = {}) {
  let prevented = false;
  const event: ShortcutEvent = {
    key, repeat: false, altKey: false, ctrlKey: false, metaKey: false,
    get defaultPrevented() { return prevented; },
    preventDefault() { prevented = true; }, ...overrides,
  };
  return { event, prevented: () => prevented };
}

describe('keyboard shortcuts', () => {
  it('starts, pauses, steps, and sets speed only for unmodified keys outside controls', () => {
    const runner = new SimulationRunner(CANDIDATE_SCENARIO);
    for (const input of [key(' ', { repeat: true }), key(' ', { ctrlKey: true }), key(' ', { defaultPrevented: true })]) {
      handleShortcut(input.event, false, runner);
      expect(input.prevented()).toBe(false);
    }
    const control = key(' ');
    handleShortcut(control.event, true, runner);
    expect(control.prevented()).toBe(false);
    expect(runner.getSnapshot().running).toBe(false);
    const play = key(' ');
    handleShortcut(play.event, false, runner);
    expect(play.prevented()).toBe(true);
    expect(runner.getSnapshot().running).toBe(true);
    handleShortcut(key('ArrowRight').event, false, runner);
    expect(runner.getSnapshot().state.tick).toBe(0);
    handleShortcut(key(' ').event, false, runner);
    handleShortcut(key('ArrowRight').event, false, runner);
    expect(runner.getSnapshot().state.tick).toBe(1);
    handleShortcut(key('4').event, false, runner);
    expect(runner.getSnapshot().speed).toBe(4);
    runner.dispose();
  });

  it('recognizes native and editable controls, including nested focus targets', () => {
    const original = globalThis.Element;
    class FakeElement {
      constructor(private readonly guarded: boolean) {}
      closest(selector: string) {
        expect(selector).toContain('contenteditable');
        return this.guarded ? this : null;
      }
    }
    Object.assign(globalThis, { Element: FakeElement });
    try {
      expect(isShortcutControl(new FakeElement(true) as unknown as Element)).toBe(true);
      expect(isShortcutControl(new FakeElement(false) as unknown as Element)).toBe(false);
      expect(isShortcutControl(null)).toBe(false);
    } finally {
      Object.assign(globalThis, { Element: original });
    }
  });

  it('leaves Space on the inspector disclosure button to the button', () => {
    const original = globalThis.Element;
    class DisclosureChild {
      closest(selector: string) {
        expect(selector).toContain('button');
        return this;
      }
    }
    Object.assign(globalThis, { Element: DisclosureChild });
    const runner = new SimulationRunner(CANDIDATE_SCENARIO);
    try {
      const space = key(' ');
      handleShortcut(space.event, isShortcutControl(new DisclosureChild() as unknown as Element), runner);
      expect(space.prevented()).toBe(false);
      expect(runner.getSnapshot().running).toBe(false);
      expect(runner.getSnapshot().state.tick).toBe(0);
    } finally {
      runner.dispose();
      Object.assign(globalThis, { Element: original });
    }
  });
});
