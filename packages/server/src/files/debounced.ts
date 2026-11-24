// A debounced, single-flight job: `ask` runs `work` once the asks pause for `ms`; asked again while it runs, it runs
// once more after. `work` must not reject. Its timers never keep the process alive.
export type Debounced = {
  readonly ask: () => void;
  readonly close: () => void;
};

type State = {
  closed: boolean;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
};

export function debounced(work: () => Promise<void>, ms: number): Debounced {
  const state: State = { closed: false, again: false, timer: undefined, running: false };
  const fire = (): void => {
    state.timer = undefined;
    if (state.closed) return;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    void work().finally(() => {
      state.running = false;
      if (state.again && !state.closed) {
        state.again = false;
        fire();
      }
    });
  };
  return {
    ask: () => {
      if (state.closed) return;
      clearTimeout(state.timer);
      state.timer = setTimeout(fire, ms);
      state.timer.unref();
    },
    close: () => {
      state.closed = true;
      clearTimeout(state.timer);
    },
  };
}
