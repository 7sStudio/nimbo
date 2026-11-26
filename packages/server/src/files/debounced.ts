// A debounced, single-flight job: `ask` runs `work` once the asks pause for `ms`; asked again while it runs, it runs
// once more after. `work` must not reject. Its timers never keep the process alive.
export type Debounced = {
  readonly ask: () => void;
  readonly close: () => void;
};

export function debounced(work: () => Promise<void>, ms: number): Debounced {
  let closed = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const fire = (): void => {
    timer = undefined;
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    void work().finally(() => {
      running = false;
      if (again && !closed) {
        again = false;
        fire();
      }
    });
  };
  return {
    ask: () => {
      if (closed) return;
      clearTimeout(timer);
      timer = setTimeout(fire, ms);
      timer.unref();
    },
    close: () => {
      closed = true;
      clearTimeout(timer);
    },
  };
}
