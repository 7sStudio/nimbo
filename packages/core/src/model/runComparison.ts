// The wire form of core's RunComparison (analysis/compareRuns.ts), cell.compare's output (03-api §4.3).
import { z } from "zod";

import { ExecStatus } from "./execution.js";

const diffLine = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("same"), text: z.string(), before: z.number(), after: z.number() }),
  z.object({ kind: z.literal("removed"), text: z.string(), before: z.number() }),
  z.object({ kind: z.literal("added"), text: z.string(), after: z.number() }),
]);

const valueChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added"), path: z.string(), after: z.unknown() }),
  z.object({ kind: z.literal("removed"), path: z.string(), before: z.unknown() }),
  z.object({
    kind: z.literal("changed"),
    path: z.string(),
    before: z.unknown(),
    after: z.unknown(),
  }),
]);

export const RunComparisonSchema = z.object({
  same: z.boolean(),
  status: z.object({ before: ExecStatus, after: ExecStatus }),
  durationMs: z.object({ before: z.number().optional(), after: z.number().optional() }),
  value: z
    .object({
      changes: z.array(valueChange).readonly(),
      more: z.number().int(),
      truncated: z.boolean(),
    })
    .nullable(),
  text: z.array(diffLine).readonly(),
  error: z.object({ before: z.string().optional(), after: z.string().optional() }),
});
