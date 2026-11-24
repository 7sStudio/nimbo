// The daemon's stand-in at the transport port runtime-web defines (09-testing §1.3): it records every call, answers
// realm.attach, realm.detach and realm.report, answers bridge.call through the test's handler, and waits for reports.
import type { Output, RealmReport as Report } from "@jsnb/core";
import { RealmReport, bridgeCall } from "@jsnb/core";

import type { RealmTransport } from "../bridge/transport.js";

/** Answers a `bridge.call`: its return value (or promise) is the JSON-RPC result, `{ result, redacted? }`; a throw or
 * a rejection is the call failure. */
export type BridgeHandler = (fn: string, args: readonly unknown[]) => unknown;

export type TestTransportOptions = {
  readonly bridge?: BridgeHandler;
  /** Fails a `realm.report` with the error it returns, to prove a failed report reaches `onError`. */
  readonly failReport?: (report: Report) => Error | undefined;
};

export type TestTransport = RealmTransport & {
  readonly calls: { readonly method: string; readonly params: unknown }[];
  /** Every `realm.report`, parsed with core's RealmReport. */
  readonly reports: Report[];
  /** Resolves with the first report, already received or still to come, that matches. */
  readonly until: (predicate: (report: Report) => boolean) => Promise<Report>;
  readonly outputsOf: (execution: string) => Output[];
};

type Waiter = {
  readonly predicate: (report: Report) => boolean;
  readonly resolve: (report: Report) => void;
};

export const testRealmId = "r_test";

/** The reports received so far and the tests waiting for one. */
function reportBook(failReport: TestTransportOptions["failReport"]) {
  const reports: Report[] = [];
  let waiters: Waiter[] = [];
  const receive = (report: Report): Record<string, never> => {
    const failure = failReport?.(report);
    if (failure !== undefined) throw failure;
    reports.push(report);
    const ready = waiters.filter((waiter) => waiter.predicate(report));
    waiters = waiters.filter((waiter) => !ready.includes(waiter));
    for (const waiter of ready) waiter.resolve(report);
    return {};
  };
  const until = (predicate: (report: Report) => boolean): Promise<Report> =>
    new Promise((resolve) => {
      const found = reports.find(predicate);
      if (found) resolve(found);
      else waiters.push({ predicate, resolve });
    });
  return { reports, receive, until };
}

export function createTestTransport(options: TestTransportOptions = {}): TestTransport {
  const calls: { method: string; params: unknown }[] = [];
  const { reports, receive, until } = reportBook(options.failReport);
  const answer = async (method: string, params: unknown): Promise<unknown> => {
    if (method === "realm.attach") return { realmId: testRealmId };
    if (method === "realm.detach") return {};
    if (method === "realm.report") return receive(RealmReport.parse(params));
    if (method === "bridge.call" && options.bridge) {
      const { fn, args } = bridgeCall.input.parse(params);
      return await options.bridge(fn, args);
    }
    throw new Error(`the test transport does not answer ${method}`);
  };
  const call = (method: string, params: unknown): Promise<unknown> => {
    calls.push({ method, params });
    return answer(method, params);
  };
  const outputsOf = (execution: string): Output[] =>
    reports.flatMap((report) =>
      report.execution === execution && report.output ? [report.output] : [],
    );
  return { calls, reports, call, until, outputsOf };
}
