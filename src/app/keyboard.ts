import type { PlaybackSpeed } from './runner';

export interface PlaybackControls {
  getSnapshot(): { readonly running: boolean };
  start(): void;
  pause(): void;
  step(): void;
  setSpeed(speed: PlaybackSpeed): void;
}

export interface ShortcutEvent {
  readonly key: string;
  readonly repeat: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}
/** A separate target predicate keeps native controls and editable content native. */
export function isShortcutControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(
    'input, select, textarea, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]',
  ) !== null;
}

export function handleShortcut(event: ShortcutEvent, inControl: boolean, runner: PlaybackControls): void {
  if (inControl || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === ' ') {
    event.preventDefault();
    if (runner.getSnapshot().running) runner.pause(); else runner.start();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    runner.step();
  } else if (event.key === '1' || event.key === '2' || event.key === '4') {
    event.preventDefault();
    runner.setSpeed(event.key === '1' ? 1 : event.key === '2' ? 2 : 4);
  }
}
