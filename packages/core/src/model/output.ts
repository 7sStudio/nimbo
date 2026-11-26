// Output, ErrorInfo and Frame: what a run produces and how a user-code failure is reported.
import { z } from "zod";

import { CellId } from "./ids.js";

/** The shape behind Frame, so debug.stack can extend it with a frame id. */
export const frameShape = {
  cell: CellId.optional(),
  line: z.number().int(),
  col: z.number().int(),
  fn: z.string().optional(),
  file: z.string().optional(),
};

export const Frame = z.object(frameShape).readonly();
export type Frame = z.infer<typeof Frame>;

export const ErrorInfo = z
  .object({
    name: z.string(),
    message: z.string(),
    frames: z.array(Frame).readonly(),
    raw: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .readonly();
export type ErrorInfo = z.infer<typeof ErrorInfo>;

export const Output = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stream"), stream: z.enum(["stdout", "stderr"]), text: z.string() }),
  z.object({
    kind: z.literal("value"),
    json: z.unknown(),
    repr: z.string(),
    truncated: z.boolean(),
  }),
  z.object({ kind: z.literal("display"), mime: z.string(), data: z.string() }),
  z.object({ kind: z.literal("dom"), html: z.string(), text: z.string() }),
  z.object({ kind: z.literal("event"), name: z.string(), data: z.unknown(), at: z.string() }),
  z.object({
    kind: z.literal("error"),
    error: ErrorInfo,
    /** When it was raised: `during` its run (a callback, a promise nothing awaited) or `after` it ended, as the daemon
     * stamps an error output when it arrives; `run` is the error the run itself ended with, when a host shows that
     * one in the viewer. */
    when: z.enum(["run", "during", "after"]).optional(),
  }),
]);
export type Output = z.infer<typeof Output>;
