// Tests routing frames from the daemon with an in-memory socket that records what is sent back.
import { CellNotFound } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { InvalidResponse } from "../errors/transport.js";
import type { Routes } from "./dispatch.js";
import { dispatch } from "./dispatch.js";
import { createPendingCalls } from "./pending.js";
import { createRequestHandlers } from "./requests.js";

const setup = () => {
  const sent: unknown[] = [];
  const events: unknown[] = [];
  const reported: unknown[] = [];
  const settled: { readonly id: number; readonly how: string; readonly value: unknown }[] = [];
  const pending = createPendingCalls();
  for (const id of [1, 2, 3]) {
    pending.add({
      id,
      method: "cell.get",
      frame: "",
      repeatable: true,
      resolve: (value) => settled.push({ id, how: "resolve", value }),
      reject: (value) => settled.push({ id, how: "reject", value }),
    });
  }
  const routes: Routes = {
    socket: { send: (text) => sent.push(JSON.parse(text)), close: () => undefined },
    pending,
    requests: createRequestHandlers(),
    events: new Set([(params: unknown) => events.push(params)]),
    isCurrent: () => true,
    report: (error: unknown) => reported.push(error),
  };
  return { routes, sent, events, settled, reported };
};

const text = (value: unknown): string => JSON.stringify(value);

describe("dispatch", () => {
  it("settles calls by id: a result, an ApiError, a malformed answer", () => {
    const { routes, settled } = setup();
    dispatch(text({ jsonrpc: "2.0", id: 2, result: { ok: 1 } }), routes);
    dispatch(
      text({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 1002, message: "m", data: { cell: "c_a1b2c3" } },
      }),
      routes,
    );
    dispatch(text({ jsonrpc: "2.0", id: 3, error: { code: "x" } }), routes);
    expect(settled.map(({ id, how }) => `${String(id)} ${how}`)).toEqual([
      "2 resolve",
      "1 reject",
      "3 reject",
    ]);
    expect(settled[1]?.value).toBeInstanceOf(CellNotFound);
    expect(settled[2]?.value).toBeInstanceOf(InvalidResponse);
  });

  it("drops an answer no call waits for", () => {
    const { routes, settled, sent } = setup();
    dispatch(text({ jsonrpc: "2.0", id: 99, result: 1 }), routes);
    dispatch(text({ jsonrpc: "2.0", id: 99, error: { code: "x" } }), routes);
    expect(settled).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("dispatch of notifications, requests and unreadable frames", () => {
  it("hands event notifications to the listeners and drops other notifications", () => {
    const { routes, events } = setup();
    dispatch(text({ jsonrpc: "2.0", method: "event", params: { seq: 1 } }), routes);
    dispatch(text({ jsonrpc: "2.0", method: "bridge.event", params: { name: "x" } }), routes);
    expect(events).toEqual([{ seq: 1 }]);
  });

  it("reports an event listener that throws and still hands the event to the others", () => {
    const { routes, events, reported } = setup();
    const boom = new Error("listener bug");
    const listeners = new Set([
      () => {
        throw boom;
      },
      ...routes.events,
    ]);
    dispatch(text({ jsonrpc: "2.0", method: "event", params: { seq: 2 } }), {
      ...routes,
      events: listeners,
    });
    expect(events).toEqual([{ seq: 2 }]);
    expect(reported).toEqual([boom]);
  });
});

describe("dispatch of unreadable frames and requests", () => {
  it("answers an unreadable frame with its JSON-RPC error", () => {
    const { routes, sent } = setup();
    dispatch("{nope", routes);
    dispatch(new Uint8Array([1]), routes);
    dispatch(text({ jsonrpc: "2.0", id: "s1", method: 5 }), routes);
    expect(sent).toMatchObject([
      { id: null, error: { code: -32700 } },
      { id: null, error: { code: -32700 } },
      { id: "s1", error: { code: -32600 } },
    ]);
  });

  it("answers a request on the socket it came on, unless that socket is gone", async () => {
    for (const current of [true, false]) {
      const checked = Promise.withResolvers<undefined>();
      const { routes, sent } = setup();
      routes.requests.register("realm.reset", () => ({ reset: true }));
      const watched: Routes = {
        ...routes,
        isCurrent: () => {
          checked.resolve(undefined);
          return current;
        },
      };
      dispatch(text({ jsonrpc: "2.0", id: "s2", method: "realm.reset", params: {} }), watched);
      await checked.promise;
      expect(sent).toEqual(current ? [{ jsonrpc: "2.0", id: "s2", result: { reset: true } }] : []);
    }
  });
});
