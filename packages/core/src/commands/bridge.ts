// The bridge commands: a stub in the page calls an exported server function; the push
// events a notebook's server cells emitted, by name.
import { z } from "zod";

import { CellId, NotebookRef } from "../model/ids.js";
import { defineCommand } from "./define.js";

export const bridgeCall = defineCommand({
  name: "bridge.call",
  description:
    "Call a current server export with plain-data arguments; the result is plain data or BRIDGE_CALL_FAILED.",
  input: z.object({ notebook: NotebookRef, fn: z.string(), args: z.array(z.unknown()) }),
  // `redacted`: the kernel redacted a secret in the result, so the calling cell gets a stderr warning.
  output: z.object({ result: z.unknown(), redacted: z.boolean().optional() }),
  tags: { internal: true },
});

const count = z.number().int().nonnegative();

export const bridgeEvents = defineCommand({
  name: "bridge.events",
  description:
    "The events server cells emitted with emit(name, data) since the notebook opened, by name, the most recent first: how many, how many reached a client cell's on(name) listener in the attached page, how many were dropped (no page attached, no listener, or a burst past the queue) and the last time. At most limit names, those starting with prefix; the daemon tracks the 500 most recently emitted names and counts older ones together under other, whose folded says how many rows it took in (a name folded twice counts twice) and unnamed how many events the kernel counted without their names. The events themselves are event outputs on the listening client cells.",
  input: z.object({
    notebook: NotebookRef,
    /** Only the names that start with it. */
    prefix: z.string().optional(),
    limit: z.number().int().positive().max(500).default(50),
  }),
  output: z.object({
    /** A page holds the client realm now: events emitted now reach it. */
    attached: z.boolean(),
    /** The names tracked that match `prefix`; `events` holds the first `limit`. */
    total: count,
    events: z.array(
      z.object({
        name: z.string(),
        emitted: count,
        delivered: count,
        dropped: count,
        /** Why the last dropped one was: no page attached, no listener for the name, or the queue overflowed. */
        lastDrop: z.enum(["noPage", "noListener", "overflow"]).nullable(),
        lastAt: z.string(),
        /** The server cell that emitted it last. */
        cell: CellId.nullable(),
      }),
    ),
    /** The names no longer tracked, counted together; null while every name is tracked. `folded`: the rows it took
     * in; `unnamed`: the events among them the kernel counted without their names. */
    other: z
      .object({
        folded: count,
        unnamed: count,
        emitted: count,
        delivered: count,
        dropped: count,
      })
      .nullable(),
  }),
});
