// Waiting without timers: for a connection status, or for a log to hold enough entries.
import type { ConnectionStatus } from "../socket/status.js";

type Watched = {
  readonly status: () => ConnectionStatus;
  readonly onStatus: (listener: (status: ConnectionStatus) => void) => () => void;
};

/** Resolves when `client` reaches `wanted`, at once if it is there already. */
export function untilStatus(client: Watched, wanted: ConnectionStatus): Promise<void> {
  return new Promise((resolve) => {
    if (client.status() === wanted) {
      resolve();
      return;
    }
    const stop = client.onStatus((status) => {
      if (status !== wanted) return;
      stop();
      resolve();
    });
  });
}

/** Every status a client goes through, in order. */
export function statusLog(client: Watched): ConnectionStatus[] {
  const log: ConnectionStatus[] = [];
  client.onStatus((status) => log.push(status));
  return log;
}

/** An append-only log whose readers can wait for its length. */
export class Log<T> {
  readonly entries: T[] = [];
  readonly #waiters: { readonly count: number; readonly resolve: () => void }[] = [];

  readonly push = (entry: T): void => {
    this.entries.push(entry);
    for (const waiter of this.#waiters.filter((w) => this.entries.length >= w.count)) {
      this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };

  /** Resolves once the log holds at least `count` entries. */
  until(count: number): Promise<T[]> {
    return new Promise((resolve) => {
      const done = (): void => {
        resolve(this.entries);
      };
      if (this.entries.length >= count) done();
      else this.#waiters.push({ count, resolve: done });
    });
  }
}
