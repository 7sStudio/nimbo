// The chip types of Filter mode, shared by compile.ts and parse.ts.

/** A chip's literal: a JSON scalar. */
export type ChipValue = string | number | boolean | null;

/**
 * One condition on the filtered node's children. `key` is a relative singular path without the `@` (`status`,
 * `metadata.order_id`, `items[0].price`, `['first name']`); a key that is not such a path is one member name.
 */
export type Chip =
  | {
      readonly key: string;
      readonly op: "=" | "!=" | ">" | "<" | ">=" | "<=";
      readonly value: ChipValue;
    }
  | {
      readonly key: string;
      readonly op: "contains" | "startsWith" | "matches";
      readonly value: string;
    }
  | { readonly key: string; readonly op: "exists" };

/** Chips and the node they filter (`$` by default), as read back from a query. */
export type ChipFilter = { readonly at: string; readonly chips: readonly Chip[] };
