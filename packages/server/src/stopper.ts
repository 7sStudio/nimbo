// The stop latch of a running daemon: one stop, whoever asks first, and a promise of its end.
/** The stop of a running daemon: armed once its parts exist, run once whoever asks (workspace.stop, a signal). */
export type Stopper = {
  readonly stop: () => Promise<void>;
  readonly closed: Promise<undefined>;
  readonly arm: (run: () => Promise<void>) => void;
};

export function createStopper(): Stopper {
  let run: () => Promise<void> = () => Promise.resolve();
  let stopping: Promise<void> | undefined;
  let settle = (): void => undefined;
  const closed = new Promise<undefined>((resolve) => {
    settle = () => {
      resolve(undefined);
    };
  });
  return {
    stop: () => (stopping ??= run().finally(settle)),
    closed,
    arm: (next) => {
      run = next;
    },
  };
}
