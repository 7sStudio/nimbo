// One HTTP exchange with the daemon, retried with backoff (02-architecture §2 "retries", 03-api §7.6): always while
// the connection is refused, since the daemon never saw the request, and on any network failure when repeating is safe.
import { isJsnbError } from "@jsnb/core";

import { httpUrl } from "../daemon/address.js";
import { CallAborted, ConnectionDropped, DaemonUnreachable } from "../errors/transport.js";
import type { Backoff } from "../retry/backoff.js";
import { backoffMs, httpBackoff, pause } from "../retry/backoff.js";
import { isConnectionRefused } from "./network.js";
import type { HttpOptions } from "./options.js";

/** What to send, and how to read the answer; `read` throws a JsnbError for an answer that is a failure. */
type Exchange<T> = {
  readonly options: HttpOptions;
  /** The command, or the request line, that errors name. */
  readonly method: string;
  readonly path: string;
  readonly init: RequestInit;
  readonly repeatable: boolean;
  readonly signal?: AbortSignal;
  readonly read: (response: Response) => Promise<T>;
};

type Attempt<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly cause: unknown };

async function attemptOnce<T>(exchange: Exchange<T>): Promise<Attempt<T>> {
  const signal = exchange.signal === undefined ? {} : { signal: exchange.signal };
  try {
    const response = await fetch(httpUrl(exchange.options, exchange.path), {
      ...exchange.init,
      ...signal,
    });
    return { ok: true, value: await exchange.read(response) };
  } catch (error) {
    if (isJsnbError(error)) throw error;
    // Anything else is the network failing (connect, send or read); the loop decides whether to try again.
    return { ok: false, cause: error };
  }
}

/** Throws the error that ends the exchange after attempt `attempt` failed with `cause`, if it must end. */
function endIfFinal(
  exchange: Exchange<unknown>,
  cause: unknown,
  attempt: number,
  backoff: Backoff,
): void {
  const method = exchange.method;
  if (exchange.signal?.aborted === true) {
    throw new CallAborted({ method }, { cause: exchange.signal.reason });
  }
  if (!exchange.repeatable && !isConnectionRefused(cause))
    throw new ConnectionDropped({ method }, { cause });
  if (attempt >= backoff.attempts) {
    throw new DaemonUnreachable({ url: exchange.options.url, attempts: attempt }, { cause });
  }
}

/** Runs the exchange, retrying network failures as the rules allow; daemon answers are never retried. */
export async function exchangeRetrying<T>(exchange: Exchange<T>): Promise<T> {
  const backoff = { ...httpBackoff, ...exchange.options.retry };
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await attemptOnce(exchange);
    if (outcome.ok) return outcome.value;
    endIfFinal(exchange, outcome.cause, attempt, backoff);
    const delayMs = backoffMs(attempt, backoff);
    exchange.options.onRetry?.({ method: exchange.method, attempt, delayMs, cause: outcome.cause });
    if (!(await pause(delayMs, exchange.signal))) {
      throw new CallAborted({ method: exchange.method }, { cause: exchange.signal?.reason });
    }
  }
}
