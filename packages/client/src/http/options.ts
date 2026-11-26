// The options of the HTTP client and the download: the daemon, the backoff and a retry notice.
import type { DaemonOptions } from "../daemon/address.js";
import type { Backoff } from "../retry/backoff.js";

/** One retry about to happen, for a caller that wants to say "waiting for the daemon". */
export type RetryNotice = {
  readonly method: string;
  readonly attempt: number;
  readonly delayMs: number;
  readonly cause: unknown;
};

export type HttpOptions = DaemonOptions & {
  /** Overrides of the HTTP backoff (five attempts from 100 ms). */
  readonly retry?: Partial<Backoff>;
  readonly onRetry?: (notice: RetryNotice) => void;
};
