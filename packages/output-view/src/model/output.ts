// The viewer's input: an Output of 03-api §5 or the `{ kind: "value", json, repr }` shorthand, validated at the boundary.
import type { Output } from "@jsnb/core";
import { Output as OutputSchema, JsnbError } from "@jsnb/core";

import { isJsonObject } from "./wire.js";

/** What the viewer renders: any Output, or a value without `truncated`. */
export type ViewInput =
  | Output
  | {
      readonly kind: "value";
      readonly json: unknown;
      readonly repr: string;
      readonly truncated?: boolean;
    };

/** One schema failure: where in the input, and what was wrong. */
export type OutputIssue = { readonly path: string; readonly message: string };

const invalidOutputMessage = (issues: readonly OutputIssue[]): string => {
  const first = issues[0];
  const where = first === undefined || first.path === "" ? "" : ` at ${first.path}`;
  return `The viewer was given something that is not an output${where}: ${first?.message ?? "unknown shape"}. Pass an Output of 03-api §5 or { kind: "value", json, repr }.`;
};

/** An input the viewer cannot render: the host passed something that is not an Output. */
export class InvalidOutput extends JsnbError {
  declare readonly data: { readonly issues: readonly OutputIssue[] };
  constructor(
    data: { readonly issues: readonly OutputIssue[] },
    options: { readonly cause?: unknown } = {},
  ) {
    super({ name: "InvalidOutput", message: invalidOutputMessage(data.issues), data, ...options });
  }
}

/**
 * Whether `error` is an InvalidOutput, read from its shape (name, message, issues) rather than with instanceof: core is
 * bundled into each published build, so an InvalidOutput made by another copy of the code still counts.
 */
export function isInvalidOutput(error: unknown): error is InvalidOutput {
  if (typeof error !== "object" || error === null) return false;
  const data: unknown = Reflect.get(error, "data");
  return (
    Reflect.get(error, "name") === "InvalidOutput" &&
    typeof Reflect.get(error, "message") === "string" &&
    typeof data === "object" &&
    data !== null &&
    Array.isArray(Reflect.get(data, "issues"))
  );
}

const withTruncated = (input: unknown): unknown =>
  isJsonObject(input) && input.kind === "value" && !("truncated" in input)
    ? { ...input, truncated: false }
    : input;

/**
 * The full value the daemon streams for a cut one (`GET /outputs/<execution>/<index>.json`, 03-api §7.5): the value
 * output's `json` in its wire form, encoded without the node cap (04-kernel §5.2). Every reader (export, SQL) parses it
 * here and then treats it exactly as an uncut value's `json`.
 */
export function fullValueJson(text: string): unknown {
  const json: unknown = JSON.parse(text);
  return json;
}

/** Validates what crosses into the viewer (a component prop, a CLI's output) with core's schema; throws InvalidOutput. */
export function toOutput(input: unknown): Output {
  const checked = OutputSchema.safeParse(withTruncated(input));
  if (checked.success) return checked.data;
  const issues = checked.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  throw new InvalidOutput({ issues }, { cause: checked.error });
}
