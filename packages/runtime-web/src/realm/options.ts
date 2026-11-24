// The Realm's options and the limits it takes from settings (03-api §4.10), with the defaults of 04-kernel and 05-bridge;
// the daemon sends a run's own limits with realm.execute, read from the notebook's settings like the env.
import type { RealmLimits } from "@jsnb/core";

import type { PauseClock } from "../bridge/stub.js";
import type { RealmTransport } from "../bridge/transport.js";
import type { Mount } from "../display/containers.js";
import { appendToBody } from "../display/containers.js";
import { importUrl } from "./imports.js";

export type { RealmLimits };

const neverPaused: PauseClock = { paused: () => false, heldMs: () => 0 };

const defaultLimits: RealmLimits = {
  maxValueBytes: 262_144,
  maxStreamBytes: 1_048_576,
  rpcTimeoutMs: 60_000,
  maxBytesPerValue: 5_242_880,
};

export type RealmOptions = {
  /** The notebook ref, for `realm.attach` and `bridge.call`. */
  readonly notebook: string;
  /** The page's socket, provided by the host (ui's `realm/mount.ts`). */
  readonly transport: RealmTransport;
  /** The `realm.attach` kind; default `"tab"`. */
  readonly kind?: "tab" | "headless";
  /** Where a new container goes; default `document.body.append`. */
  readonly mount?: Mount;
  /** What the realm cannot report: a failed `realm.report`, a disposer that throws after detach. */
  readonly onError?: (error: unknown) => void;
  /** The URL an import specifier loads from; default the 04-kernel §8.1 rule. */
  readonly importUrl?: (specifier: string) => string;
  /** The limits of a run whose realm.execute carries none. */
  readonly limits?: Partial<RealmLimits>;
  /** The time the server kernel spends paused in the debugger; default never paused. */
  readonly pauses?: PauseClock;
};

export type ResolvedOptions = {
  readonly notebook: string;
  readonly transport: RealmTransport;
  readonly kind: "tab" | "headless";
  readonly mount: Mount;
  readonly onError: (error: unknown) => void;
  readonly importUrl: (specifier: string) => string;
  readonly limits: RealmLimits;
  readonly pauses: PauseClock;
};

/** Nothing is swallowed (08-code-standards §5): without a sink, the page's own error reporting shows it. */
const reportToPage = (error: unknown): void => {
  reportError(error);
};

export function resolveOptions(options: RealmOptions): ResolvedOptions {
  return {
    notebook: options.notebook,
    transport: options.transport,
    kind: options.kind ?? "tab",
    mount: options.mount ?? appendToBody,
    onError: options.onError ?? reportToPage,
    importUrl: options.importUrl ?? importUrl,
    limits: { ...defaultLimits, ...options.limits },
    pauses: options.pauses ?? neverPaused,
  };
}
