// Filter mode: chips compiled to one JSONPath filter query, shown under the chips.
import { keySegments, shorthand, shorthandPath } from "./key.ts";
import { escapeLiteral } from "./regex.ts";
import type { Chip } from "./types.ts";

const comparisons = { "=": "==", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=" } as const;

/** A JSON literal is a JSONPath literal for strings, finite numbers, booleans and null (JSON has no NaN). */
const literal = (value: string | number | boolean | null): string => JSON.stringify(value);

const condition = (chip: Chip): string => {
  const node = `@${shorthand(keySegments(chip.key))}`;
  switch (chip.op) {
    case "exists":
      return node;
    case "contains":
      return `search(${node}, ${literal(escapeLiteral(chip.value))})`;
    case "startsWith":
      return `search(${node}, ${literal(`^${escapeLiteral(chip.value)}`)})`;
    case "matches":
      return `match(${node}, ${literal(chip.value)})`;
    default:
      return `${node} ${comparisons[chip.op]} ${literal(chip.value)}`;
  }
};

/**
 * The JSONPath query for chips on the children of `at` (default `$`): `$[?@.status == "succeeded" && @.amount > 1000]`.
 * No chips select every child: `$[*]`.
 */
export const chipsToJsonPath = (chips: readonly Chip[], at = "$"): string => {
  const base = shorthandPath(at);
  return chips.length === 0 ? `${base}[*]` : `${base}[?${chips.map(condition).join(" && ")}]`;
};
