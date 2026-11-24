// The flags of a generated subcommand, derived from its input's JSON Schema (03-api §8, 09-testing §4.1): one
// `--kebab-case` flag per key, booleans with --no-<flag>, arrays repeated, `source` also from --file or stdin, objects
// and unions as JSON text, `notebook` with -n; `secrets.set`'s value is never a flag (03-api §4.7).
import type { AnyCommand } from "@jsnb/core";
import { commandJsonSchema } from "@jsnb/core";

import { kebab } from "./names.js";
import { formsOf } from "./forms.js";

/**
 * How a key is read from the command line: `json` keys take JSON text, kept as text when it is not JSON or does not
 * fit (`--after null`, `--select all`, `--select '{"above":"c_a1b2c3"}'`); `secret` keys are read from stdin.
 */
type FlagKind = "boolean" | "number" | "string" | "list" | "json" | "source" | "secret";

export type Flag = {
  readonly key: string;
  /** The flag without its dashes, `timeout-ms`. */
  readonly flag: string;
  readonly kind: FlagKind;
  readonly required: boolean;
  /** The schema's default, when it has one. */
  readonly defaults?: { readonly value: unknown };
  /** What the help shows after the flag: `<integer>`, `<server|client|markdown>`, `<json>`. */
  readonly type: string;
  /** For a list, how one item is read. */
  readonly item?: "number" | "string";
  /** A long enum's values, which the help lists under the flags. */
  readonly values?: readonly string[];
  /** A JSON flag's forms, from its schema (`all | {above: <cell>} | …`). */
  readonly forms?: string;
  readonly short?: string;
};

type Schema = Readonly<Record<string, unknown>>;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The keys whose value is a secret, read from stdin or asked for, never from argv (03-api §4.7). */
const secretKeys: Readonly<Record<string, string>> = { "secrets.set": "value" };

/** Past this many characters an enum's values are listed under the flags, its label the flag's name. */
const inlineEnum = 40;

/** An enum's label: its values when they are short (`server|client|markdown`), else a placeholder with the list. */
const enumOf = (
  values: readonly string[],
): { kind: "string"; type: string; values?: readonly string[] } => {
  const joined = values.join("|");
  return joined.length <= inlineEnum
    ? { kind: "string", type: joined }
    : { kind: "string", type: "", values };
};

/** A scalar's kind and help label, or undefined for anything that needs JSON. */
function scalarOf(
  schema: Schema,
): { kind: "boolean" | "number" | "string"; type: string; values?: readonly string[] } | undefined {
  if (schema.type === "boolean") return { kind: "boolean", type: "" };
  if (schema.type === "integer" || schema.type === "number")
    return { kind: "number", type: schema.type };
  if (schema.type !== "string") return undefined;
  if (Array.isArray(schema.enum)) return enumOf(schema.enum.map(String));
  if (typeof schema.const === "string") return { kind: "string", type: schema.const };
  const forms = formsOf(schema); // an id pattern reads <cell> or <execution>
  return { kind: "string", type: forms === "<text>" ? "string" : forms.slice(1, -1) };
}

function shapeOf(key: string, schema: Schema): Pick<Flag, "kind" | "type" | "item" | "values"> {
  if (key === "source") return { kind: "source", type: "text|-" };
  const scalar = scalarOf(schema);
  if (scalar !== undefined) return scalar;
  const items = isSchema(schema.items) ? scalarOf(schema.items) : undefined;
  if (schema.type === "array" && items !== undefined && items.kind !== "boolean") {
    return { kind: "list", type: items.type, item: items.kind };
  }
  return { kind: "json", type: "json" };
}

/** Each command's flags, derived once: the JSON Schema conversion is the expensive part. */
const derived = new WeakMap<AnyCommand, readonly Flag[]>();

/** The flags of `command`, in the order of its input's keys. */
export function flagsOf(command: AnyCommand): readonly Flag[] {
  const known = derived.get(command);
  if (known !== undefined) return known;
  const flags = deriveFlags(command);
  derived.set(command, flags);
  return flags;
}

/**
 * A key that is a notebook's path from the workspace root: `notebook`, and the `path` of the notebook domain's create,
 * open, delete and rename, with rename's `to`.
 */
const isNotebookPath = (command: AnyCommand, key: string): boolean =>
  key === "notebook" || ((key === "path" || key === "to") && command.name.startsWith("notebook."));

function deriveFlags(command: AnyCommand): readonly Flag[] {
  const schema = commandJsonSchema(command).inputSchema;
  const properties = isSchema(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(properties).map(([key, value]) => {
    const property = isSchema(value) ? value : {};
    const shape =
      secretKeys[command.name] === key
        ? { kind: "secret" as const, type: "" }
        : shapeOf(key, property);
    return {
      key,
      flag: kebab(key),
      ...shape,
      ...(shape.values === undefined ? {} : { type: kebab(key) }),
      ...(shape.kind === "json" ? { forms: formsOf(property) } : {}),
      ...(isNotebookPath(command, key) ? { type: "path" } : {}),
      required: required.has(key),
      ...("default" in property ? { defaults: { value: property.default } } : {}),
      ...(key === "notebook" ? { short: "n" } : {}),
    };
  });
}
