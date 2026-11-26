// realm.report: one ordered queue per realm, every string redacted once on its way out.
import type { ErrorInfo, ExecStatus, Output } from "@jsnb/core";

import type { RealmTransport } from "../bridge/transport.js";
import { redactInfo, redactOutput } from "./redact.js";

type StatusReport = {
  readonly execution: string;
  readonly status: ExecStatus;
  readonly durationMs: number;
  /** The names the run defined; absent for a run refused before it started, which leaves the record as it was. */
  readonly defines?: readonly string[];
  readonly error?: ErrorInfo;
};

export type Reports = {
  /** Queues one output of an execution; resolves once it was reported (or its failure went to `onError`). */
  readonly output: (execution: string, output: Output) => Promise<void>;
  readonly status: (report: StatusReport) => Promise<void>;
};

/**
 * Reports are chained, each sent after the previous one was answered, so outputs arrive in order. A report with no
 * attached realm is dropped (there is nobody to tell); a failed one goes to `onError`.
 */
export function createReports(
  transport: RealmTransport,
  realmId: () => string | undefined,
  onError: (error: unknown) => void,
): Reports {
  let tail: Promise<void> = Promise.resolve();
  const send = (params: Readonly<Record<string, unknown>>): Promise<void> => {
    const id = realmId();
    if (id === undefined) return tail;
    tail = tail
      .then(async () => {
        await transport.call("realm.report", { realmId: id, ...params });
      })
      .catch(onError);
    return tail;
  };
  return {
    output: (execution, output) => send({ execution, output: redactOutput(output) }),
    status: ({ error, defines, ...report }) =>
      send({
        ...report,
        ...(defines ? { defines: [...defines] } : {}),
        ...(error ? { error: redactInfo(error) } : {}),
      }),
  };
}
