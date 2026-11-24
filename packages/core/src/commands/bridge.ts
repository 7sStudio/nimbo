// The bridge commands of 05-bridge §4, §6 and §9: a stub in the page calls an exported server function; the push
// events a notebook's server cells emitted, by name.
import { z } from "zod";

import { CellId, NotebookRef } from "../model/ids.js";
import { defineCommand } from "./define.js";

export const bridgeCall = defineCommand({
  name: "bridge.call",
  description:
    "Call a current server export with plain-data arguments; the result is plain data or BRIDGE_CALL_FAILED.",
  input: z.object({ notebook: NotebookRef, fn: z.string(), args: z.array(z.unknown()) }),
  // `redacted`: the kernel redacted a secret in the result, so the calling cell gets a stderr warning (04-kernel §10).
  output: z.object({ result: z.unknown(), redacted: z.boolean().optional() }),
  tags: { internal: true },
});

const count = z.number().int().nonnegative();

export const bridgeEvents = defineCommand({
  name: "bridge.events",
  description:
    "The events server cells emitted with emit(name, data) since the notebook opened, by name: how many, how many reached a client cell's on(name) listener in the attached page, how many were dropped (no page attached, no listener, or a burst past the queue) and the last time. The events themselves are event outputs on the listening client cells.",
  input: z.object({ notebook: NotebookRef }),
  output: z.object({
    /** A page holds the client realm now: events emitted now reach it. */
    attached: z.boolean(),
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
  }),
});
