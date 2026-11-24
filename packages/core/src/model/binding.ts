// Binding, BindingValue and Route of 03-api §5: what the scope and the route table report per name.
import { z } from "zod";

import { CellId } from "./ids.js";

export const BindingKind = z.enum(["const", "let", "var", "function", "class", "import"]);
export type BindingKind = z.infer<typeof BindingKind>;

const bindingShape = {
  name: z.string(),
  kind: BindingKind,
  preview: z.string(),
  definedBy: CellId,
  exported: z.boolean(),
};

export const Binding = z.object(bindingShape).readonly();
export type Binding = z.infer<typeof Binding>;

/** A binding with its current value, as `cell.bindings` returns it. */
export const BindingValue = z
  .object({ ...bindingShape, json: z.unknown(), repr: z.string(), truncated: z.boolean() })
  .readonly();
export type BindingValue = z.infer<typeof BindingValue>;

export const Route = z
  .object({
    spec: z.string(),
    method: z.string(),
    path: z.string(),
    url: z.string(),
    cell: CellId,
    registeredAt: z.string(),
    hits: z.number().int().nonnegative(),
  })
  .readonly();
export type Route = z.infer<typeof Route>;
