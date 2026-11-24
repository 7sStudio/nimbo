// The daemon's requests to a page on the same socket (03-api §4.5, §7.2; 05-bridge §9): realm.execute, realm.reset,
// realm.snapshot, realm.interrupt, realm.event and realm.dispose, validated with core's schemas, answered with the handler's result or its error.
import {
  InvalidParams,
  RealmDispose,
  RealmEvent,
  RealmExecute,
  RealmInterrupt,
  RealmReset,
  RealmSnapshot,
} from "@jsnb/core";
import type { z } from "zod";

import { writeError, writeResult } from "../rpc/frames.js";
import type { RpcId } from "../rpc/frames.js";
import { issuesOf } from "../rpc/issues.js";
import { wireErrorOf } from "../rpc/wireError.js";

/** The params of each request the daemon sends to a page. */
export type ServerRequests = {
  readonly "realm.execute": RealmExecute;
  readonly "realm.reset": RealmReset;
  readonly "realm.snapshot": RealmSnapshot;
  readonly "realm.interrupt": RealmInterrupt;
  readonly "realm.event": RealmEvent;
  readonly "realm.dispose": RealmDispose;
};
export type ServerRequestMethod = keyof ServerRequests;

/** Answers one request: its return value (awaited) is the result; a thrown ApiError keeps its code, else -32603. */
export type ServerRequestHandler<M extends ServerRequestMethod> = (
  params: ServerRequests[M],
) => unknown;

const schemas: { readonly [M in ServerRequestMethod]: z.ZodType<ServerRequests[M]> } = {
  "realm.execute": RealmExecute,
  "realm.reset": RealmReset,
  "realm.snapshot": RealmSnapshot,
  "realm.interrupt": RealmInterrupt,
  "realm.event": RealmEvent,
  "realm.dispose": RealmDispose,
};

export type RequestHandlers = {
  /** Registers the answer to a method, replacing any earlier one; returns its unregistration. */
  readonly register: <M extends ServerRequestMethod>(
    method: M,
    respond: ServerRequestHandler<M>,
  ) => () => void;
  /** The response frame to a request: the result, the handler's error, -32602 or -32601. */
  readonly answer: (id: RpcId, method: string, params: unknown) => Promise<string>;
};

/** The error's name, or "Error" when it has none or reading it throws: the fallback answer must not fail too. */
function nameOf(error: unknown): string {
  try {
    return error instanceof Error && typeof error.name === "string" ? error.name : "Error";
  } catch {
    // A name getter that throws: the fixed name stands in, since the daemon needs an answer more than the name.
    return "Error";
  }
}

/** The error frame for what a responder threw; if that cannot be written as JSON, a plain -32603 with its name. */
function errorAnswer(id: RpcId, error: unknown): string {
  try {
    return writeError(id, wireErrorOf(error));
  } catch (unwritable) {
    // Its data or message is not JSON (a BigInt, an object with no string form): the daemon still gets an
    // answer, with the name only; what made it unwritable is the reason, not something the daemon can use.
    const data = { name: nameOf(error), unwritable: nameOf(unwritable) };
    return writeError(id, {
      code: -32603,
      message: "The page's error could not be sent as JSON.",
      data,
    });
  }
}

/** An empty registry; it belongs to the connection, so handlers survive reconnects. */
export function createRequestHandlers(): RequestHandlers {
  const responders = new Map<string, (params: unknown) => unknown>();
  return {
    register: (method, respond) => {
      const schema = schemas[method];
      const run = (params: unknown): unknown => {
        const parsed = schema.safeParse(params);
        if (!parsed.success) throw new InvalidParams({ issues: issuesOf(parsed.error) });
        return respond(parsed.data);
      };
      responders.set(method, run);
      return () => {
        if (responders.get(method) === run) responders.delete(method);
      };
    },
    answer: async (id, method, params) => {
      const run = responders.get(method);
      if (!run) return writeError(id, { code: -32601, message: `${method} is not handled here.` });
      try {
        return writeResult(id, await run(params));
      } catch (error) {
        // The failure is the answer: the daemon gets the error as this request's JSON-RPC error.
        return errorAnswer(id, error);
      }
    },
  };
}
