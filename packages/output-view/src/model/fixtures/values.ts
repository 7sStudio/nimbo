// Reads fixtures/values/output-view.json, output-view's file of the shared wire-form corpus.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One case as kernel-node's format has it: `json`, `repr` and `truncated` as a `value` output carries them. */
export type ValueCase = {
  readonly name: string;
  readonly source?: string;
  readonly json: unknown;
  readonly repr: string;
  readonly truncated: boolean;
};

const isCase = (value: unknown): value is ValueCase =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "name") === "string" &&
  typeof Reflect.get(value, "repr") === "string" &&
  typeof Reflect.get(value, "truncated") === "boolean" &&
  "json" in value;

/** The corpus file at the repository root (joined as a path: under happy-dom, `URL` is the DOM's, not Node's). */
const valuesFile = join(import.meta.dirname, "../../../../../fixtures/values/output-view.json");

const parsed: unknown = JSON.parse(readFileSync(valuesFile, "utf8"));

/** Every case, in file order. */
export const valueCases: readonly ValueCase[] =
  Array.isArray(parsed) && parsed.every(isCase) ? parsed : [];
