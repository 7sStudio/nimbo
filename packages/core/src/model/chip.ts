// Chip of 11-query §2 and §4: one filter-mode clause of the query bar, compiled to JSONPath by query-json.
import { z } from "zod";

/** The ten operators (added `startsWith`, which the bar and query-json already had). */
export const ChipOp = z.enum([
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "contains",
  "startsWith",
  "matches",
  "exists",
]);
export type ChipOp = z.infer<typeof ChipOp>;

/** `exists` carries no value; every other op compares `key` with `value`. */
export const Chip = z
  .object({
    key: z.string(),
    op: ChipOp,
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  })
  .readonly();
export type Chip = z.infer<typeof Chip>;
