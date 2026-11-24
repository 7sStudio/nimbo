// Watches the Web Workers the page engine starts: which started, which were terminated, the request types posted to
// each (with the SQL of every statement), and can answer one statement with a WebAssembly trap (a RuntimeError).

type Posted = {
  readonly worker: number;
  readonly type: string;
  readonly sql: string | undefined;
};

export type Watch = {
  readonly started: Worker[];
  readonly terminated: Worker[];
  readonly posted: Posted[];
  /** True once `sql` was handed to DuckDB on the `worker`-th worker (it then runs in the worker). */
  sent(sql: string, worker?: number): boolean;
  /** Resolves once a request of `type` was posted to the `worker`-th worker. */
  whenPosted(type: string, worker?: number): Promise<void>;
  /** Restores the real Worker constructor. */
  restore(): void;
};

export type WatchOptions = {
  /** A worker script to run instead of DuckDB's (a worker that cannot start). */
  readonly script?: string;
  /** SQL text that, when sent, is answered by a trap instead of reaching DuckDB. */
  readonly trap?: string;
};

const Original = globalThis.Worker;

const field = (message: unknown, key: string): unknown =>
  typeof message === "object" && message !== null ? Reflect.get(message, key) : undefined;

/** The SQL of a START_PENDING_QUERY request (`data` is `[connection, sql, allowStreamResult]`). */
const sqlOf = (message: unknown): string | undefined => {
  const data = field(message, "data");
  const sql: unknown = Array.isArray(data) ? data[1] : undefined;
  return typeof sql === "string" ? sql : undefined;
};

/** The requests posted so far, and the promises waiting for one of a type on a worker. */
function postLog() {
  const posted: Posted[] = [];
  const waiting: {
    readonly worker: number;
    readonly type: string;
    readonly resolve: () => void;
  }[] = [];
  const has = (type: string, worker: number) =>
    posted.some((entry) => entry.worker === worker && entry.type === type);
  const record = (entry: Posted) => {
    posted.push(entry);
    for (const waiter of waiting.filter((w) => has(w.type, w.worker))) {
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  return {
    record,
    posted,
    sent: (sql: string, worker = 0) =>
      posted.some((entry) => entry.worker === worker && entry.sql === sql),
    whenPosted: (type: string, worker = 0) =>
      has(type, worker)
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiting.push({ worker, type, resolve })),
  };
}

/** Replaces `globalThis.Worker` with a subclass that records what the engine does with it. */
export function watchWorkers(options: WatchOptions = {}): Watch {
  const started: Worker[] = [];
  const terminated: Worker[] = [];
  const { record, ...log } = postLog();
  const url =
    options.script === undefined ? undefined : URL.createObjectURL(new Blob([options.script]));
  globalThis.Worker = class extends Original {
    constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
      super(url ?? scriptURL, workerOptions);
      started.push(this);
    }

    override terminate() {
      terminated.push(this);
      super.terminate();
    }

    override postMessage(message: unknown, transfer?: StructuredSerializeOptions | Transferable[]) {
      const type = String(field(message, "type"));
      const sql = type === "START_PENDING_QUERY" ? sqlOf(message) : undefined;
      record({ worker: started.indexOf(this), type, sql });
      if (options.trap !== undefined && sql?.includes(options.trap) === true) {
        const requestId = field(message, "messageId");
        const error = { name: "RuntimeError", message: "unreachable", stack: "" };
        const data = { requestId, type: "ERROR", data: error };
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
        return;
      }
      if (Array.isArray(transfer)) super.postMessage(message, transfer);
      else super.postMessage(message, transfer);
    }
  };
  return {
    started,
    terminated,
    ...log,
    restore: () => {
      globalThis.Worker = Original;
    },
  };
}
